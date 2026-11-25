// 排序题的文字规则：一句台词怎么洗、怎么切成词块、怎么数词、怎么归一化判重。
// 前后端共用这一份（网页排序面板出题；服务端计分数词、判重、定级都 import 这里）。纯 ESM、无依赖，Node 和浏览器都能跑。
// 前后端各数各的词，口径不一就会出现同一句数出来词数不一样（比如一边只认拉丁字母、一边认任何字母），所以只留一份代码。
//
//
// 【版本号】改了下面任何会影响「切出哪些词、几个词」的规则，都要把 SORT_VER 加一，服务端每条计分记录都带上它。
// 加了新规则以后，旧记录里的词数前后不可比；记录里带上版本号，事后才能按版本切开。
// s1：切词正则 + 序数尾巴（2nd、1990s 算一个词）+ 剥冒号式说话人标签。
// s2：句中的、行首超过 19 个字符的说话人标签也剥（按原文判）；标签里的点只许跟在称谓缩写或单个字母后面。
//   过渡期同一句的 norm 可能变（带句中标签的那些句子），服务端「15 天内同一句不重复计分」可能放过一次，影响很小。
export const SORT_VER = 's2';
import { SORT_WORD_SOURCE } from './langProfile.js';

// ---- 切词 ----
// 切词正则：拉丁字母连写算一个词（带一个撇号段：I'm、don't），数字连同中间的 , . 算一个词（1,000.50）。
// 匹配之间的一切（空格、标点、连字符、引号、♪、中文）是固定文字，留在句子模板里不动。
// 【有意改动 3】数字后面补了序数 / 年代的尾巴：2nd、1990s 不拆成 2 / nd、1990 / s 两块。
//   - 尾巴大小写都认（2ND、1990S）：全大写台词会由 AI 恢复大小写，服务端按原文数词、面板按恢复后的文字出题，
//     两边必须切得一样多；
//   - 尾巴后面紧跟着字母就不算尾巴（4stars → 4 / stars、20somethings → 20 / somethings），免得从单词中间劈开。
// 词的字母部分按语言档案（shared/langProfile.js SORT_WORD_SOURCE）：拉丁（原正则一字不改）之外，
// 俄（西里尔）、印地（天城文）、阿拉伯、韩文这些按空格分词的文字也切得出词；日文假名汉字、中文没有空格，不在这里切（见 langProfile 的 segment 接口）。
const WORD_RE = new RegExp(SORT_WORD_SOURCE + String.raw`|\d+(?:[.,]\d+)*(?:(?:[sS][tT]|[nN][dD]|[rR][dD]|[tT][hH]|[sS])(?!\p{Script=Latin}))?`, 'gu');

// 一段文字里的词（不洗，洗用 sortText）。String.prototype.match 每次从头匹配，共用这个带 g 的正则没有 lastIndex 的问题
export function tokenize(text) {
  return String(text ?? '').match(WORD_RE) || [];
}

// 句子模板：
// [{ type: 'literal', text }, { type: 'slot', text, slotIndex }, ...]；slot 是答案区的一个空位，literal 是固定文字
// （多人对白的换行 \n 也在 literal 里；答题区不按它换行、当一个空格，词连成一段——web/src/styles.css .sort-template）。
export function parseTemplate(text) {
  const value = String(text ?? '');
  const parts = [];
  let cursor = 0;
  let slotIndex = 0;
  for (const m of value.matchAll(WORD_RE)) {
    if (m.index > cursor) parts.push({ type: 'literal', text: value.slice(cursor, m.index) });
    parts.push({ type: 'slot', text: m[0], slotIndex });
    slotIndex += 1;
    cursor = m.index + m[0].length;
  }
  if (cursor < value.length) parts.push({ type: 'literal', text: value.slice(cursor) });
  return parts;
}

