// 中文排序题的文字规则：怎么洗、怎么切成词块、词块怎么对回原文、怎么数块、怎么归一化判重。
// 出题和计分共用这一份（web/src/core/sort/puzzleZh.js 出题），纯 ESM、无依赖，Node 和浏览器都能跑。
// 英文那份是 shared/sortText.js。
//
// 词块从哪来：
//   - 有 AI 标注就用标注的词（entry.anno 的 w）；
//   - 没有标注时，用本机 Intl.Segmenter 加下面几条规则出题（segmentLocal），计分时同样用它现算词块数；
//   本机切不能当正式的：ICU 会切出错词（她/说明/天、太好/吃了），各浏览器 ICU 版本也不一样。
// 「粘小词」不存，按 (词, 拼音) 现算：改规则只升 SORT_VER_ZH。
//
// 【版本号】改了下面任何会影响「洗出什么、切出哪些块、几块」的规则（sortTextZhMap、segmentLocal 的 R0–R4、粘小词、zhPuzzleParts 的模板），
// 都要把 SORT_VER_ZH 加一，每条中文计分记录都带上它（同英语 SORT_VER 的做法）。
// zs1：第一版。
import { keyOf, zeroFix, zhLabelLen, ZH_DASH_START } from './zhText.js';

export const SORT_VER_ZH = 'zs1';

const HAN = /\p{Script=Han}/u;
const HAS_WORD = /[\p{L}\p{N}]/u;

// ---- 排序清洗 ----
// 逐行去掉：行首的对白分隔号（「－你去哪儿？」）、行首的说话人标签（「老王：你给我站住！」，zhText.js zhLabelLen）、
// 行尾空白；剥完没有字母数字的行整行去掉。多人对白的换行留着（界面按换行显示，同英文）。
// 和英文 sortText 不同，这里不剥注释括号：中文整句在合句时（zm2，zhLinesOf）已经剥过。
// 返回 { clean, keep }：keep[k] 是原文第 k 个 UTF-16 码元有没有留下来，clean 就是留下来的码元按顺序接起来
// （所以词块在原文里的位置能直接换算到 clean 里，zhTiles 只留整块都还在的词）。
// 幂等：sortTextZh(sortTextZh(x)) === sortTextZh(x)。每一行反复剥「分隔号 / 标签 / 空白」到剥不动为止（不设层数上限：
// 设了上限，叠了 21 层的「王：王：…」第一遍剥不完、第二遍还会剥），所以第二遍什么都剥不掉。
export function sortTextZhMap(text) {
  const s = typeof text === 'string' ? text : '';
  const keep = new Array(s.length).fill(false);
  let lineStart = 0;
  let kept = 0;   // 已经留下了几行（第二行起，行前的换行符留着）
  while (lineStart <= s.length) {
    let lineEnd = s.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = s.length;
    const line = s.slice(lineStart, lineEnd);
    let a = 0;
    for (;;) {   // 每剥一次 a 至少前进一个字符，一定会停
      const rest = line.slice(a);
      const ws = /^\s+/.exec(rest);
      if (ws) { a += ws[0].length; continue; }
      const dash = ZH_DASH_START.exec(rest);
      if (dash && dash[0].length) { a += dash[0].length; continue; }
      const label = zhLabelLen(rest);
      if (label) { a += label; continue; }
      break;
    }
    let b = line.length;
    while (b > a && /\s/.test(line[b - 1])) b -= 1;
    if (HAS_WORD.test(line.slice(a, b))) {
      if (kept > 0) keep[lineStart - 1] = true;   // 这一行前面的换行符
      for (let k = lineStart + a; k < lineStart + b; k += 1) keep[k] = true;
      kept += 1;
    }
    if (lineEnd >= s.length) break;
    lineStart = lineEnd + 1;
  }
  let clean = '';
  for (let k = 0; k < s.length; k += 1) if (keep[k]) clean += s[k];
  return { clean, keep };
}

export const sortTextZh = (t) => sortTextZhMap(t).clean;
// 去重键（同一句不重复计分）：洗完再只留字母数字，和怎么切词无关（「你好，我是李明。」和「你好 我是李明」一样）
export const normZh = (t) => keyOf(sortTextZh(t));
// 能不能出题（「第 N / M 句」的 M、practicable）：洗完还有字母数字
export const hasWordsZh = (t) => HAS_WORD.test(sortTextZh(t));

