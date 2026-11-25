// 中文字幕的「中文视图」：把一条中文（或中英双语）字幕轨的原始条整理成学中文用的整句。
// worker 对「像中文」的轨（shared/zhText.js isZhCandidate）在原来的英文整句之外多算这一份（media.js extractSubtitles 的 zhOut）；
// 对「像中文」的轨（shared/zhText.js isZhCandidate）在原来的英文整句之外多算这一份；
//
// 流程（zhLinesOf）：
//   1. buildLinesZh：每条先去掉字幕组署名行（ZH_STAFF_RE），再剥注释括号（stripNotesZh）；丢掉没字的条、零时长的条，排序，
//      起止相同的两条合并（"\n" 接），首尾相接的重复块合并（照 lines.js buildLines，代码抄过来，不动原文件）；
//   2. splitBilingual：整轨判成中英双语的，每条只留中文那半，英文那半收进 ref（给错位检测的校准脚本当标准答案）；
//   3. mergeSentencesZh：按整轨风格（句末带不带标点）合成整句；行首分隔号、行首说话人标签「王：」算换人（标签留在原文里）。
//
// 【版本号】这里任何会影响「切出哪几句、每句什么字」的规则改了，都要升 shared/zhText.js 的 MERGE_VER_ZH：
// 它进中文条目的指纹，升了就是所有中文条目整份重翻、重标（最贵）。下面的几个数（0.3 秒、10 字、30 字、50%、20%、30%、6 个字母、2 个词）全是估的，
// 用真片校准过才算定稿。
//
// 输出的句子 { i, start, end, text }：不带 kara（拆双语、合句以后卡拉 OK 的逐词时间对不上，中文也高亮不了）、不带 ref。
// 文本契约同英文（server/src/validate.js speakerCount 靠它）：要么单行，要么多行、每行以 "- " 开头（一行一个说话人）。
// 这里只用正则、不用 Intl.Segmenter：各浏览器、前后端切出来的句子一样（句子进指纹）。
import {
  HAN_RE, ZH_DASH, ZH_DASH_START, ZH_STAFF_RE, stripNotesZh, isZhEnd, zhLen, zhLabelLen, detectHanScript,
} from '../../../../shared/zhText.js';

const HAS_WORD = /[\p{L}\p{N}]/u;
const SAMPLE = 300;   // 整轨统计（双语、风格）只看前 300 条，同 shared/zhText.js 的 detectHanScript、isZhCandidate

// ---- 1. 剥注释、丢署名、排序、合并同时出现的行 ----
// 一条字幕：先整行丢掉字幕组署名（「本字幕由XX字幕组制作」「翻译：小明」），再剥注释括号（（笑）【音乐】〔画外音〕）
function cleanCueZh(text) {
  return stripNotesZh(text.split('\n').filter((l) => !ZH_STAFF_RE.test(l)).join('\n'));
}

// cues：decodeSamples 解出来的 [{start, end, text, kara?}]；返回 [{i, start, end, text}]（i 从 0 起）
export function buildLinesZh(cues) {
  const sorted = (cues || [])
    .filter((c) => c.text && Number.isFinite(c.start))
    .map((c) => ({ start: Math.max(0, c.start), end: c.end, text: cleanCueZh(c.text) }))
    // 剥完没有字母数字的整条丢掉（【音乐】、♪♪、署名行）；零时长、结束不晚于开始的丢掉（同 lines.js）
    .filter((c) => HAS_WORD.test(c.text) && c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const c of sorted) {
    const prev = merged[merged.length - 1];
    // ASS 常把同一时刻的上下两行拆成两条事件（中英双语轨中文、英文各一条）；同起同止的合并成一条
    if (prev && Math.abs(prev.start - c.start) < 0.02 && Math.abs(prev.end - c.end) < 0.02) {
      if (!prev.text.split('\n').includes(c.text)) prev.text += '\n' + c.text;
      continue;
    }
    // 同一句被拆成首尾相接的重复块（常见于转封装出来的字幕）
    if (prev && prev.text === c.text && c.start - prev.end < 0.05) {
      prev.end = Math.max(prev.end, c.end);
      continue;
    }
    merged.push({ ...c });
  }
  return merged.map((l, i) => ({ i, ...l }));
}