// ---- 音效 / 说话人标注 [..]、(..) ----
// 和 web/src/core/subtitle/lines.js 的 stripNotes 是【同一套规则】，
// sort-test.mjs 拿 lines.js 的用例逐条对拍。字幕在 lines.js 里已经剥过一遍（MERGE_VER m3 起），
// 所以对网页端的句子这一步什么都不改；留着它是因为服务端计分时拿的是存下来的句子原文，前后端得过同一道。
// 【不能用朴素正则 \[[^\]]*\]|\([^)]*\)】Family Guy S20E01 那句
//   (à That was Elmer Hartman peaking at number 32 with "I Hate Computers (Tra‐La‐La)."
// 会被从「(à」一路吞到「La)」，只剩 ."，整句不出题（lines.js 头部注释、差距清单 P1-2）。三道保护：
// 1. 只认成对、里面不再套同种括号的一层（嵌套的由内向外剥），不成对的左括号原样留着；
// 2. 圆括号在引号里面不剥——那是歌名、书名的一部分；方括号照剥；
// 3. 括号里超过 6 个词、而同一行还有别的台词时不剥——那多半是括起来的真台词。
const NOTE_RE = /\[[^[\]]*\]|\([^()]*\)/g;
const NOTE_ALL = new RegExp(NOTE_RE.source, 'g'); // 在 NOTE_RE 的替换回调里用，别共用一个带 g 的对象
const MAX_NOTE_WORDS = 6;
const NOTE_WORD = /[\p{L}\p{N}']+/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;
const GAP = '\u0000'; // 剥掉的位置先占个位，好收拾它留下的空格
// 对白分隔号：- ‐ ‑ ‒ – — ― −（同 sentences.js 的 DASH）；两个连着的（"-- and then"）是话被打断后接着说，不是换人
const DASH_LEAD = /^[-‐-―−](?![-‐-―−])/;

const countNoteWords = (s) => (s.match(NOTE_WORD) || []).length;

function insideQuote(s, off) {
  const before = s.slice(0, off);
  const straight = (before.match(/"/g) || []).length;
  const open = (before.match(/“/g) || []).length, close = (before.match(/”/g) || []).length;
  return straight % 2 === 1 || open > close;
}

function lineHasSpeech(s, off, len) {
  const a = s.lastIndexOf('\n', off - 1) + 1;
  const b = s.indexOf('\n', off + len);
  return HAS_WORD.test((s.slice(a, off) + ' ' + s.slice(off + len, b < 0 ? s.length : b)).replace(NOTE_ALL, ' '));
}

export function stripNotes(text) {
  let s = String(text ?? '');
  const orig = s;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    s = s.replace(NOTE_RE, (m, off, whole) => {
      if (m[0] === '(' && insideQuote(whole, off)) return m;
      if (countNoteWords(m) > MAX_NOTE_WORDS && lineHasSpeech(whole, off, m.length)) return m;
      changed = true;
      return GAP;
    });
    if (!changed) break;
  }
  if (!s.includes(GAP)) return orig;
  const out = [];
  let carryDash = false;
  for (let l of s.split('\n')) {
    const had = l.includes(GAP);
    const dash = DASH_LEAD.test(l);
    l = l
      // 行首的说话人标注连同冒号一起去掉："(Lois): Hi" → "Hi"，"- [Peter]: Hey" → "- Hey"
      .replace(/^([-‐-―−]?[ \t]*)\u0000+[ \t]*:[ \t]*/, '$1')
      // "Hello [laughs]." → "Hello."；其余位置换成空格
      .replace(/[ \t]*\u0000+[ \t]*(?=[.,!?;:…]|$)/g, '').replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
    if (had && !HAS_WORD.test(l)) { carryDash ||= dash; continue; }
    if (carryDash && !DASH_LEAD.test(l)) l = `- ${l}`;
    carryDash = false;
    if (l) out.push(l);
  }
  return out.join('\n');
}

// ---- 冒号式说话人标签（BRYCE: Hey.） ----
// 排序题不剥它的话会多出一个听不到的词块，所以剥掉。
// 【行首】规则：^([A-Z][A-Za-z0-9 .']{1,18}):\s+(?=\S)，也就是
// 「大写字母开头、总共 2~19 个字符、只含字母数字空格点撇号，后面冒号 + 空白 + 台词」。小改了四处：
//   - 加了井号、-、弯撇号 ’：SDH 常见带编号的标签、「MARY-JANE:」「O’BRIEN:」；
//   - 字母用 \p{L}（JOSÉ:）；
//   - 每一行（每个说话人）各剥一次，不只句首：多人对白每人一行；
//   - 点只许跟在称谓缩写或单个字母后面（见 dotsOk，s2）。
// 逗号不在字符集里，所以 "Look, here's the thing: ..." 不会被当成标签；"Here's the thing: ..." 会，代价是少出几个词，题照样能做。
// 【只剥一层】剥完剩下的部分如果还像标签（"BRYCE: Look: ..."），这一行行首不剥。
// 【s2 补的两种】s1 只认行首短标签，真字幕里剥不干净（12 Angry Men 668 句里 62 句、BTTF3 660 句里 21 句，
// 多出听不到的词块，定级和分数也跟着抬高）：
//   - 句中标签：SDH 每条以「NAME:」开头，m3 起把间隔不到 0.6 秒（m4 起 0.3 秒）的相邻条用空格接成一行（sentences.js join），
//     标签就落在了句子中间：「No, thanks. JUROR 6: This thing isn't moving.」；
//   - 行首长标签：超过 19 个字符的「BUFFALO BOB SMITH ON TV:」。
//   这两种都只认全大写的标签，而且这一行要有小写字母作对照——整行全大写时分不清是标签还是喊话，只用行首短标签那条。
// 【按原文判】标签剥不剥，看的是原文（没恢复大小写的），不是显示的文字：大小写恢复会把「DOUG'S MOTHER:」
// 改成「Doug's mother:」，按恢复后的文字就认不出了；服务端数词、判重又只拿原文。见 sortText 的 orig 参数。
const LABEL_RE = /^\p{Lu}[\p{L}\p{N} .'’#-]{1,18}:\s+(?=\S)/u;
const LONG_LABEL_RE = /^\p{Lu}[\p{L}\p{N} .'’#-]{19,39}:\s+(?=\S)/u;   // 20~40 个字符
// 句中：前面是句末标点（可带收尾的引号、括号）加空白，或者行内换人的「 - 」；标签是全大写的 1~6 个词（可带 #N、撇号、点、连字符）
const MID_LABEL_RE = /([.!?…]["'”’)\]]*\s+|\s[-‐-―−]\s+)(\p{Lu}[\p{Lu}\p{N}.'’#-]*(?: [\p{Lu}\p{N}#][\p{Lu}\p{N}.'’#-]*){0,5}):\s+(?=\S)/gu;
const HAS_LOWER = /\p{Ll}/u;
const DASHES_LEAD = /^(?:[-‐-―−](?![-‐-―−])\s*)+/;

// 字幕里正常就写成大写的缩写。
// 句中单独一个这样的词后面跟冒号不算标签：「He works for the FBI. OK: let us go.」。
// 只有这一份：server/src/recase.js 从这里 import（sort-test.mjs 查着，哪天又抄回去一份也得逐个一致）。
export const COMMON_UPPER = new Set(['OK', 'TV', 'FBI', 'CIA', 'USA', 'UFO', 'DNA', 'DC', 'ID', 'PG', 'NYC', 'LA', 'UK',
  'DJ', 'PJ', 'CEO', 'VIP', 'GPS', 'ATM', 'SUV', 'BBQ', 'OMG', 'ASAP', 'NASA', 'ER',
  'ICU', 'IQ', 'CD', 'DVD', 'MVP', 'RV', 'PTA', 'SAT', 'GPA', 'NBA', 'NFL']);

// 标签里的点只许跟在称谓缩写或单个字母后面（DR. SMITH、Mr. Smith、U.S. MARSHAL、J. J.、LT. DAN）。
// s1 的字符集直接放了点和空格，能跨过句号把前一句真台词当标签剥掉：「No. Look: it's fine.」只剩「it's fine.」，
// 「I watched TV. FBI: open up!」只剩「open up!」，lines.js 剥完「Hey. [Peter]: What?」留下的「Hey.: What?」会丢掉 Hey。
// 先用宽的字符集匹配、再逐个查点，不写成后行断言 (?<=...)：Safari 16.4 以前不认，模块一加载就是语法错误，整页白屏
// （vite 默认产物要能跑在 safari14）。标签到第一个冒号为止（冒号不在字符集里），所以两种写法认出来的一样。
const TITLE_ABBR = new Set(['MR', 'MRS', 'MS', 'DR', 'ST', 'JR', 'SR', 'PROF', 'REV', 'SGT', 'CAPT', 'LT', 'COL', 'GEN', 'DET']);
const ONE_LETTER = /^\p{L}$/u;

function dotsOk(label) {
  const parts = label.split('.');
  for (let k = 0; k < parts.length - 1; k += 1) {
    const w = parts[k].slice(parts[k].search(/\S*$/));   // 点前面那个词（从上一个空白或点算起）
    if (!TITLE_ABBR.has(w.toUpperCase()) && !ONE_LETTER.test(w)) return false;
  }
  return true;
}

const labelOf = (m) => m[0].slice(0, m[0].indexOf(':'));

// 行首短标签连冒号和后面的空白有多长；不是返回 0
function shortLabel(s) {
  const m = LABEL_RE.exec(s);
  return m && dotsOk(labelOf(m)) ? m[0].length : 0;
}

// 行首标签（短的，或 20~40 个字符的长的）有多长；不是返回 0。
// 长的要求标签里没有小写、这一行后面的部分有小写（「BUFFALO BOB SMITH ON TV: Hey, kids…」）：
// 「FEMALE AUTOMATED VOICE: PLEASE HOLD.」整行全大写、「Hello there my good friend Bob: hi」标签带小写，都分不清，不剥。
function headLabel(s) {
  const n = shortLabel(s);
  if (n) return n;
  const m = LONG_LABEL_RE.exec(s);
  if (!m) return 0;
  const label = labelOf(m);
  return dotsOk(label) && !HAS_LOWER.test(label) && HAS_LOWER.test(s.slice(m[0].length)) ? m[0].length : 0;
}

// 句中的一个候选标签算不算：至少两个字母（「Pick one. A: the red one.」不算）、
// 不是单独一个常见缩写（「He works for the FBI. OK: let us go.」不算）、点的位置合规。
function midLabelOk(label) {
  if ((label.match(/\p{L}/gu) || []).length < 2) return false;
  if (!label.includes(' ') && COMMON_UPPER.has(label)) return false;
  return dotsOk(label);
}

// 原文的一行（已压空白、去掉行首「- 」）里要删掉的区间 [from, to)，从左到右、互不重叠
function labelCuts(s) {
  const cuts = [];
  const head = headLabel(s);
  if (head && !shortLabel(s.slice(head))) cuts.push([0, head]);
  if (!HAS_LOWER.test(s)) return cuts;
  MID_LABEL_RE.lastIndex = 0;   // 模块级带 g 的正则，每次从头扫（同步函数，不会重入）
  for (let m; (m = MID_LABEL_RE.exec(s));) {
    const from = m.index + m[1].length;
    // 称谓缩写后面的点不是句末（「Ask Dr. HOUSE: he knows.」的 HOUSE 是听得到的词）
    const afterTitle = m[1][0] === '.' && TITLE_ABBR.has(s.slice(0, m.index).match(/\S*$/)[0].toUpperCase());
    // 落在行首标签里的不算（"DR. SMITH: ..." 里的「SMITH:」）；不算的话从下一个字符接着找，
    // 和正则逐个位置试的效果一样（「Hello. NO. LOOK: hi」里「NO. LOOK」点不合规，接着认出「LOOK」）
    if (from < head || afterTitle || !midLabelOk(m[2])) { MID_LABEL_RE.lastIndex = m.index + 1; continue; }
    cuts.push([from, m.index + m[0].length]);
  }
  return cuts;
}

const tidyLine = (l) => l.replace(/\s+/g, ' ').trim().replace(DASHES_LEAD, '');

const sameButCase = (a, b) => a.length === b.length && a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US');

// 洗一遍：text 和 orig 各剥 [..]、(..)，逐行去「- 」、按 orig 这一行算出的区间同时删两边的标签，丢掉剥空的行。
// applyCase 只换字母大小写、别的字符和位置都不动（recase.js），stripNotes、压空白、去「- 」也都不看大小写，
// 所以两边逐行等长、删同一段位置就是删同一个标签。逐行对不上（以后有别的来源写 recase.texts）不抛错，那一行退回只按 text 判；
// 行数对不上就整句按 text 判。
function cleanOnce(text, orig) {
  const tl = stripNotes(text).split('\n');
  let ol = orig === text ? tl : stripNotes(orig).split('\n');
  if (ol.length !== tl.length) ol = tl;
  const outT = [];
  const outO = [];
  tl.forEach((line, k) => {
    let d = tidyLine(line);
    let o = ol === tl ? d : tidyLine(ol[k]);
    if (o !== d && !sameButCase(o, d)) o = d;
    for (const [a, b] of labelCuts(o).reverse()) {
      d = d.slice(0, a) + d.slice(b);
      o = o.slice(0, a) + o.slice(b);
    }
    d = d.trim();
    if (HAS_WORD.test(d)) { outT.push(d); outO.push(o.trim()); }
  });
  return [outT.join('\n'), outO.join('\n')];
}

// ---- 排序专用清洗（有意改动 2） ----
// 不动 sentences.js 的合并、不升 MERGE_VER（升了全站字幕要重翻），出题前在这里单独洗一遍：
//   1. 剥 [..]、(..)（见上，网页端句子早已剥过，这一步对它们是空操作）；
//   2. 每一行行首的对白分隔号「- 」去掉；
//   3. 剥冒号式说话人标签（见上，按 orig 判）；
//   4. 多人对白的换行留着，当固定文字（界面按换行显示）；剥完没字的行（只剩标点、♪）去掉；
//   5. 剥完一个词都没有 → 返回 ''，不出题。
// text：要出题 / 显示的文字（可以是恢复大小写后的）；orig：这句的原文（没恢复大小写的），不传就是 text。
// 【前后端数词一致】服务端数词、判重、定级都只拿原文（wordCount(原文)、norm(原文)），面板出题传 (恢复后的文字, 原文)、
// 定级传 (恢复后的文字, 原文)：标签都按原文判、删同一段位置，切出来的词只差大小写，词数逐个对得上。
// 幂等：sortText(sortText(x)) === sortText(x)，出题、重新打乱、服务端数词随便哪一层多洗一遍都不会变；
// 带原文时 sortText(sortText(t, o), sortText(o)) === sortText(t, o)。
// 做法是一遍一遍洗到不再变为止：剥掉一层以后可能露出新东西（"BOB: - hi" 露出行首的「- 」、标签剥掉后括号那行没了别的台词），
// 只洗一遍的话结果不是不动点，多洗一遍会再少一截，出题和服务端两边就对不上了。正常句子第二遍就不变。
export function sortText(text, orig = text) {
  const t = cleanText(text, orig);
  return tokenize(t).length ? t : '';
}

// 同 sortText 的清洗，但不看「有没有排序认得的词」：中文、日语的字不在排序的词正则里（它们走词块），
// sortText 会把整句洗成空串。句子解析按学习语言数词（shared/practiceWords.js），清洗和缓存键用这个。
export function cleanText(text, orig = text) {
  let t = String(text ?? '').replace(/\r\n?/g, '\n');
  let o = orig == null ? t : String(orig).replace(/\r\n?/g, '\n');
  for (let pass = 0; pass < 8; pass += 1) {   // 每洗一遍只会变短，8 遍是保险
    const [t2, o2] = cleanOnce(t, o);
    if (t2 === t && o2 === o) break;
    t = t2;
    o = o2;
  }
  return t;
}

// 排序题的词数 = 空位数。计分数词用它（不信外面报的数）；
// 0 = 这句不出题（‹ › 跳过、不算进「第 N / M 句」的 M）。传原文就行，里面会先 sortText（多洗一遍也一样）。
// orig 同 sortText：传了恢复后的文字时带上原文，数出来和 wordCount(原文) 一样。
export function wordCount(text, orig = text) {
  return tokenize(sortText(text, orig)).length;
}

// 判重用的归一化：
// 弯撇号换直撇号、转小写、字母数字撇号以外的一律当空格、空白合并。先 sortText，所以同一句台词带不带说话人标签、
// 恢没恢复大小写（恢复后的文字要带上原文），归一化出来都一样（服务端「15 天内同一句不重复计分」按它判）。
export function norm(text, orig = text) {
  return sortText(text, orig)
    .replace(/’/g, "'")
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}