// ---- 本机切词 ----
// Intl.Segmenter('zh', {granularity:'word'}) 的词段，再补四条规则：
//   R0 拆代词前缀：ICU 常把「我爱」「他说」切成一个词，代词（我你您他她它咱妳）+ 汉字开头、又不是下面 KEEP 里的词（或以它开头），拆成代词和剩下的；
//      只拆 2–3 个字的词：四字的多半是 ICU 认对了的成语（你死我活、我行我素、我见犹怜），拆了反而错；
//   R2 儿 / 兒 粘到前一个词上（一会 + 儿、哪 + 儿）；后面紧跟 子 童 女 孙 媳 科 歌 戏 时 的不粘：那是「儿子」「儿童」的儿
//      （逐字切时「我儿子」不能切成「我儿 / 子」）；
//   R3 同一个字的叠字合并（哈 哈 哈、看 看、慢 慢）；
//   R4 阿拉伯数字 + 单字量词 / 单位合并（10 点、2023 年、28 岁、3 个）。
// 粘小词（的 了 吗……）不在这里做，归 zhTiles，因为 AI 的词也要粘。
// 只粘「紧挨着」的两段（原文里中间没有任何字符），隔了空格、标点的不动。
// 没有 Intl.Segmenter（Firefox 125 以前）或构造报错：汉字逐个算一个词，拉丁字母串、数字串各算一个，再做 R0–R4。
// 词里能夹哪些连接符，两条路都用下面 alignWords 的同一个判断（joinsAt），所以切出来的词一定对得回原文。
// 「○」当「〇」写的（二○○八年）按〇切（zhText.js zeroFix）：判断、切词都在换过的串上做，词还是取原文那一段。
// segmenter 选项：不传用本机的；传 null 当作没有（测试用）；也可以传一个有 segment() 方法的对象。
const PRON = new Set([...'我你您他她它咱妳']);
const KEEP = ['你好', '您好', '我们', '你们', '他们', '她们', '它们', '咱们', '您们', '妳们', '我們', '你們', '他們', '她們', '它們', '咱們', '您們', '妳們',
  '他人', '我国', '我國', '他国', '他國', '他乡', '他鄉', '他妈的', '他媽的', '你我', '自我', '妳好'];
const ER = new Set(['儿', '兒']);
// 「儿」后面跟这些字时是「儿子」「儿童」……的儿，不是儿化
const ER_WORD_NEXT = new Set([...'子童女孙孫媳科歌戏戲时時']);
// R4 的量词、单位：「10点」连成一个词
export const NUM_UNITS = new Set([...'年月日号號点點分秒岁歲个個块塊元次天周週楼樓层層万萬亿億千百']);
const UNIT = NUM_UNITS;
const DIGITS = /^[0-9０-９]+(?:[.,．][0-9０-９]+)*$/;   // 半角、全角数字（全角 ０-９、全角点 ．）

let defaultSeg;   // undefined = 还没试过；null = 这个环境没有
function localSegmenter() {
  if (defaultSeg === undefined) {
    try {
      defaultSeg = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
    } catch {
      defaultSeg = null;
    }
  }
  return defaultSeg;
}

// 一段里真正的「词」：字母数字的「字」连成一串，中间可以夹 joinsAt 认的连接符（U.S.、don't、哈利·波特、1,000、10:30）；别的标点切开。
// split（没有 Intl.Segmenter 时）：再按「一个汉字 / 一串非汉字的字母 / 一串数字」切开（iPhone15 → iPhone、15）。
// → [{t, s, e}]，下标加上 base（这一段在整句里的起点）
const kindOf = (c) => (HAN.test(c) ? 'han' : /^\p{N}/u.test(c) ? 'num' : 'let');
function wordRuns(str, base, split) {
  const units = unitsOf(str);
  const out = [];
  let a = -1;
  let last = -1;
  const close = () => {
    if (a >= 0) out.push({ t: str.slice(units[a].s, units[last].e), s: base + units[a].s, e: base + units[last].e });
    a = -1;
  };
  units.forEach((x, u) => {
    if (x.k) {
      if (a >= 0 && split && (kindOf(x.c) === 'han' || kindOf(x.c) !== kindOf(units[last].c))) close();
      if (a < 0) a = u;
      last = u;
    } else if (a >= 0 && !joinsAt(units, u)) close();
  });
  close();
  return out;
}

