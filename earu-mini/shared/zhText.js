// 中文字幕的文字规则：汉字计数、去重键、对白分隔号、注释括号、制作组行、句末、说话人标签、简繁判断、像不像中文轨。
// 合中文整句（web/src/core/subtitle/zhLines.js）、选轨、判简繁都用这里。
// 纯 ESM、无依赖，Node 和浏览器都能跑。
// 中文字表都放在 shared/：i18n-test ⑧ 只扫 web/src 的字符串字面量（设计 F3），字表写在这里不会被当成没翻译的界面文案。
//
// 【版本号】MERGE_VER_ZH 管「中文视图」怎么从字幕条合成整句：剥注释、丢制作组行、拆双语、合句、标签算换人。
// 它进中文条目的指纹 sha256("zm2\nzh\n" + texts.join("\n"))（设计 D3），改了就是所有中文条目整份重翻、重标（最贵），
// 所以下面凡是影响合句结果的规则（stripNotesZh、ZH_STAFF_RE、isZhEnd、zhLen、zhLabelLen、ZH_DASH_START）改了都要升它。
// 上线前用真片校准（设计 B12），定稿以后才上线。英文那边的 MERGE_VER（m4）各管各的。
// 叫 zm1 不叫 zh1：日志里「zh1\nzh」容易看错。
// zm2：合句间隔 0.6 → 0.3 秒；句末带标点的轨一句到 10 字、说到句末就断，省略号续接（「……」接「……」）除外（web/src/core/subtitle/zhLines.js）。
// 中文没有旧版本数据，不用搬（英文 m3 → m4 要搬，见 sentences.js PREV_MERGE）
export const MERGE_VER_ZH = 'zm2';

// ---- 汉字 ----
// \p{Script=Han}：中日韩统一表意文字各区、〇、々 都算；拼音按「每个汉字一个音节」对（设计 D6），数的就是它
export const HAN_RE = /\p{Script=Han}/u;
const HAN_G = /\p{Script=Han}/gu;
// 「○」（U+25CB 白圈）、「◯」（U+25EF 大圈）常被当「〇」写（二○○八年：〇 不好打）。只有一串圈前后紧挨着汉字数字时才算〇；
// 别处的 ○ 是项目符号、打码的「○○」，不是汉字。逐个码元换（都是一个码元），长度不变：判断用换过的串，下标照用，切片还取原文。
// 共用的「是不是汉字」都先过它：hanCount、keyOf，zhSort / zhAnno 里数汉字、对词、切词的地方。
const ZERO_NEAR = new Set([...'〇零一二三四五六七八九十百千万萬亿億两兩']);
export function zeroFix(s) {
  const t = typeof s === 'string' ? s : '';
  if (!/[○◯]/.test(t)) return t;
  return t.replace(/[○◯]+/g, (m, off, whole) => (ZERO_NEAR.has(whole[off - 1]) || ZERO_NEAR.has(whole[off + m.length]) ? '〇'.repeat(m.length) : m));
}
export const hanCount = (s) => (typeof s === 'string' ? zeroFix(s).match(HAN_G) || [] : []).length;

