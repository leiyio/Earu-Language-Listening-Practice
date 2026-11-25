// 「宿主」接缝：网站里界面就挂在 document 上；嵌入第三方页面时，界面挂在页面里一个 closed 的 shadow root 里。
// 这个模块只回答几个「我在哪儿」的问题，默认实现（没人调 setHostRoot）和网站原来直接写 document / e.target 一字不差：
//   realTarget(e)      事件真正落在哪个元素上。挂在 document / window 上的监听，对 shadow DOM 里的事件拿到的 e.target 是宿主元素
//                      （实测：composedPath()[0] 在 closed 的 shadow root 外面也只到宿主），所以「点在不在我里面」的判断要先还原真正的目标：
//                      指针事件用 root.elementFromPoint(clientX, clientY)，键盘事件用 root.activeElement
//   insideEvent(el, e) 事件是不是落在 el 里面（el.contains(realTarget(e))）
//   query(sel)         在宿主里找元素（网站里是 document.querySelector）
//   portalTarget()     词卡之类要 portal 出去的地方（网站：全屏时的全屏元素，不然 body；嵌入时：自己的根容器）
//   fullscreenOn()     现在是不是在「本界面所在的」全屏里（网站：document.fullscreenElement 非空；嵌入时：全屏元素包着宿主）
//   hostDocument()     放样式 / 量窗口的文档（总是 document）
// setHostRoot({ host, root, container }) 由嵌入入口、本地播放界面各调一次。
import { layerFullscreenElement } from './fullscreen.js';

let cfg = null; // { host（宿主元素）, root（ShadowRoot）, container（portal 目标） }

export function setHostRoot(c) { cfg = c || null; }

export function realTarget(e) {
  const t = e?.target;
  if (!cfg || t !== cfg.host) return t;
  try {
    // 指针 / 鼠标 / 触摸点：按坐标找；键盘等没有坐标的：焦点所在
    if (typeof e.clientX === 'number') return cfg.root.elementFromPoint(e.clientX, e.clientY) || t;
    if (cfg.root.activeElement) return cfg.root.activeElement;
  } catch { /* 取不到就用宿主 */ }
  return t;
}

export function insideEvent(el, e) {
  if (!el) return false;
  const t = realTarget(e);
  return !!t && typeof el.contains === 'function' && el.contains(t);
}

// 在宿主里找一个元素：嵌入时找不到不会退回 document（宿主页面里碰巧同名的元素不是我们的）
export function query(sel) {
  return (cfg ? cfg.root : document).querySelector(sel);
}

export function portalTarget() {
  if (cfg) return cfg.container || cfg.root;
  return layerFullscreenElement() || document.body;   // 整页全屏（页头全屏钮）时 body 本来就看得见，不挂到 <html> 上
}

export function fullscreenOn() {
  const fs = typeof document !== 'undefined' ? document.fullscreenElement : null;
  if (!fs) return false;
  // 全屏的元素包着宿主就算（整个 <html> 也算）：本地播放界面只有整页全屏这一种（core/fullscreen.js），整页全屏时就按全屏的样子画
  return cfg ? fs === cfg.host || fs.contains(cfg.host) : true;
}

// 事件目标是不是在能打字的地方（输入框、文本框、可编辑区）：快捷键让路用。
// 只读的输入框不算（听写全对以后答案框留着、变只读，只接回车去下一句，空格、方向键照样归播放器）
export function typingTarget(e) {
  const t = realTarget(e);
  if (!t || typeof t.tagName !== 'string') return false;
  return (t.tagName === 'INPUT' && !t.readOnly) || t.tagName === 'TEXTAREA' || !!t.isContentEditable;
}
