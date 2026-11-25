import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.js';
import { checkVideoFile } from '../core/fileCheck.js';
import { fileFromEntry, listHistory, recentFileErrorKey, removeEntry, touchEntry } from '../core/history.js';

// 首页打开本机视频的全部动作（点选的、拖进来的、最近播放里点的），只在本机：
// 校验文件头 → 记一条播放记录（拿得到文件句柄就连句柄记，下次能从最近播放直接打开）→ 交给播放页。
// note：要给用户看的一句话（文件不对、读不了）；playing：正在放的这一部 { file, kind, ent, key }

// 文件校验没过的那句话（站里现成的文案，跟着界面语言）
const badFileText = (chk) => {
  const ext = chk.ext || '?';
  if (chk.error === 'badExt') return t('errBadExt', { ext });
  if (chk.error === 'mismatch') return t('errMismatch', { ext, sniffed: chk.sniffed?.toUpperCase() });
  return t('errBadHeader', { ext: ext.toUpperCase() });
};

export function useLocalHome() {
  const [recent, setRecent] = useState([]);
  const [note, setNote] = useState(null);       // { text }
  const [playing, setPlaying] = useState(null);
  const busy = useRef(false);
  const seq = useRef(0);

  const refresh = useCallback(() => listHistory()
    .then((l) => { setRecent(l); return l; }), []);
  useEffect(() => { refresh(); }, [refresh]);
  // 从播放页回来（页面从缓存还原、标签页重新可见）再读一次：刚看过，进度变了
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('pageshow', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('pageshow', again); document.removeEventListener('visibilitychange', again); };
  }, [refresh]);

  // file：File；handle：FileSystemFileHandle 或它的 Promise（拖入时拿到的）
  const openLocal = useCallback(async (file, { handle } = {}) => {
    if (!file || busy.current) return;
    busy.current = true;
    setNote(null);
    try {
      const chk = await checkVideoFile(file);
      if (!chk.ok) { setNote({ text: badFileText(chk) }); return; }
      const h = await Promise.resolve(handle).catch(() => null);
      // 记不上也照放，只是不存进度
      // 记录这一步最多等 3 秒：卡住就当记不上，不拦着播放，也不让后面每次打开都被挡住
      const ent = await Promise.race([
        touchEntry(file, chk.kind, h?.kind === 'file' ? h : null),
        new Promise((r) => { setTimeout(r, 3000, null); }),
      ]);
      setPlaying({ file, kind: chk.kind, ent, key: ++seq.current });
    } catch {
      setNote({ text: t('ovCrash') });
    } finally {
      busy.current = false;
    }
  }, []);

  // 点最近播放的一张卡：必须在点击里把读取许可要到手
  const openRecent = useCallback(async (e) => {
    setNote(null);
    let file;
    try {
      file = await fileFromEntry(e);
    } catch (err) {
      setNote({ text: t(recentFileErrorKey(err), { name: e.name }) });
      return;
    }
    openLocal(file);
  }, [openLocal]);

  const remove = useCallback(async (e) => { await removeEntry(e.id); refresh(); }, [refresh]);
  // 关掉播放页回到首页：最近播放的进度、缩略图刚在播放时存过，等存完再读一遍
  const closePlayer = useCallback(() => { setPlaying(null); setTimeout(refresh, 500); }, [refresh]);

  // 打不开时留在页面上的一句话（不会自己消失，下次打开文件时清掉）
  const fail = useCallback(() => setNote({ text: t('ovCrash') }), []);

  return { recent, note, openLocal, openRecent, remove, playing, closePlayer, fail };
}