// 去重键 / 比对键：全角转半角（ＯＫ → ok、１２ → 12）、大小写归一，只留字母数字。
// 用在：AI 切的词拼回去和原文是不是一样（zhAnno.js checkAnno 的 'join'）、计分核对原文、normZh 去重（和切法无关）。
export const keyOf = (s) => zeroFix(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// ---- 对白分隔号 ----
// 同 sentences.js / sortText.js 的那一组（- 和 U+2010–U+2015、U+2212 −），多了全角 －（U+FF0D）和小写的 ﹣（U+FE63）：
// 中文字幕常用全角的「－你去哪儿」。写成转义，免得几种横线在编辑器里看不出差别。
export const ZH_DASH = '[\\-\\u2010-\\u2015\\u2212\\uFF0D\\uFE63]';
// 行首的分隔号（连同后面的空白）：只认一个；两个连着的「——」是话被打断，不算换人
export const ZH_DASH_START = new RegExp(`^${ZH_DASH}(?!${ZH_DASH})\\s*`);

// ---- 注释括号 ----
// 中文字幕的注释：（笑）、【音乐】、〔画外音〕、（注：双关）、[敲门声]。和英文 stripNotes 同一个思路（只认成对、里面不再套括号的一层，
// 由内向外剥，最多三层），判断「是不是注释」换成中文的口径：
//   - 括号里汉字 ≤ 6 个（（笑）（敲门声）（叹气）），或以 注： / 译注 / 注释 / 双关 / 画外音 / 旁白 / OS / 内心 开头的才剥；
//     单独的「注」后面要跟冒号、OS 后面不能再接字母：不然「（注意他的手一直在发抖）」「（Oscar说……）」这种长台词会被当注释剥掉；
//     更长的多半是括起来的真台词（「（这下完了我该怎么跟他解释）」是内心独白，听得到），留着；
//   - 在引号「」『』“”"" 和书名号《》里面的不剥：那是引的话、作品名的一部分；
//   - 剥完没字的行整行去掉，它开头的分隔号挪给下一行（同英文 stripNotes：「－（笑）\n好吧」→「－好吧」）。
// 括号按「家族」配对：全角半角的圆括号可以混着配（「（笑)」真字幕里有），【】、〔〕、方括号各自配；配不上的不动。
const ZH_NOTE_RE = /[（(【〔［[][^（()）【】〔〕［］[\]]*[）)】〕］\]]/g;
const BRACKET_FAMILY = { '（': 0, '(': 0, '）': 0, ')': 0, '【': 1, '】': 1, '〔': 2, '〕': 2, '［': 3, '[': 3, '］': 3, ']': 3 };
const NOTE_MAX_HAN = 6;
// 简繁两套写法都认（繁體字幕也走这里）
const NOTE_LEAD = /^\s*(?:[注註]\s*[:：]|译注|譯註|注释|註釋|双关|雙關|画外音|畫外音|旁白|OS(?![A-Za-z])|内心|內心)/i;
const HAS_WORD = /[\p{L}\p{N}]/u;
const GAP = '\u0000';   // 剥掉的位置先占个位，好收拾它留下的空白
const QUOTE_PAIRS = [['「', '」'], ['『', '』'], ['“', '”'], ['《', '》']];

function insideQuoteZh(s, off) {
  const before = s.slice(0, off);
  if ((before.match(/"/g) || []).length % 2 === 1) return true;
  return QUOTE_PAIRS.some(([a, b]) => before.split(a).length > before.split(b).length);
}

function isNote(m, whole, off) {
  if (BRACKET_FAMILY[m[0]] !== BRACKET_FAMILY[m[m.length - 1]]) return false;
  if (insideQuoteZh(whole, off)) return false;
  const inner = m.slice(1, -1);
  return hanCount(inner) <= NOTE_MAX_HAN || NOTE_LEAD.test(inner);
}

// 剥掉的位置怎么补：前后都是拉丁字母 / 数字，或者原来就隔着空白（大陆字幕空格当逗号用），补一个空格；否则直接接上
// （「我（笑）知道」→「我知道」，不能在两个汉字中间凭空多出空格）
function closeGap(line) {
  return line.replace(/[ \t　]*\u0000+[ \t　]*/g, (m, off, whole) => {
    const before = whole.slice(0, off);
    const after = whole.slice(off + m.length);
    if (!before.trim() || !after.trim()) return '';
    const spaced = /[ \t　]/.test(m);
    const latin = /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(after);
    return spaced || latin ? ' ' : '';
  });
}

export function stripNotesZh(text) {
  const orig = typeof text === 'string' ? text : '';
  let s = orig;
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    s = s.replace(ZH_NOTE_RE, (m, off, whole) => {
      if (!isNote(m, whole, off)) return m;
      changed = true;
      return GAP;
    });
    if (!changed) break;
  }
  if (!s.includes(GAP)) return orig;
  const out = [];
  let carry = '';   // 整行剥没了的那一行开头的分隔号，挪给下一行
  for (let l of s.split('\n')) {
    if (!l.includes(GAP)) {
      if (carry && !ZH_DASH_START.test(l)) l = carry + l;
      carry = '';
      out.push(l);
      continue;
    }
    const dash = (ZH_DASH_START.exec(l.trimStart()) || [''])[0];
    l = l
      // 行首的说话人注释连同冒号一起去掉：「（王）：你好」→「你好」、「－（王）：你好」→「－你好」
      .replace(new RegExp(`^(\\s*(?:${ZH_DASH}\\s*)?)\\u0000+[ \\t\\u3000]*[：:][ \\t\\u3000]*`), '$1')
      // 行首剥掉以后跟着的逗号、顿号也去掉：「（笑），好吧」→「好吧」（省略号是停顿，留着）
      .replace(new RegExp(`^(\\s*(?:${ZH_DASH}\\s*)?)\\u0000+[ \\t\\u3000]*[，、,;；]+`), '$1\u0000');
    l = closeGap(l).trim();
    if (!HAS_WORD.test(l)) { carry ||= dash; continue; }
    if (carry && !ZH_DASH_START.test(l)) l = carry + l;
    carry = '';
    out.push(l);
  }
  return out.join('\n');
}

// ---- 制作组行 ----
// 字幕组的署名、免责声明：命中的行整行丢（合句前，zhLinesOf）。简繁都认。
// 职务词（翻译：/ 校对：……）要在行首（冒号前可以有空白：「翻译 ：小明」）：台词里也会说「你帮我翻译：这句话什么意思」。
// 字幕组、免责声明这几个词台词里几乎不出现，不锚定。m 旗标：整条（多行）拿来测也是逐行认行首。
export const ZH_STAFF_RE = /^[ 	　]*(?:翻译|翻譯|校对|校對|时间轴|時間軸|压制|壓制|片源)[ 	　]*[:：]|字幕组|字幕組|字幕由|仅供学习|僅供學習|本字幕/m;

// ---- 句末、长度 ----
// 一句话说完了没有：句末是 。！？… ⋯ 或 ...（可以跟着收尾的引号、括号）
export const isZhEnd = (s) => /(?:[。！？!?…⋯]|\.{3})+[」』”’"'）)\]】]*$/.test(s);
// 合句用的「长度」：汉字一个算一，拉丁字母词、数字串各算一。先 NFKC（同 keyOf 的口径）：全角的 ＯＫ、１２ 也算
export const zhLen = (s) => {
  const t = String(s ?? '').normalize('NFKC');
  return hanCount(t) + (t.match(/[A-Za-z]+|\d+/g) || []).length;
};

// ---- 说话人标签「王：」----
// 行首（可以在分隔号后面）1–5 个汉字 / 拉丁字母 / 间隔号加冒号、后面还有台词的，算说话人标签。
// 间隔号认 · ‧ ・ 和网文常用的 •、半角 ･、∙（同 zhSort.js CONNECTORS）。
// 标签留在原文里（显示、翻译、标拼音都带着；合句时行首有标签算换人），只有排序清洗才剥（zhSort.js sortTextZhMap，设计 D4）。
// 口语里「冒号引起下文」很常见，这些都不算标签：
//   - 以 说 道 问 讲 喊 叫 想 是 答 写 结尾的（「他说：我不去」「他回答：好的」「信上写：我爱你」是叙述）；
//   - 以人称代词开头的（「你听着：」「我告诉你：」「大家注意：」）：说话人标签是名字、称呼，不会这么写；
//   - 以 听着 / 听好了 / 记住 / 注意 / 告诉你 结尾的（「你给我听着：」「听好了：」）；
//   - 下面这些常见的引起下文的词（「比如：」「第一：」「总之：」）。
const LABEL_ZH = /^([\p{Script=Han}A-Za-z·‧・•･∙]{1,5})[：:]\s*(?=\S)/u;
const LABEL_VERB_END = /[说說道问問讲講喊叫想是答写寫]$/;
const LABEL_PRON_START = /^(?:[我你妳您他她它咱]|大家)/;
const LABEL_STOP_END = /(?:听着|聽著|聽着|听好了|聽好了|记住|記住|注意|告诉你|告訴你)$/;
const LABEL_STOP = new Set([
  '就是', '问题是', '对了', '好', '是', '不', '喂', '你看', '结果', '所以', '但是', '然后', '因为',
  '首先', '其次', '最后', '现在', '地址', '时间', '电话', '名字', '等等', '比如', '例如', '总之', '还有',
  ...[...'一二三四五六七八九十'].map((c) => `第${c}`),
  // 繁體
  '問題是', '對了', '結果', '然後', '因為', '最後', '現在', '時間', '電話', '總之', '還有',
]);

// 回标签加冒号的长度（不含分隔号、不含冒号后面的空白），不是标签回 0：
// zhLabelLen('王：你好') === 2、zhLabelLen('- 李：嗯') === 2、zhLabelLen('他说：我不去') === 0
export function zhLabelLen(line) {
  const s = (typeof line === 'string' ? line : '').replace(/^\s+/, '').replace(ZH_DASH_START, '');
  const m = LABEL_ZH.exec(s);
  if (!m) return 0;
  const label = m[1];
  if (LABEL_VERB_END.test(label) || LABEL_PRON_START.test(label) || LABEL_STOP_END.test(label) || LABEL_STOP.has(label)) return 0;
  return label.length + 1;
}

// ---- 简体还是繁體 ----
// 只有简体才有的字和它们的繁體写法（选轨备忘的字表；繁體那边多收了几个异体：麽 爲 説 鍾 髮）。两边都常用、写法一样的字不在表里。
const HANS_ONLY = new Set([...'们这说个来时会么没对过还为让吗话见门东车开长马样钱问间觉请应该现发书买爱头点钟给认识谁读写语难电视处备热欢办边']);
const HANT_ONLY = new Set([...'們這說個來時會麼沒對過還為讓嗎話見門東車開長馬樣錢問間覺請應該現發書買愛頭點鐘給認識誰讀寫語難電視處備熱歡辦邊麽爲説鍾髮']);
const SAMPLE = 300;
const textOf = (x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '');

// 前 300 条里数特征字：两边合计不到 5 个 → null（看不出来）；简 ≥ 4×繁 → 'Hans'；繁 ≥ 4×简 → 'Hant'；否则 'mixed'。
// lines：字幕条（{text}）或字符串都行（直接用 entry.sentences 现判）。
export function detectHanScript(lines) {
  let hans = 0;
  let hant = 0;
  for (const x of (Array.isArray(lines) ? lines : []).slice(0, SAMPLE)) {
    for (const c of textOf(x)) {
      if (HANS_ONLY.has(c)) hans += 1;
      else if (HANT_ONLY.has(c)) hant += 1;
    }
  }
  if (hans + hant < 5) return null;
  if (hans >= 4 * hant) return 'Hans';
  if (hant >= 4 * hans) return 'Hant';
  return 'mixed';
}

// ---- 像不像中文轨 ----
// worker 只对「像中文」的轨多算一份中文视图（设计 §2）。前 300 条：汉字 ≥ 10 个，假名不到中日韩字符的 10%（日文轨假名多），
// 谚文不占多数（韩文轨）。拉丁字母多少不管：中英双语轨也算（中文那半要拿出来）。
const KANA_G = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HANGUL_G = /\p{Script=Hangul}/gu;

export function isZhCandidate(cues) {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  for (const x of (Array.isArray(cues) ? cues : []).slice(0, SAMPLE)) {
    const t = textOf(x);
    han += hanCount(t);
    kana += (t.match(KANA_G) || []).length;
    hangul += (t.match(HANGUL_G) || []).length;
  }
  const cjk = han + kana + hangul;
  return han >= 10 && kana < 0.1 * cjk && hangul * 2 <= cjk;
}
