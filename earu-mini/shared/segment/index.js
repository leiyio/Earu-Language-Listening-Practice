// 日语、中文切词的入口：import 一下就把 zh、ja 注册进 shared/langProfile.js 的 SEGMENTERS。
// 用法：import { segmentWords, tilesOf, tileCountOf, lookupCandidates } from '<shared>/segment/index.js'
import { registerSegmenter, segmenterOf } from '../langProfile.js';
import { segmentZh, zhLookupCandidates, SEG_VER_ZH, dictSplit } from './zh.js';
import { segmentJa, tilesJa, tileCountJa, jaLemmaCandidates, SEG_VER_JA } from './ja.js';
import { zhTiles } from '../zhSort.js';

registerSegmenter('zh', segmentZh);
registerSegmenter('ja', segmentJa);

export { segmentZh, segmentJa, tilesJa, tileCountJa, jaLemmaCandidates, zhLookupCandidates, dictSplit, SEG_VER_ZH, SEG_VER_JA };
export { toSimplified } from './t2s.js';
export const SEGMENT_LANGS = Object.freeze(['zh', 'ja']);

// 一句话的词（含标点空白，w:false）；这门语言没有切词器回 null
export const segmentWords = (learn, text) => { const f = segmenterOf(learn); return f ? f(text) : null; };
// 排序题的词块 [{t, s, e}]（zh 走 zhTiles 带粘小词，ja 走 tilesJa）
export const tilesOf = (learn, text) => (learn === 'ja' ? tilesJa(text) : learn === 'zh' ? zhTiles(text, segmentZh(text).filter((x) => x.w).map((x) => x.text)) : null);
export const tileCountOf = (learn, text) => (learn === 'ja' ? tileCountJa(text) : learn === 'zh' ? tilesOf('zh', text).length : 0);
// 词卡查词的候选（按顺序试）
export const lookupCandidates = (learn, word) => (learn === 'ja' ? jaLemmaCandidates(word) : learn === 'zh' ? zhLookupCandidates(word) : [String(word ?? '')]);
