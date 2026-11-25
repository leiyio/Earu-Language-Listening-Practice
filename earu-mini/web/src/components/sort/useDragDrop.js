import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveDrop, BLOCKED } from '../../core/sort/puzzle.js';
import { learnAttrs, learnNow } from '../../i18n/index.js';
import { portalTarget } from '../../core/hostRoot.js';

// 词块的拖放：pointer events 自己实现（HTML5 拖放在触屏上用不了），
// 落点按坐标就近吸附、拖动中高亮落点——几何全在 core/sort/puzzle.js（resolveDrop：72px 吸附、横向 ×1.7、
// 区域兜底 120px、正对预摆词松手什么都不做），这里只负责量 DOM、跟着手画拖影、松手交给 onDrop。
//
// 这里要躲开的坑：
//   · 第 1 条：拖到一半元素被重绘换掉——这里拖动中只改两个小状态（哪个词在拖、高亮哪个落点），词块用稳定的 key，
//     DOM 节点不换；指针事件挂在 window 上，就算节点真被换了也收得到松手；
//   · 第 2 条：在 pointerdown 里同步重绘会吞掉点击——按下时只记 ref，不改状态，挪过 4px 才算开始拖；
//   · 第 3 条：只看 event.target 会落空——量所有空位和词的矩形交给 resolveDrop 就近吸附，落点在两区之间的缝里也按最近的区算。
// 点一下（没拖起来）走按钮自己的 click；拖起来以后松手，浏览器补发的那个 click 一律吞掉（见 up 里的注释）。
export const DRAG_START_PX = 4;

// 拖动中贴着滚动区上下边缘自动滚：长句的答案区十来行、词块区在面板可视范围以下，拖动中又不会自己滚，
// 从词块拖到最上面几排空位就做不到（触屏拖动时 touch-action:none，连手动滚都不行）。
// 和布局无关：滚的是答案区往上最近的那个能滚的祖先（现在是 .sort-body，换了
// 滚动容器也一样认。
export const EDGE_SCROLL_PX = 40;   // 离上下边缘多近开始滚
export const EDGE_SCROLL_MAX = 14;  // 每帧最多滚多少 px（60 帧约 840px/秒）

// 这一帧该滚多少（负 = 往上）：指针在滚动区横向范围以内、离上 / 下边缘 EDGE_SCROLL_PX 以内按距离滚，越近越快；
// 出了上 / 下边缘按最快。横向出了滚动区不滚（拖到画面上去了，不是要找上面的空位）
export function edgeScrollStep(x, y, rect, edge = EDGE_SCROLL_PX, max = EDGE_SCROLL_MAX) {
  if (!rect || x < rect.left || x > rect.right) return 0;
  const k = y < rect.top + edge ? -(rect.top + edge - y) / edge : y > rect.bottom - edge ? (y - (rect.bottom - edge)) / edge : 0;
  return k ? Math.sign(k) * Math.ceil(max * Math.min(1, Math.abs(k))) : 0;
}

