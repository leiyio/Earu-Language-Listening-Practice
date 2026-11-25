import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.js';

// 整个窗口都能接收拖入的文件（逻辑在 useFileDrop，首页的「本地视频」标签也用它，不另写一套）。
// disabled：关着时不收——但照样拦下浏览器的默认动作，不然拖进来的视频会被浏览器直接打开、把整个页面换掉
// 返回 over：正拖着文件在窗口上方（画「松开鼠标打开视频」那层用）
export function useFileDrop(onFile, disabled = false) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    if (disabled) {
      const block = (e) => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; } };
      window.addEventListener('dragover', block);
      window.addEventListener('drop', block);
      return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block); };
    }
    const enter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); };
    const leave = (e) => { if (!hasFiles(e)) return; if (--depth.current <= 0) { depth.current = 0; setOver(false); } };
    const overFn = (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const f = e.dataTransfer.files[0];
      // 句柄必须在 drop 事件里同步要，过了这一刻就拿不到了
      const item = Array.from(e.dataTransfer.items || []).find((i) => i.kind === 'file');
      const handle = item?.getAsFileSystemHandle?.();
      if (f) onFile(f, { handle });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [onFile, disabled]);

  return over;
}

// 拖入时盖在页面上的那一层
export function DropOverlay() {
  return <div className="drop-overlay"><div>{t('dropRelease')}</div></div>;
}

// className：拼在外层 .app 上（窄屏看视频时 m-watch：横着拿只看片、顶栏藏掉，见 styles.css）
export default function DropZone({ onFile, disabled = false, className = '', children }) {
  const over = useFileDrop(onFile, disabled);
  return (
    <div className={className ? `app ${className}` : 'app'}>
      {children}
      {over && !disabled && <DropOverlay />}
    </div>
  );
}
