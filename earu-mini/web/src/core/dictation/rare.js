// 听写预填、排序预摆（同一批）要挑「人名」和「比当前难度档更难的词」，这里回答两个问题：一个词在哪一档（wordBandOf）、某一格是不是人名（isNameAt）。
// 档的口径：COCA 词频排名 ≤2000 档 1（小学）、≤5000 档 2（中学）、≤10000 档 3（高中），再往后档 4（大学），
// 孩子常用词算档 1；「比难度档更难」＝ 词的档 > 难度档（GRADE_BAND）。表本身是 wordRank.gen.js。
//
// 表要单独加载（ensureWordRank，动态 import）：压缩后约 30KB，不该进首屏。
// 没加载好时 wordBandOf 回 null（「还不知道」），pickPresets 就只按句首句尾、人名和均匀分布挑（core/dictation/prefill.js）；
// useDictSession、useSortSession（学英语时）在第一次出题前等它（成功失败都往下走），所以正常情况下同一句每次挑的是同一批。
// 规则的数、挑的顺序都在 prefill.js，这里只管词。
import { stemsOf } from './stems.js';
import { nameRulesOf, hasWordRank } from './langRules.js';
import { lowerOf } from '../../../../shared/langProfile.js';

// 按语言：词频表按语言各存一张（en 是 COCA 档表 wordRank.gen.js，es 是 wordRank.es.gen.js，脚本 build-word-rank-es.mjs），
// ensureWordRank / wordRankReady / wordBandOf / nameFlags 多一个 lang 参数，不传＝英语，英语的行为一字不差。

export const GRADE_BAND = Object.freeze({ primary: 1, middle: 2, high: 3, college: 4 });
export const DEFAULT_GRADE = 'middle';
export const gradeBandOf = (grade) => GRADE_BAND[grade] || GRADE_BAND[DEFAULT_GRADE];

const tables = new Map();      // 语言 → Map 词 → 档（1~3），表里没有的是档 4
const loadings = new Map();    // 语言 → 正在加载的 Promise

// 这门语言有没有词频档表：没有（别的语言）就不用等、不用查；有的话装好了才是 true
export const wordRankReady = (lang = 'en') => !hasWordRank(lang) || tables.has(lang);

// 把 BANDS（[档1串, 档2串, 档3串]，空格连的词）装进来。测试可以塞一张小表；resetWordRank 清掉
export function setWordRank(bands, lang = 'en') {
  const m = new Map();
  (Array.isArray(bands) ? bands : []).forEach((s, i) => {
    for (const w of String(s || '').split(' ')) if (w) m.set(w, i + 1);
  });
  tables.set(lang, m);
}
export function resetWordRank() {
  tables.clear();
  loadings.clear();
}

// 动态加载词频表 → Promise<boolean>（装好了 true；加载不了 false，下次再调会重试）。已经装好的直接 true；没有表的语言直接 true
export function ensureWordRank(lang = 'en') {
  if (!hasWordRank(lang) || tables.get(lang)) return Promise.resolve(true);
  if (!loadings.has(lang)) {
    const load = lang === 'es' ? import('./wordRank.es.gen.js') : import('./wordRank.gen.js');
    loadings.set(lang, load.then((m) => {
      setWordRank(m.BANDS, lang);
      return true;
    }, () => {
      loadings.delete(lang);
      return false;
    }));
  }
  return loadings.get(lang);
}

// 纯字母词（已小写、已去音标符号）→ 档 1~4：自己在表里就用自己的档；不在就折回规则原形，取其中最常用的一档；都不在是档 4
function bandOfPlain(w) {
  const table = tables.get('en');
  const own = table.get(w);
  if (own) return own;
  let best = 0;
  for (const s of stemsOf(w)) {
    const b = table.get(s);
    if (b && (!best || b < best)) best = b;
  }
  return best || 4;
}

// 缩写后缀：'s（所有格、is、has）、're、've、'll、'd、'm、'em → 看前面那个词的档；n't 一律档 1（don't、can't、won't 都是最常用的）
const CONTRACTION_TAIL = new Set(['s', 're', 've', 'll', 'd', 'm', 'em', 'all']);

const stripMarks = (s) => s.normalize('NFD').replace(/\p{M}+/gu, '');

