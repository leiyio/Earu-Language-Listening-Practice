// 主线程入口：起一个 Worker 解析本机文件。
// kind：'mkv' | 'mp4'。
// handlers: onProbe({container, duration, tracks}) / onProgress(0~1) / onSubs({subs, zhSubs, cueTimes, tracks}) / onError(message, code, info)
// opts（可选）：only = 只取这几条轨号；pickTracks(probe) = probe 完以后主线程按轨道信息挑要取哪几条（回轨号数组，回 null / 不回就取全部，可以返回 Promise）
// 返回 cancel()，换文件时调用。

// kind / container 的各种写法 → 'mkv' | 'mp4' | null；不认识就看文件名
function kindOf(kind, name) {
  const s = `${kind || ''} ${/\.([^.]+)$/.exec(name || '')?.[1] || ''}`.toLowerCase();
  if (/mkv|matroska|webm/.test(s)) return 'mkv';
  if (/mp4|m4v|mov|quicktime/.test(s)) return 'mp4';
  return null;
}

export function openMedia(file, kind, handlers, opts = {}) {
  const worker = new Worker(new URL('./media.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'probe') {
      handlers.onProbe?.(data);
      if (opts.pickTracks) {
        // Worker 在等：挑好以后回 go（pickTracks 抛错就当全取）
        Promise.resolve().then(() => opts.pickTracks(data)).catch(() => null)
          .then((only) => worker.postMessage({ type: 'go', only: only ? [...only] : null }));
      }
    }
    if (data.type === 'progress') handlers.onProgress?.(data.value);
    else if (data.type === 'subs') { handlers.onSubs?.(data); worker.terminate(); }
    else if (data.type === 'error') {
      handlers.onError?.(data.message, data.code || null, { code: data.code || null, reason: data.reason || null, status: data.status || null });
      worker.terminate();
    }
  };
  worker.onerror = (e) => { handlers.onError?.(e.message || 'worker error', null, { code: null, reason: null, status: null }); worker.terminate(); };
  worker.postMessage({ file, kind: kindOf(kind, file.name), only: opts.only ? [...opts.only] : null, pick: !!opts.pickTracks });
  return () => worker.terminate();
}
