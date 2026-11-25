// 长句替她先摆 / 先填几个词：按难度定。排序的预摆、听写的预填都从这里拿数，别处不再自己算。
// 挑哪几个在 core/dictation/prefill.js pickPresets（两边同一套），这里是数和种子。
// 规则：句子超过 free 个词才开始，之后每多 every 个词多 1 个。基础（middle）：8 个词以内不摆，每多 2 个多 1 个。
//   15 词：入门 5、基础 4、进阶 2、挑战 1；23 词：入门 9、基础 8、进阶 5、挑战 3。
// 学中文没有难度档，一律按基础算。计分不减：上报和服务端数词都是整句词数。
export const PRESET_RULES = Object.freeze({
  primary: Object.freeze({ free: 6, every: 2 }),
  middle: Object.freeze({ free: 8, every: 2 }),
  high: Object.freeze({ free: 10, every: 3 }),
  college: Object.freeze({ free: 12, every: 4 }),
});

// 学中文、日语也跟着难度档走
export function presetRuleOf(grade, lang) {
  return PRESET_RULES[grade] || PRESET_RULES.middle;
}

export function presetCountFor(wordCount, grade, lang) {
  const r = presetRuleOf(grade, lang);
  const n = Number(wordCount) || 0;
  return n <= r.free ? 0 : Math.ceil((n - r.free) / r.every);
}

// 种子：句子文字的 FNV-1a。绝不能用 Math.random、也不能用带时间的 key：
// 同一句每次进来、「重新打乱」之后，固定显示的必须是同一批词、同一批位置，否则她重做一遍看到的是另一道题。
// 原来在 sort/puzzle.js，挪过来是因为听写的挑法（prefill.js）要用、排序又要调那个挑法，放在排序里就绕成一圈（puzzle.js 照旧转出）
export function presetSeed(text) {
  let hash = 0x811c9dc5;
  const value = String(text ?? '');
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return hash >>> 0;
}

// mulberry32（C:5078-5088）：种子定了，序列就定了。
export function seededRandom(seed) {
  let state = (seed || 1) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
