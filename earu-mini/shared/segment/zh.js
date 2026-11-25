// 中文切词（「全语言练习」切词块）。
// 做法：不重写，沿用 shared/zhSort.js（Intl.Segmenter 加 R0–R4 规则：补切代词、〇、儿化、叠字、数字加量词），
// 包成 registerSegmenter 要的形状：text → [{text, s, e, w}]，拼起来等于原文，标点、空白是 w:false。
// 繁体、简体是同一门语言：Intl 对繁体一样切；词卡词典 zh.db 只有简体，查词前用 toSimplified 转（字对字，shared/segment/t2s.js）。
// dictSplit 在查词卡时把复合词（「演唱会」「电影院」）按词典再切一遍。
import { segmentSpans } from '../zhSort.js';
import { toSimplified } from './t2s.js';

export { toSimplified };
export const SEG_VER_ZH = 'zg1';

const WORD = /[\p{L}\p{N}]/u;

export function segmentZh(text) {
  const s = typeof text === 'string' ? text : '';
  const out = [];
  let at = 0;
  // 繁体先逐字转简体再切（t2s 字对字、长度不变，下标直接对回原文）：ICU 对繁体的词典不全（「看電影」不切）
  const simp = toSimplified(s);
  for (const w of segmentSpans(simp === s ? s : simp)) {
    if (w.s > at) out.push({ text: s.slice(at, w.s), s: at, e: w.s, w: false });
    const t = s.slice(w.s, w.e);
    out.push({ text: t, s: w.s, e: w.e, w: WORD.test(t) });
    at = w.e;
  }
  if (at < s.length) out.push({ text: s.slice(at), s: at, e: s.length, w: false });
  return out;
}

// 一个词词典里没有时，按词典再切成几个词：has(词) → 词典里有没有。
// 动态规划，优先「段数最少」，段数相同取最长的前段。全切不出来回 null。单字也要在词典里（避免切成一串不认识的字）。
export function dictSplit(word, has, { maxLen = 6 } = {}) {
  const cps = [...String(word ?? '')];
  const n = cps.length;
  if (n < 2) return null;
  const best = new Array(n + 1).fill(null);   // best[i] = 前 i 个字的最优切法 [段...]
  best[0] = [];
  for (let i = 1; i <= n; i += 1) {
    for (let j = Math.max(0, i - maxLen); j < i; j += 1) {
      if (!best[j]) continue;
      const piece = cps.slice(j, i).join('');
      if (!has(piece)) continue;
      const cand = [...best[j], piece];
      if (!best[i] || cand.length < best[i].length) best[i] = cand;
    }
  }
  return best[n] && best[n].length > 1 ? best[n] : null;
}

// 词卡查词的候选：按顺序试，查到就用。繁体先转简体；整词查不到再按词典切。
export function zhLookupCandidates(word) {
  const w = String(word ?? '');
  const s = toSimplified(w);
  return s === w ? [w] : [s, w];
}
