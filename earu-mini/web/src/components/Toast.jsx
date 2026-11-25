import { useCallback, useEffect, useRef, useState } from 'react';

// 一条短提示，过几秒自己消失。用在两处：
//   · 点灰着的按钮（排序开关、提示、任务按钮）时把悬停提示那句话说出来——触屏没有悬停，灰按钮点了没反应就像坏了
//     （00 §1.5 有意改动 2、06 §5.2）；
//   · 学习设置存好了 / 没存上。
// 全屏时页面上的东西看不见，所以 App 把它挂在播放器舞台里（见 App.jsx）。
export const TOAST_MS = 2600;

// 回 [msg, show, hide]。hide：不等到点、马上收掉（手机版点最近播放的卡提示「请选择…」，选回来那一下就收，components/RecentList.jsx useRecentPick）
export function useToast() {
  const [msg, setMsg] = useState(null); // {text, id}
  const timer = useRef(0);
  const seq = useRef(0);
  const show = useCallback((text, ms = TOAST_MS) => {
    if (!text) return;
    clearTimeout(timer.current);
    seq.current += 1;
    setMsg({ text, id: seq.current });
    timer.current = setTimeout(() => setMsg(null), ms);
  }, []);
  const hide = useCallback(() => { clearTimeout(timer.current); setMsg(null); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [msg, show, hide];
}

// placement：'bottom'（侧栏布局，底部 28px）/ 'top'（浮动模式不全屏时，画面上部约 1/4 处：放底部会压住控制条和答题区，
// 放顶部会和顶部注释撞上，浮动模式-实现说明 §2.6）。全屏时 App 把它渲染进舞台（.stage .toast）
export default function Toast({ msg, placement = 'bottom' }) {
  if (!msg) return null;
  return <div className={`toast${placement === 'top' ? ' is-top' : ''}`} role="status" aria-live="polite" key={msg.id}>{msg.text}</div>;
}
