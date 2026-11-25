// 在 Worker 里解析视频，主线程只管界面。消息协议见 openMedia.js。本机 File 直接读，不联网。

import { probeMedia, publicTracks, textTracksOf, extractSamples, subtitlesOf } from './media.js';

// 主线程回「go」：probe 以后等主线程挑好要哪几条轨再取（openMedia 的 opts.pickTracks）
let goWait = null;

self.onmessage = ({ data }) => {
  if (data.type === 'go') {
    goWait?.(data.only);
    goWait = null;
  } else run(data);
};

// file：本机 File。only：只取这几条轨；pick：true 表示 probe 完以后等主线程回 { type: 'go', only }
async function run({ file, kind, only = null, pick = false }) {
  try {
    const probe = await probeMedia(file, kind);
    const pub = { container: probe.container, duration: probe.duration, fragmented: !!probe.fragmented, title: probe.title || null, tracks: publicTracks(probe) };
    const wait = pick ? new Promise((res) => { goWait = res; }) : null;
    self.postMessage({ type: 'probe', ...pub });
    if (wait) only = await wait;
    let last = 0;
    const onProgress = (p) => {
      if (p - last >= 0.01 || p === 1) { last = p; self.postMessage({ type: 'progress', value: p }); }
    };
    const tracks = probe.tracks;
    const textTracks = textTracksOf(tracks, only);
    const samples = new Map();
    if (textTracks.length) {
      const got = await extractSamples(file, probe, textTracks.map((t) => t.id), onProgress);
      for (const t of textTracks) samples.set(t.id, got.get(t.id) || []);
    }
    // zhSubs / cueTimes：subtitlesOf 顺手算出来的几份附带结果，交回主线程一并带着
    const zhSubs = {};
    const cueTimes = {};
    const subs = subtitlesOf(pub.container, textTracks, samples, zhSubs, cueTimes);
    self.postMessage({ type: 'subs', subs, zhSubs, cueTimes, tracks: publicTracks({ tracks }) });
  } catch (e) {
    self.postMessage({ type: 'error', ...errOf(e) });
  }
}

const errOf = (e) => ({ message: String(e?.message || e), code: e?.code || null, reason: e?.reason || null, status: e?.status || null });