// 原文 → [{t, s, e}]（s、e 是 UTF-16 下标），没做 R0–R4。
// ICU 会把「10:30」「1,000」切成 10 / : / 30 几段：两段数字中间只隔一个数字连接符（, : ： .）的接回一个词（和逐字切、alignWords 同一个口径）。
const lastDigit = (t) => DIGIT_KEY.test(keyOf(t.slice(-1)));
const firstDigit = (t) => DIGIT_KEY.test(keyOf(t[0]));
function rawPieces(s, seg) {
  if (seg) {
    try {
      const out = [];
      for (const x of seg.segment(s)) {
        for (const w of wordRuns(x.segment, x.index, false)) {
          const prev = out[out.length - 1];
          const gap = prev ? s.slice(prev.e, w.s) : '';
          if (gap.length === 1 && (NUM_JOIN.has(gap) || gap === '.') && lastDigit(prev.t) && firstDigit(w.t)) {
            prev.t = s.slice(prev.s, w.e);
            prev.e = w.e;
          } else out.push(w);
        }
      }
      return out;
    } catch {
      // 传进来的 segmenter 不好用：退回逐字切
    }
  }
  return wordRuns(s, 0, true);
}

function splitPronoun(w) {
  const cps = [...w.t];
  if (cps.length < 2 || cps.length > 3 || !PRON.has(cps[0]) || !HAN.test(cps[1]) || KEEP.some((k) => w.t.startsWith(k))) return [w];
  const n = cps[0].length;
  return [{ t: cps[0], s: w.s, e: w.s + n }, { t: w.t.slice(n), s: w.s + n, e: w.e }];
}

function mergeable(prev, cur, z) {
  if (prev.e !== cur.s) return false;
  if (ER.has(cur.t) && HAN.test([...prev.t].pop()) && !ER_WORD_NEXT.has(z[cur.e])) return true;   // R2
  const all = [...(prev.t + cur.t)];
  if (all.every((c) => c === all[0]) && HAN.test(all[0])) return true;                  // R3
  return DIGITS.test(prev.t) && [...cur.t].length === 1 && UNIT.has(cur.t);             // R4
}

// 在 zeroFix 换过的串上切（ICU 也喂换过的，「二○○八年」才不会切成「二 / 八年」），t 最后取回原文那一段
export function segmentSpans(text, segmenter) {
  const s = typeof text === 'string' ? text : '';
  const z = zeroFix(s);
  const seg = segmenter === undefined ? localSegmenter() : segmenter;
  const out = [];
  for (const w of rawPieces(z, seg).flatMap(splitPronoun)) {
    const prev = out[out.length - 1];
    if (prev && mergeable(prev, w, z)) { prev.t += w.t; prev.e = w.e; continue; }
    out.push({ ...w });
  }
  return z === s ? out : out.map((w) => ({ ...w, t: s.slice(w.s, w.e) }));
}

// → string[]：按原文顺序的词，每个词都是原文的一段（原样照抄），拼起来覆盖原文所有的字母数字。
export function segmentLocal(text, { segmenter } = {}) {
  return segmentSpans(text, segmenter).map((w) => w.t);
}

// ---- 词对回原文 ----
// 连接符：词中间允许夹的这几个（U.S.、don't、哈利·波特、Jean-Luc）。这里多认几个间隔号：
// ‧（U+2027）、・（U+30FB）是繁體、日式排版的外国人名用的，•（U+2022）、･（U+FF65）、∙（U+2219）是网文、字幕组常拿来代替 · 的，
// AI 照抄过来（提示词要人名保持一个词）不该算错。
export const CONNECTORS = new Set(["'", '’', '·', '‧', '・', '•', '･', '∙', '.', '-']);
// . 和 - 夹在两个汉字之间是标点（「好了.走吧」的句号、「我想-算了」的破折号），不是连接符
const DOT_LIKE = new Set(['.', '-']);
// 数字里的千分位、钟点：只在两边都是数字时算连接符（1,000、10:30、10：30）
const NUM_JOIN = new Set([',', ':', '：']);
const DIGIT_KEY = /^\p{Nd}+$/u;
// 看不见的格式字符（零宽空格、LRM、软连字符……）：夹在词中间不算断开
const CF = /^\p{Cf}+$/u;
// 一个「字」：一个码点连同后面的组合附加符（é 拆成 e + ◌́ 的也算一个）
const UNIT_G = /[^\p{M}]\p{M}*|\p{M}+/gu;

