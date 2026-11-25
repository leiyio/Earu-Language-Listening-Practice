import { useEffect, useState } from 'react';

// 轻量手机web版的判法：窗口窄到 760px 以下（同 desktop.css 收侧栏的那一档）。播放界面（LiteSkin）和首页（LiteApp）共用
export const MOBILE_Q = '(max-width: 760px)';
export const isMobileNow = () => typeof matchMedia === 'function' && matchMedia(MOBILE_Q).matches;

export function useMobile() {
  const [on, setOn] = useState(isMobileNow);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia(MOBILE_Q);
    const sync = () => setOn(mq.matches);
    mq.addEventListener('change', sync);
    sync();
    return () => mq.removeEventListener('change', sync);
  }, []);
  return on;
}