// 答案区往上最近的、真有东西可滚的祖先（overflow-y auto / scroll，内容比框高）
function scrollParentOf(el) {
  const win = el?.ownerDocument?.defaultView;
  for (let n = el?.parentElement; n && win; n = n.parentElement) {
    const oy = win.getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

// 指针正下方的元素归属（resolveDrop 的 under）：哪个区、哪个空位 / 哪个词
function describe(el, root) {
  if (!el || !root || !root.contains(el)) return null;
  const zoneEl = el.closest('[data-zone]');
  if (!zoneEl || !root.contains(zoneEl)) return null;
  const zone = zoneEl.dataset.zone;
  const slot = el.closest('[data-slot-index]');
  if (slot && zoneEl.contains(slot)) return { zone, slotIndex: Number(slot.dataset.slotIndex) };
  const tok = el.closest('[data-token-id]');
  if (tok && zoneEl.contains(tok)) return { zone, tokenId: tok.dataset.tokenId, preset: tok.dataset.preset === '1' };
  return { zone };
}

// 量一次：两个区的矩形、答案区里每个空位 / 词的矩形（按 DOM 顺序），加上指针正下方是什么
export function measureDrop(root, x, y) {
  if (!root) return null;
  const doc = root.ownerDocument;
  const zones = [];
  const answer = root.querySelector('[data-zone="answer"]');
  const bank = root.querySelector('[data-zone="bank"]');
  if (answer) zones.push({ zone: 'answer', rect: answer.getBoundingClientRect() });
  if (bank) zones.push({ zone: 'bank', rect: bank.getBoundingClientRect() });
  const targets = answer ? [...answer.querySelectorAll('[data-slot-index], [data-token-id]')].map((el) => (
    el.dataset.slotIndex != null
      ? { rect: el.getBoundingClientRect(), slotIndex: Number(el.dataset.slotIndex) }
      : { rect: el.getBoundingClientRect(), tokenId: el.dataset.tokenId, preset: el.dataset.preset === '1' }
  )) : [];
  // root.getRootNode()：普通页面里就是 document；shadow root 里，document.elementFromPoint 只会给到宿主元素，要问 shadow root 自己
  const under = describe((root.getRootNode?.() || doc).elementFromPoint(x, y), root);
  return resolveDrop({ x, y, zones, targets, under });
}

// 拖动中高亮谁：答案区里吸到的空位（变绿框）或词（变绿底 = 要交换）；正对预摆词、落在词块区不高亮
export function highlightKey(drop) {
  const tg = drop?.target;
  if (!drop || drop.zone !== 'answer' || !tg || tg === BLOCKED || tg.blocked) return null;
  return tg.slotIndex != null ? `s${tg.slotIndex}` : tg.tokenId ? `t${tg.tokenId}` : null;
}

// rootRef：答题面板的根元素（里面有 [data-zone="answer"]、[data-zone="bank"]）。
// onDrop(tokenId, drop)：松手（drop 可能是 null：离两个区都太远，什么都不做）；onClick(tokenId)：点了一下。
// disabled：已排对、提示那 2 秒——不起拖（session 那边也拦着，这里省得画拖影）。
export function useDragDrop({ rootRef, onDrop, onClick, disabled }) {
  const [dragId, setDragId] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const drag = useRef(null);
  const cb = useRef({});
  cb.current = { onDrop, onClick, disabled };

  const stop = useCallback((d, { keepState = false } = {}) => {
    if (!d) return;
    d.off?.();
    if (d.raf) d.win.cancelAnimationFrame(d.raf);
    if (d.sraf) d.win.cancelAnimationFrame(d.sraf);
    d.ghost?.remove();
    if (drag.current === d) drag.current = null;
    if (!keepState) { setDragId(null); setHighlight(null); }
  }, []);

  useEffect(() => () => stop(drag.current), [stop]);

  const onTokenPointerDown = useCallback((e, token) => {
    if (cb.current.disabled || !token || token.preset) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget;
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    if (drag.current) stop(drag.current);
    // hpan：手指按在左右划的词块区上（放不下时）。这时横着划是翻看词块（浏览器自己横滚、随后发 pointercancel），
    // 只有竖着为主的移动才算拖（往上拖进空格）
    const hpan = e.pointerType !== 'mouse' && !!el.closest?.('.sort-bank.is-hscroll');
    const d = { id: token.id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, el, doc, win, started: false, ghost: null, raf: 0, sraf: 0, scroller: null, hpan };
    drag.current = d;

    const relight = () => {
      const key = highlightKey(measureDrop(rootRef.current, d.lx, d.ly));
      setHighlight((old) => (old === key ? old : key));
    };
    // 贴边自动滚：每帧滚一点，指针停着不动也接着滚；滚不动了（到头）或者离开边缘就停，下一次 pointermove 再看
    const autoScroll = () => {
      d.sraf = 0;
      const sc = d.scroller;
      if (drag.current !== d || !sc) return;
      const step = edgeScrollStep(d.lx, d.ly, sc.getBoundingClientRect());
      if (!step) return;
      const before = sc.scrollTop;
      sc.scrollTop = before + step;
      if (sc.scrollTop === before) return;
      relight(); // 内容挪了、指针没动：落点高亮要重新量
      d.sraf = win.requestAnimationFrame(autoScroll);
    };

    const start = () => {
      d.started = true;
      d.scroller = scrollParentOf(rootRef.current?.querySelector('[data-zone="answer"]'));
      // 拖影挂在全屏元素里（全屏时 body 上的东西看不见，答题面板在播放器舞台里）
      // （shadow root 里：拖影要留在 shadow root 里才吃得到样式）
      const rn = el.getRootNode?.();
      const host = rn && rn !== doc && rn.host ? portalTarget() : (doc.fullscreenElement || doc.body);
      const g = doc.createElement('div');
      // 浮动答题区里拖的：拖影跟着答题区换紫调（styles.css .sort-ghost.is-prac）
      g.className = el.closest?.('.float-prac') ? 'sort-ghost is-prac' : 'sort-ghost';
      g.textContent = el.textContent;
      // 学中文时拖影标上学习内容的 lang（学中文第一期 B8）：拖影挂在 body 上，不在答题区那块标了 lang 的地方，
      // 不标的话日文界面里会画成日文字形、繁體词块画成简体字形。学英语时一个属性都不加（和以前一样）
      if (learnNow() !== 'en') g.lang = learnAttrs().lang;
      host.appendChild(g);
      d.ghost = g;
      setDragId(d.id);
    };
    const place = (x, y) => { if (d.ghost) d.ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`; };
    const move = (ev) => {
      if (ev.pointerId !== d.pointerId) return;
      if (!d.started) {
        const dx = ev.clientX - d.x0;
        const dy = ev.clientY - d.y0;
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        if (d.hpan && Math.abs(dx) > Math.abs(dy)) return;
        start();
      }
      ev.preventDefault();
      place(ev.clientX, ev.clientY);
      d.lx = ev.clientX; d.ly = ev.clientY;
      if (!d.raf) {
        d.raf = win.requestAnimationFrame(() => {
          d.raf = 0;
          if (drag.current !== d) return;
          relight();
        });
      }
      if (d.scroller && !d.sraf) d.sraf = win.requestAnimationFrame(autoScroll);
    };
    const up = (ev) => {
      if (ev.pointerId !== d.pointerId) return;
      if (!d.started) { stop(d, { keepState: true }); return; } // 没拖起来：交给 click
      const drop = measureDrop(rootRef.current, ev.clientX, ev.clientY);
      // 拖完松手，浏览器还会补发一个 click：按下在词块上、松手在别处时，它发给两者最近的共同祖先——全屏时答题面板挂在画面里，
      // 松手稍微出了面板（落在视频上）就发给播放器舞台 .stage，触发「单击画面暂停 / 播放」：不开循环时视频播起来、题被收走
      // 答题区放进画面时也要拦住点击。松手在同一个词块上时，它又会把刚放下的词点回去。
      // HTML5 拖放拖完不补 click，没这个问题。这里在 window 的捕获阶段把这一下吞掉，不管它发给谁：
      // click 和 pointerup 在同一个输入任务里派发，setTimeout 0 一定在它之后才撤掉。
      // （不用 setPointerCapture：捕获状态下 click 发给谁，各版本 Chrome 不完全一样）
      const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
      win.addEventListener('click', eat, { capture: true });
      win.setTimeout(() => win.removeEventListener('click', eat, { capture: true }), 0);
      stop(d);
      cb.current.onDrop?.(d.id, drop);
    };
    const cancel = (ev) => { if (ev.pointerId === d.pointerId) stop(d); };
    const esc = (ev) => { if (ev.key === 'Escape' && d.started) { ev.stopPropagation(); stop(d); } };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', cancel, true);
    win.addEventListener('keydown', esc, true);
    d.off = () => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('pointercancel', cancel, true);
      win.removeEventListener('keydown', esc, true);
    };
  }, [rootRef, stop]);

  const onTokenClick = useCallback((token) => {
    if (cb.current.disabled || token.preset) return;
    cb.current.onClick?.(token.id);
  }, []);

  return { dragId, highlight, onTokenPointerDown, onTokenClick };
}