// → [{c, s, e, k}]：c 是这个字，s、e 是 UTF-16 下标，k 是它的 keyOf（标点、空白、格式字符是 ''）
function unitsOf(str) {
  const units = [];
  for (const m of str.matchAll(UNIT_G)) units.push({ c: m[0], s: m.index, e: m.index + m[0].length, k: keyOf(m[0]) });
  return units;
}

// 第 u 个字（不是字母数字）能不能当词中间的连接符：两边（跳过格式字符）紧挨着的都得是字母数字，
// 所以连着的两个连接符（省略号 ...、--）一定断开；再按上面的口径看是哪种连接符。
function joinsAt(units, u) {
  const near = (d) => {
    let v = u + d;
    while (units[v] && CF.test(units[v].c)) v += d;
    return units[v];
  };
  const a = near(-1);
  const b = near(1);
  if (!a?.k || !b?.k) return false;
  const c = units[u].c;
  if (CF.test(c)) return true;
  if (CONNECTORS.has(c)) return !(DOT_LIKE.has(c) && HAN.test(a.c) && HAN.test(b.c));
  return NUM_JOIN.has(c) && DIGIT_KEY.test(a.k) && DIGIT_KEY.test(b.k);
}

// 按 keyOf 逐字对：每个词在原文里找一段（跳过词之间的空格、标点），段内只许夹连接符（joinsAt），不跨空格、换行、别的标点。
// → [{s, e}]（UTF-16 下标，和 words 一一对应）；对不上（改了字、漏了字、多了字、跨了标点、词是空的）回 null。
// 全角半角、大小写不算不一样（全角「１２月」对得上词「12月」）；「○」当「〇」写的按〇对（zeroFix）。
// words：数组，或者存盘的那种单空格连起来的串（anno 的 w 原样传进来也认，空串 = 没有词）。
export function alignWords(text, words) {
  const s = typeof text === 'string' ? text : '';
  if (typeof words === 'string') words = words.trim() ? words.trim().split(/\s+/) : [];
  if (!Array.isArray(words)) return null;
  const units = unitsOf(zeroFix(s));
  const out = [];
  let u = 0;
  for (const w of words) {
    // 词里的 ○ 一律当〇（词可能被切成「二 / ○○ / 八年」，单看一个词看不出前后是不是汉字数字；原文那边按 zeroFix 的口径）
    const wk = keyOf(typeof w === 'string' ? w.replace(/[○◯]/g, '〇') : '');
    if (!wk) return null;
    while (u < units.length && !units[u].k) u += 1;   // 词之间的空白、标点
    if (u >= units.length) return null;
    const start = units[u].s;
    let acc = '';
    for (;;) {
      if (u >= units.length) return null;
      const x = units[u];
      if (!x.k && !joinsAt(units, u)) return null;
      acc += x.k;
      u += 1;
      if (acc === wk) { out.push({ s: start, e: x.e }); break; }
      if (!wk.startsWith(acc)) return null;
    }
  }
  return out;
}

// ---- 词块 ----
// 粘小词：全由这些字组成的词粘到前一块上——
//   语气词：的 吗 呢 吧 啊 呀 嘛 啦 哦 喔 哇 呗 咯 喽 啰 哟（繁體 嗎 唄 嘍 囉 喲）；
//   了 着 过 著 過 得 地：拼音是轻声（5）才粘（我得走了的 děi、土地的 dì 不粘）；没有拼音时只粘 了 着 过 著 過；
//   单独一个「儿 / 兒」：AI 把儿化的儿切成了单独的词（一会 / 儿），拼音是 r 才粘（同 R2）；没有拼音时后面不跟 子 童……就粘。
// 只在两词紧挨（中间没有任何字符）、前一块含汉字、不在行首时粘（隔着标点、空格的不粘；行首的「啊」自己一块）；儿化还要前一块最后一个字是汉字。
const PARTICLE = new Set([...'的吗呢吧啊呀嘛啦哦喔哇呗咯喽啰哟嗎唄嘍囉喲']);
const NEUTRAL_ONLY = new Set([...'了着过著過得地']);
const NEUTRAL_NO_PY = new Set([...'了着过著過']);