// 一个词位的文字 → 档（1~4）；表还没加载是 null。
// 数字（25、2nd、1990s）和数字词位里的英文数（twenty-five）都算档 1：不是生僻词，不该被当成「比难度档更难」；
// 连字符、空格连着的几块（数字词位 twenty five 之外的 well-known 一类）取最生僻的一块；带撇号的缩写按上面那条；
// 变音符号先去掉（café → cafe）；去完还有非 a-z 的字（别的文字）当档 4
export function wordBandOf(text, lang = 'en') {
  if (lang === 'es') return wordBandEs(text);
  if (!tables.get('en')) return null;
  let w = String(text ?? '').replace(/[’‘]/g, "'").trim().toLowerCase();
  if (!w) return null;
  if (/^\d/.test(w)) return 1;
  w = stripMarks(w);
  if (/[-\s]/.test(w)) {
    let worst = 1;
    for (const part of w.split(/[-\s]+/).filter(Boolean)) {
      const b = wordBandOf(part, lang);
      if (b === null) return null;
      if (b > worst) worst = b;
    }
    return worst;
  }
  const k = w.indexOf("'");
  if (k >= 0) {
    if (w.endsWith("n't")) return 1;
    const head = w.slice(0, k);
    const tail = w.slice(k + 1);
    if (CONTRACTION_TAIL.has(tail) && head) return /^[a-z]+$/.test(head) ? bandOfPlain(head) : 4;
    w = w.replace(/'/g, '');      // o'clock → oclock、ma'am → maam：表里多半没有，就是档 4
  }
  return /^[a-z]+$/.test(w) ? bandOfPlain(w) : 4;
}

// 西语：词不去重音（重音是词的一部分，ñ 和 n 是两个词），NFC 小写后直接查表（表是表面形，变位形各自有档，不折原形）；
// 数字档 1；连字符 / 空格连着的几块取最生僻的一块；表里没有的（含带撇号、别的文字）是档 4；表还没加载是 null
function wordBandEs(text) {
  const table = tables.get('es');
  if (!table) return null;
  const w = String(text ?? '').replace(/[’‘]/g, "'").trim().toLowerCase().normalize('NFC');
  if (!w) return null;
  if (/^\d/.test(w)) return 1;
  if (/[-\s]/.test(w)) {
    let worst = 1;
    for (const part of w.split(/[-\s]+/).filter(Boolean)) {
      const b = wordBandEs(part);
      if (b === null) return null;
      if (b > worst) worst = b;
    }
    return worst;
  }
  return table.get(w) || 4;
}

// ---- 人名 ----
// 句中大写开头的词（不在句首）当人名 / 专名处理：Tom、Paris、NASA、Monday。预填它们是因为听出来能猜、拼写没法猜。
// 不当人名的几个大写词：I 和它的缩写、称呼（Mr. Mrs. Dr. Mom Dad……后面跟的名字才是要预填的）。
// 整句全是大写（台词喊话、没恢复大小写）时大小写没有信息，一个都不当人名。
// （称呼表 notNames、缩写表 abbr 按语言放在 langRules.js nameRulesOf；西语的称呼是 señor、don、Dios 一类）
// 句末标点（可跟收尾引号括号），再跟空白和开头的引号括号破折号
const SENTENCE_GAP = /[.!?…。！？]['"’”»)\]]*\s*[\s'"“‘„«(\[¿¡\-–—♪]*$/u;
// 引号里的话开头也是句首（langRules.js 的 quoteOpen：逗号 / 冒号 / 分号后面跟开引号，西语还有 « ¿ ¡）

const hasLetter = (s) => /\p{L}/u.test(s);
const startsUpper = (s) => {
  const c = [...s.replace(/^[^\p{L}]+/u, '')][0];
  return !!c && c !== c.toLowerCase() && c === c.toUpperCase();
};
const allUpper = (s) => hasLetter(s) && s === s.toUpperCase() && s !== s.toLowerCase();

// layout：layoutOf 的结果 {slots, parts}。返回每个词位是不是人名的数组
export function nameFlags(layout, lang = 'en') {
  const R = nameRulesOf(lang);
  const slots = layout?.slots || [];
  const flags = slots.map(() => false);
  const cased = slots.filter((s) => hasLetter(s.text));
  if (cased.length >= 2 && cased.every((s) => allUpper(s.text))) return flags;
  // 每个词位前面（上一个词位之后）的固定文字，用来判断是不是句首
  const before = slots.map(() => '');
  let buf = '';
  let seen = false;
  for (const p of layout?.parts || []) {
    if (p.type === 'slot') {
      before[p.slotIndex] = seen ? buf : null;      // null = 第一个词位
      seen = true;
      buf = '';
    } else {
      buf += p.text;
    }
  }
  slots.forEach((slot, k) => {
    const text = slot.text;
    if (slot.value !== null && slot.value !== undefined) return;
    if (!/^\p{L}/u.test(text) || !startsUpper(text)) return;
    const low = lowerOf(lang, text).replace(/[’‘]/g, "'");
    if (R.notNames.has(low) || R.notName(low)) return;
    if (k === 0 || before[k] === null) return;
    if (R.quoteOpen.test(before[k])) return;
    if (SENTENCE_GAP.test(before[k])) {
      const prev = lowerOf(lang, slots[k - 1].text);
      const abbr = R.abbr.has(prev) || (prev.length === 1 && /\p{L}/u.test(prev));
      if (!abbr) return;
    }
    flags[k] = true;
  });
  return flags;
}

export const isNameAt = (layout, k, lang = 'en') => !!nameFlags(layout, lang)[k];