// ---- 2. 拆中英双语 ----
// 一行算什么：有汉字 → 'zh'；没汉字、拉丁字母 ≥ 2 个 → 'en'；别的（数字、符号、单个字母）→ 'x'（留在中文那边）
export const rowKind = (r) => (HAN_RE.test(r) ? 'zh' : (r.match(/[A-Za-z]/g) || []).length >= 2 ? 'en' : 'x');
// 一行里「中文 + 空格 + 一段英文」（「这件事说来话长 It's a long story.」）：英文那段 ≥ 6 个字母、≥ 2 个词才切。
// 只在已经判成双语的轨上、并且这一条没有单独的英文行时切：纯中文轨里「我想买 iPhone」不能切；
// 双语轨上「我刚买了 iPhone\nI just bought an iPhone」英文已经单独占一行，句尾的「iPhone」是中文台词自己的
const INLINE_BI = /^(.*\p{Script=Han}[^A-Za-z]*?)\s+([A-Za-z][^\p{Script=Han}]*)$/u;
const INLINE_MIN_LETTERS = 6;
const INLINE_MIN_WORDS = 2;
const inlineEnOk = (s) => (s.match(/[A-Za-z]/g) || []).length >= INLINE_MIN_LETTERS &&
  (s.match(/[A-Za-z]+/g) || []).length >= INLINE_MIN_WORDS;

// lines：buildLinesZh 的输出。返回 { lines: [{i, start, end, text, ref?}], bilingual }。
// 怎么判双语：前 300 条里，含中文行的条数 zhC ≥ 3、并且占 ≥ 20%，并且「同一条里中文行、英文行都有」≥ 0.3·zhC，或「只有英文行」≥ 0.3·zhC
// （后一种是中、英分成两个事件、时间又对不齐的 ASS）。不是双语原样返回：纯中文轨里偶尔一句「OK」「Thank you.」是台词，不能删。
// 「占 ≥ 20%」防的是英文轨里转写了几块中文招牌（400 条英文 + 3 条「北京欢迎你」）：不加它「只有英文行 ≥ 0.3·zhC」随便成立，
// 判成双语以后英文条全丢、只剩 3 条中文，整条英文轨就被当成中文轨选上了。真双语轨：中英两个事件的约 50%，一个事件的约 100%。
// 判成双语以后：英文行收进 ref；拆完一个汉字都没有的条整条丢（只有英文的条、英文歌词）；kara 去掉（逐词时间是英文那半的）；i 重新编号。
// 有中文行的一条里，没汉字、带拉丁字母或数字的行也算英文那半（「我……\nI...」「一百块。\n$100.」：rowKind 判成 'x' 的那种）。
export function splitBilingual(lines) {
  let zhC = 0;
  let paired = 0;
  let enOnly = 0;
  for (const l of lines.slice(0, SAMPLE)) {
    const kinds = l.text.split('\n').map(rowKind);
    const z = kinds.includes('zh');
    const e = kinds.includes('en');
    if (z) zhC += 1;
    if (z && e) paired += 1;
    if (!z && e) enOnly += 1;
  }
  const bilingual = zhC >= 3 && zhC >= 0.2 * Math.min(lines.length, SAMPLE) &&
    (paired >= 0.3 * zhC || enOnly >= 0.3 * zhC);
  if (!bilingual) return { lines, bilingual };
  const out = [];
  for (const l of lines) {
    const zh = [];
    const en = [];
    const rows = l.text.split('\n');
    const kinds = rows.map(rowKind);
    const hasZh = kinds.includes('zh');
    const hasEn = kinds.includes('en');
    rows.forEach((r, k) => {
      if (kinds[k] === 'en' || (hasZh && kinds[k] === 'x' && /[A-Za-z0-9]/.test(r))) { en.push(r); return; }
      const m = kinds[k] === 'zh' && !hasEn && INLINE_BI.exec(r);
      if (m && inlineEnOk(m[2])) { zh.push(m[1].trim()); en.push(m[2].trim()); return; }
      zh.push(r);
    });
    if (!zh.some((r) => HAN_RE.test(r))) continue;
    const { kara, ref, ...rest } = l;
    out.push({ ...rest, text: zh.join('\n'), ...(en.length ? { ref: en.join('\n') } : {}) });
  }
  return { lines: out.map((l, i) => ({ ...l, i })), bilingual };
}

