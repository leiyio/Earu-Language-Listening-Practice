import { useEffect } from 'react';
import { updateEntry } from '../core/history.js';

// 播放时每 5 秒记一次进度；暂停、关页面、切走时也记。顺带截一张小缩略图给「最近播放」用。
export function useProgressSaver(videoRef, entryId) {
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !entryId) return;
    let lastSave = 0, lastThumb = 0;

    const thumb = () => {
      if (!v.videoWidth) return null;
      try {
        const c = document.createElement('canvas');
        c.width = 240;
        c.height = Math.round((240 * v.videoHeight) / v.videoWidth);
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, c.width, c.height);
        // 片头常是黑场：太暗的帧不要，等下一次再截
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 16) sum += px[i] + px[i + 1] + px[i + 2];
        if (sum / (px.length / 16) / 3 < 18) return null;
        return c.toDataURL('image/jpeg', 0.7);
      } catch { return null; }
    };

    const save = (force) => {
      const now = Date.now();
      if (!force && now - lastSave < 5000) return;
      if (!v.duration || v.currentTime < 1) return;
      lastSave = now;
      const patch = { position: v.currentTime, duration: v.duration, savedAt: now };
      if (force || now - lastThumb > 30000) {
        const img = thumb();
        if (img) { patch.thumb = img; lastThumb = now; }
      }
      updateEntry(entryId, patch);
    };

    const onTime = () => save(false);
    const onPause = () => save(true);
    const onHide = () => { if (document.visibilityState === 'hidden') save(true); };
    const onPageHide = () => save(true);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('pause', onPause);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      save(true); // 换文件 / 回首页前最后记一次
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('pause', onPause);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [videoRef, entryId]);
}
