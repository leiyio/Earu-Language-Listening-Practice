// 抽屉收起时也往回滑：设置面板、播放器里的设置、练这句三个抽屉共用这一处。
// 办法：抽屉一关 React 就把节点拿掉了，这里趁开着时记下包装层里的节点，关掉那一刻拷一份「影子」放回原处，
// 加上 .is-leaving 播收起动画（样式在 lite.css / liteShadow.css），播完删掉。影子只是样子：不可点、读屏不读。
// 这样关抽屉的各条路（点遮罩、点把手、Esc、保存、切回听模式）都不用改，练这句的内容关掉后也不用硬留着画。
// 用法：const ref = useSlideOut(open); 抽屉外面套 <div ref={ref} style={{ display: 'contents' }}>（包装层要一直在）。
import { useEffect, useLayoutEffect, useRef } from 'react';

const MS = 380;   // 同打开的 0.38 秒

const reduced = () => {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// 绝对定位的抽屉记下开着时的位置和大小：关掉后周围版面会变（练这句收起后字幕列表回来），影子钉在原处滑走
const boxOf = (o) => (o.offsetParent && getComputedStyle(o).position === 'absolute'
  ? { left: o.offsetLeft, top: o.offsetTop, width: o.offsetWidth, height: o.offsetHeight } : null);

// 原件和影子一一对上：抄输入框里打的字，记下要恢复的滚动位置（拷贝不带这两样）
function pair(o, c, scrolls, tops) {
  if (o.tagName === 'INPUT' || o.tagName === 'TEXTAREA' || o.tagName === 'SELECT') {
    c.value = o.value;
    if ('checked' in o) c.checked = o.checked;
  }
  const top = tops.get(o);
  if (top) scrolls.push([c, top]);
  for (let i = 0; i < o.children.length; i++) {
    if (c.children[i]) pair(o.children[i], c.children[i], scrolls, tops);
  }
}

export function useSlideOut(open) {
  const wrap = useRef(null);
  const kids = useRef([]);
  const boxes = useRef([]);
  const tops = useRef(new Map());   // 抽屉里滚过的地方（节点拿掉后读不到滚动位置，只能滚的时候记）

  useEffect(() => {
    const w = wrap.current;
    if (!w) return undefined;
    const onScroll = (e) => { if (e.target instanceof Element) tops.current.set(e.target, e.target.scrollTop); };
    w.addEventListener('scroll', onScroll, true);
    return () => w.removeEventListener('scroll', onScroll, true);
  }, []);

  useLayoutEffect(() => {
    const w = wrap.current;
    if (!w) return;
    if (open) {
      w.querySelectorAll(':scope > .is-leaving').forEach((g) => g.remove());   // 收到一半又打开：影子直接撤
      kids.current = [...w.children];
      boxes.current = kids.current.map(boxOf);
      return;
    }
    const list = kids.current;
    const bx = boxes.current;
    kids.current = [];
    boxes.current = [];
    const map = tops.current;
    tops.current = new Map();
    if (!list.length || reduced()) return;
    const scrolls = [];
    const ghosts = list.map((o, i) => {
      const c = o.cloneNode(true);
      const b = bx[i];
      if (b) {
        Object.assign(c.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`,
          right: 'auto', bottom: 'auto', margin: '0', boxSizing: 'border-box' });
      }
      pair(o, c, scrolls, map);
      c.classList.add('is-leaving');
      c.setAttribute('inert', '');
      c.setAttribute('aria-hidden', 'true');
      c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      c.removeAttribute('id');
      w.appendChild(c);
      return c;
    });
    for (const [c, top] of scrolls) c.scrollTop = top;
    setTimeout(() => ghosts.forEach((g) => g.remove()), MS + 60);
  });

  return wrap;
}