// ---- 3. 合成整句 ----
// 整轨风格：'punct'（港台、字幕组常见：句末带句号逗号）或 'bare'（大陆台词、流媒体简体常见：句末不加句号逗号、空格当逗号）。
// 'bare' 的轨看不出哪里是句末，每条的结尾都当一个短语说完了，只靠间隔断句。
// 只数 bare 风格会省掉的那几个（。，、；：,.）：？！… 两种风格都留着，不能当证据——大陆轨问句一多（「你去哪儿了？/我去超市了」
// 一问一答各占一半），按原来那组（连 ？！… 一起数）会判成 'punct'，不带标点的陈述句就和下一个人的话接成一句。
// 分母也去掉以 ？！… 结尾的条：其余的条里一半以上以 。，、；：,. 结尾 → 'punct'。后面可以跟收尾的引号括号（「好。」）
const STYLE_END = /[。，、；：,.][」』”’"'）)\]】]*$/;
const STYLE_OPEN = /(?:[？！?!…⋯]|\.{2,})[」』”’"'）)\]】]*$/;
export const ZH_STYLE_RATIO = 0.5;   // 其余的条里句末带标点的占比到这个数就判 'punct'
// 风格统计：{ ended 句末带标点的条数, n 参与统计的条数（前 300 条里去掉以 ？！… 结尾的）}；zhStyleOf 用它判，
// 边读边出（media.js partialLines）也要看这两个数——样本小、占比离门槛近的段，风格可能和读全的整轨判得不一样
export function zhStyleStat(lines) {
  const rest = lines.slice(0, SAMPLE).map((l) => l.text.trim()).filter((t) => !STYLE_OPEN.test(t));
  return { ended: rest.filter((t) => STYLE_END.test(t)).length, n: rest.length };
}
export function zhStyleOf(lines) {
  const { ended, n } = zhStyleStat(lines);
  return ended >= n * ZH_STYLE_RATIO ? 'punct' : 'bare';
}
// 合句时一段算不算说完（'punct' 风格用）：isZhEnd（。！？… 和 ...），再加「字母 / 汉字 / 数字后面一个半角句点」：
// 中文对白里的英文句子（「Thank you.」）、拿半角句点当句号的机翻轨（「你好.」）。「..」「Mr.」后面接着说的极少，先这样
const isEndZh = (s) => isZhEnd(s) || /[\p{L}\p{N}]\.[」』”’"'）)\]】]*$/u.test(s);

const MIN_GAP = 0.3;    // 句末以后间隔到这么长就断（同英文 m4）
// 句末带标点的轨（'punct'）：一句已经有这么多字（zhLen）、又说到了句末（。！？…），不管间隔多短都断。
// 不然一问一答、「如果你……，说明你……。」这种对子接得紧（间隔常常是 0），一路并到 30 字才断，一句里带着下一对的半句。
// 不到 10 字的短句（「不要焦虑！」「爱自己！」）照旧按间隔接后面那句
const ZH_END_LEN = 10;
// 上一条以省略号收尾、下一条又以省略号开头、不换人（「我本来想跟你说一件很重要的事……」接「……但是算了。」）：是话说一半接着说，
// 上一条的省略号不算说完——不按上面「够 10 字说到句末就断」切成两半，照 zm1 的口径（够 30 字才断，间隔照样看）。
// 接起来时下一条开头的省略号去掉（joinZh）：加了 10 字那条以后，这种续接被切开、第二句只剩半截
const ELLIPSIS_END = /(?:[…⋯]|\.{2,})[」』”’"'）)\]】]*$/;
const ELLIPSIS_START = /^(?:[…⋯]|\.{2,})/;
const ZH_CAP = 30;      // 'bare' 风格（看不出句末，每条都当说完）并到这么多字以后就断（英文是 22 个词）
const MAX_GAP = 2.0;    // 间隔超过它必断
const MAX_SPAN = 20.0;  // 一句最长跨度兜底

// 一行里两个人：以分隔号开头、行中间又有「空白 + 单个分隔号」的（「-你去哪 -回家」）
const INLINE_DASH = new RegExp(`\\s+${ZH_DASH}(?!${ZH_DASH})\\s*`);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// 两段接成一段（同一个人接着说）：先去掉后一段开头的省略号（「我本来想……」接「……算了。」）；
// 'bare' 的轨前一段不以标点结尾时加一个空格（保留「空格当逗号」的写法），两边紧挨着的都是拉丁字母 / 数字时也加空格；其余直接接上
function joinZh(a, b, style) {
  const rest = b.replace(/^(?:[…⋯]|\.{2,})+\s*/, '');
  if (!rest) return a;
  if (!a) return rest;
  const space = (style === 'bare' && !/\p{P}$/u.test(a)) || (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(rest));
  return space ? `${a} ${rest}` : a + rest;
}

// 一条字幕按说话人拆开：[{ dash: 是不是换人, text }]
//   - 行首一个分隔号（「－你去哪儿？」）：换人，分隔号去掉；行首「——」是话被打断，不算（ZH_DASH_START）；
//   - 行首有说话人标签（「王：你好」，zhLabelLen）：换人，标签留着（D4：显示、翻译、标拼音都带着，只有排序清洗才剥）；
//   - 别的行是排版折行，接到上一段后面；第一行没分隔号、后面的行有，第一段是上一个人接着说（同英文 speakersOf）。
export function speakersOfZh(text, style = 'punct') {
  const groups = [];
  for (const raw of text.split('\n')) {
    const l = squash(raw);
    if (!l) continue;
    const d = ZH_DASH_START.exec(l);
    if (d) for (const part of l.slice(d[0].length).split(INLINE_DASH)) groups.push({ dash: true, parts: [part] });
    else if (zhLabelLen(l) > 0) groups.push({ dash: true, parts: [l] });
    else if (!groups.length) groups.push({ dash: false, parts: [l] });
    else groups[groups.length - 1].parts.push(l);
  }
  return groups
    .map((g) => {
      const [first = '', ...rest] = g.parts.filter(Boolean);
      return { dash: g.dash, text: rest.reduce((a, b) => joinZh(a, b, style), first) };   // 第一段开头的省略号留着
    })
    .filter((g) => g.text);
}

// 合回文本：一个人 → 单行（开头不带分隔号）；几个人 → 每人一行「- 」（同英文 render）
const render = (turns) => (turns.length > 1 ? turns.map((t) => `- ${t.text}`).join('\n') : turns[0].text);

// lines：buildLinesZh / splitBilingual 的输出（已排序）；返回 [{i, start, end, text}]，i 重新编号。
// opts.style 只给测试用（指定风格）；正常按整轨统计（zhStyleOf）。
// 断句：hard = 'bare' ? 每条都算说完 : isEndZh（。！？…、字母后的半角句点）；
// brk = (hard && (间隔 ≥ 0.3 秒 || 已有 ≥ cap 字)) || 间隔 > 2 秒 || 跨度 > 20 秒，cap 是 'punct' 10 字（ZH_END_LEN）、'bare' 30 字（ZH_CAP）；
// 'punct' 的省略号续接（上一条「……」收尾、下一条「……」开头、不换人）cap 也是 30 字。
// 跨条换人的处理同英文 m3 起的做法：下一条以分隔号 / 标签开头就另起一个说话人行，否则接到最后一个说话人后面。
// opts.breaksOut（分段早翻译用）：传一个空数组进来，往里记「同步断点」——输出里哪些整句是紧跟在同步断点后面开头的
// （整句下标，从小到大）。同步断点 = 因为「上一条自己说完了 + 间隔 ≥ MIN_GAP」或「间隔 > MAX_GAP」断开的地方，只看相邻这一对条，
// 和这句从哪条开始累计无关，所以头被截掉的一段和读全的整轨在这里断得一样；靠字数封顶（cap）、跨度封顶（MAX_SPAN）断的取决于累计起点，不记。
// 只记录，不影响任何输出（同英文 mergeSentences 的 breaksOut）。
export function mergeSentencesZh(lines, opts = {}) {
  const style = opts.style || zhStyleOf(lines);
  const cap = style === 'bare' ? ZH_CAP : ZH_END_LEN;
  const units = lines
    .map((l) => ({ start: l.start, end: l.end, turns: speakersOfZh(l.text, style) }))
    .filter((u) => u.turns.length);
  const out = [];
  let cur = null;
  let prev = null;   // 上一条字幕（同步断点只看相邻这一对）
  for (const u of units) {
    if (cur) {
      // 间隔取整到毫秒再比（zm2 起，同英文 m4 的 gapOf）：字幕时间是毫秒，直接相减带浮点误差（2.9 − 2.6 = 0.29999…）
      const gap = Math.round((u.start - cur.end) * 1000) / 1000;
      const span = u.end - cur.start;
      const len = cur.turns.reduce((n, t) => n + zhLen(t.text), 0);
      const lastText = cur.turns[cur.turns.length - 1].text;
      const hard = style === 'bare' ? true : isEndZh(lastText);
      // 省略号续接（见 ELLIPSIS_END）：10 字那条不管，按 30 字算
      const cont = style === 'punct' && !u.turns[0].dash && ELLIPSIS_START.test(u.turns[0].text) && ELLIPSIS_END.test(lastText);
      const brk = (hard && (gap >= MIN_GAP || len >= (cont ? ZH_CAP : cap))) || gap > MAX_GAP || span > MAX_SPAN;
      if (!brk) {
        const [first, ...more] = u.turns;
        const last = cur.turns[cur.turns.length - 1];
        if (first.dash) cur.turns.push({ ...first });
        else last.text = joinZh(last.text, first.text, style);
        cur.turns.push(...more.map((t) => ({ ...t })));
        cur.end = Math.max(cur.end, u.end);   // 后开始的一条可能先结束（两人台词重叠）
        prev = u;
        continue;
      }
      out.push(cur);
      // 上一条自己的结尾也得是句末（'bare' 每条都算）：cur 是几条接起来的，hard 看的是接起来以后的结尾，同一个字符，这里再核一遍相邻这一条
      const ownHard = style === 'bare' || isEndZh(prev.turns[prev.turns.length - 1].text);
      if (opts.breaksOut && ((hard && ownHard && gap >= MIN_GAP) || gap > MAX_GAP)) opts.breaksOut.push(out.length);
    }
    cur = { start: u.start, end: u.end, turns: u.turns.map((t) => ({ ...t })) };
    prev = u;
  }
  if (cur) out.push(cur);
  return out.map(({ start, end, turns }, i) => ({ i, start, end, text: render(turns) }));
}

// ---- 一条轨的中文视图 ----
// raw：decodeSamples 解出来的原始条（同 lines.js buildLines 的输入）。
// 返回 { lines: 整句, bilingual: 是不是中英双语轨, style: 'punct' | 'bare', script: 'Hans' | 'Hant' | 'mixed' | null（按整句的字判简繁，选轨用） }
// breaksOut（只有 media.js partialLines 传）：空数组，记下 mergeSentencesZh 的同步断点，再记 .ratio / .n（风格统计，句末带标点的占比和参与统计的条数）；
// 不影响返回值
export function zhLinesOf(raw, breaksOut = null) {
  const split = splitBilingual(buildLinesZh(raw));
  const style = zhStyleOf(split.lines);
  if (breaksOut) {
    const { ended, n } = zhStyleStat(split.lines);
    breaksOut.ratio = n ? ended / n : 0;
    breaksOut.n = n;
  }
  const lines = mergeSentencesZh(split.lines, { style, ...(breaksOut ? { breaksOut } : null) });
  return { lines, bilingual: split.bilingual, style, script: detectHanScript(lines) };
}
