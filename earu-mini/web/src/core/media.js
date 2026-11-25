// 打开一个视频文件：识别容器 → 列出轨道 → 提取所有可读的文本字幕轨 → 整理成句子列表。
// 不依赖 DOM / React，可以跑在 Worker 里，也可以直接用 Node 测试。

import { probeMkv, extractMkvSubs } from './container/mkv.js';
import { probeMp4, extractMp4Subs } from './container/mp4.js';
import { decodeSamples } from './subtitle/decode.js';
import { buildLines } from './subtitle/lines.js';
import { mergeSentences } from './subtitle/sentences.js';
import { zhLinesOf } from './subtitle/zhLines.js';
import { isZhCandidate } from '../../../shared/zhText.js';

export async function probeMedia(blob, kind) {
  const p = kind === 'mkv' ? await probeMkv(blob) : await probeMp4(blob);
  p.tracks.forEach((t, k) => { t.order = k; });
  return p;
}

// 取样本（容器里的字幕块，Map<轨号, [{start, end, data}]>）→ 整理成整句（subtitlesOf）
export function textTracksOf(tracks, only = null) {
  const pick = only && new Set(only);
  return tracks.filter((t) => t.type === 'subtitle' && t.kind === 'text' && (!pick || pick.has(t.id)));
}
export function extractSamples(blob, probe, ids, onProgress) {
  return probe.container === 'mkv' ? extractMkvSubs(blob, probe, ids, onProgress) : extractMp4Subs(blob, probe, ids, onProgress);
}
// textTracks 上照样写句数（trackLines）；zhOut：「像中文」的轨另算的中文视图；cueOut：每条轨合句之前每一条的起止
export function subtitlesOf(container, textTracks, samples, zhOut = null, cueOut = null) {
  const result = {};
  for (const t of textTracks) result[t.id] = trackLines(t, decodeSamples(samples.get(t.id) || [], t.codec, container), zhOut, cueOut);
  return result;
}
// 一条文本字幕轨解出来的字幕条 → 整句，给这条轨写上 cueCount / rawCount；zhOut 给了、这条又「像中文」时另算中文视图
function trackLines(t, raw, zhOut, cueOut = null) {
  const built = buildLines(raw);
  if (cueOut) cueOut[t.id] = cueTimesOf(built);
  const lines = mergeSentences(built);
  t.cueCount = lines.length;  // 整句数
  t.rawCount = raw.length;    // 原字幕条数
  if (zhOut && isZhCandidate(raw)) {
    const z = zhLinesOf(raw);
    zhOut[t.id] = z.lines;
    t.zh = { cueCount: z.lines.length, rawCount: raw.length, bilingual: z.bilingual, script: z.script, style: z.style };
  }
  return lines;
}

// 合句之前每一条的起止，平铺
export function cueTimesOf(built) {
  const out = new Float64Array(built.length * 2);
  built.forEach((c, i) => { out[2 * i] = c.start; out[2 * i + 1] = c.end; });
  return out;
}

// 去掉内部字段，只留界面需要的轨道信息（可以 postMessage）
export function publicTracks(probe) {
  return probe.tracks.map(({ _comp, _stbl, ...t }) => t);
}