// 原文里每个汉字（按 UTF-16 下标）是第几个汉字：拼音按这个顺序一个字一个音节
function hanIndex(s) {
  const idx = new Map();
  let n = 0;
  let off = 0;
  for (const c of s) {
    if (HAN.test(c)) idx.set(off, n++);
    off += c.length;
  }
  return { idx, n };
}

function isSmall(w, py, hidx, z, prev) {
  if (ER.has(w.t)) {
    if (!HAN.test([...prev.t].pop())) return false;
    return py ? py[hidx.get(w.s)] === 'r' : !ER_WORD_NEXT.has(z[w.e]);
  }
  let off = w.s;
  for (const c of w.t) {
    if (!PARTICLE.has(c)) {
      if (!NEUTRAL_ONLY.has(c)) return false;
      if (py) {
        const syl = py[hidx.get(off)];
        if (typeof syl !== 'string' || !syl.endsWith('5')) return false;
      } else if (!NEUTRAL_NO_PY.has(c)) return false;
    }
    off += c.length;
  }
  return w.t.length > 0;
}

// 词的位置：words 对得上原文就用它；没给（null / undefined）或对不上就用本机切的，拼音也不用了（对不上的拼音不知道该归哪个字）
function spansOf(s, words, py) {
  if (words != null) {
    const sp = alignWords(s, words);
    if (sp) return { spans: sp.map((x) => ({ t: s.slice(x.s, x.e), s: x.s, e: x.e })), py };
  }
  return { spans: segmentSpans(s), py: null };
}

// → [{t, s, e}]：排序题的词块，按原文顺序；t 是原文那一段（原样），s、e 是在原文里的 UTF-16 下标。
// 只留排序清洗以后整块都还在的词（「王：王先生来了」标签的「王」不进词块、「王先生」进），再按上面的规则粘小词。
// words：词（AI 标注的 w，数组或存盘那种单空格连的串；或 segmentLocal 的结果），不传就本机切；py：逐字音节（数字调），可以不给。
// 判断（数汉字、粘小词）都在 zeroFix 换过的串上做，t 最后取回原文那一段。
export function zhTiles(text, words, py = null) {
  const s = typeof text === 'string' ? text : '';
  const z = zeroFix(s);
  const { keep } = sortTextZhMap(s);
  const hidx = hanIndex(z);
  let pys = typeof py === 'string' ? (py ? py.split(' ') : []) : Array.isArray(py) ? py : null;
  const sp = spansOf(z, words, pys);
  pys = sp.py && sp.py.length === hidx.n ? sp.py : null;
  const tiles = [];
  for (const w of sp.spans) {
    let all = true;
    for (let k = w.s; k < w.e; k += 1) if (!keep[k]) { all = false; break; }
    if (!all) continue;
    const prev = tiles[tiles.length - 1];
    if (prev && prev.e === w.s && HAN.test(prev.t) && isSmall(w, pys, hidx.idx, z, prev)) {
      prev.t = z.slice(prev.s, w.e);
      prev.e = w.e;
      continue;
    }
    tiles.push({ ...w });
  }
  return z === s ? tiles : tiles.map((t) => ({ ...t, t: s.slice(t.s, t.e) }));
}

// 排序题：{ clean, tiles, parts } | null（一个词块都没有就不出题）。
// parts 结构同 sortText.js parseTemplate：[{type:'literal', text} | {type:'slot', text, slotIndex}]，词块之间的空字面量省掉。
// 不变式：parts 的 text 按顺序接起来 === clean；tiles[k] === 第 k 个 slot 的 text。
export function zhPuzzleParts(text, words, py = null) {
  const s = typeof text === 'string' ? text : '';
  const { clean, keep } = sortTextZhMap(s);
  const tiles = zhTiles(s, words, py);
  if (!tiles.length) return null;
  const pos = new Array(s.length + 1);   // 原文下标 → clean 里的下标
  let n = 0;
  for (let k = 0; k < s.length; k += 1) { pos[k] = n; if (keep[k]) n += 1; }
  pos[s.length] = n;
  const parts = [];
  let cursor = 0;
  tiles.forEach((t, slotIndex) => {
    const a = pos[t.s];
    if (a > cursor) parts.push({ type: 'literal', text: clean.slice(cursor, a) });
    parts.push({ type: 'slot', text: t.t, slotIndex });
    cursor = pos[t.e];
  });
  if (cursor < clean.length) parts.push({ type: 'literal', text: clean.slice(cursor) });
  return { clean, tiles: tiles.map((t) => t.t), parts };
}

