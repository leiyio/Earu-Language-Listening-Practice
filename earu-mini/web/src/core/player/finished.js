// 片子放完了没有：播放界面「放完黑屏 + 重播」（components/Player.jsx 的 end-cover）只问这里。
//   在线平台的内嵌播放器：<video> 设了 loop，浏览器不会放完；要由外部逻辑停在片尾，停的时候报进来（markHeld）。
//   本机文件：不设 loop，浏览器自己放完（video.ended）。
// 单句循环着（含循环的留白）不算放完：片尾归循环管，最后一句照常循环（loopsHere）。
import { loopsHere } from './sentencePlayer.js';

const held = new WeakSet();
const subs = new Set();

// endStop 停在片尾 / 不再停着时报进来
export function markHeld(video, on) {
  if (!video || held.has(video) === !!on) return;
  if (on) held.add(video); else held.delete(video);
  for (const fn of subs) { try { fn(video); } catch { /* 一个听的出错不影响别的 */ } }
}

export function isFinished(video) {
  return !!video && (held.has(video) || !!video.ended) && !loopsHere(video);
}

// held 变了就叫 fn(video)；返回取消函数。video 自己的事件（ended / play / seeking）由调用方去听
export function onHeldChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// 重播：回到开头接着放。拖进度条到 0 再按播放是同一回事（外部宿主停在片尾时，endStop 见位置离开片尾就不再停着）
export function replay(video) {
  if (!video) return;
  try { video.currentTime = 0; } catch { /* 还没元数据 */ }
  const p = video.play();
  if (p && p.catch) p.catch(() => {});
}
