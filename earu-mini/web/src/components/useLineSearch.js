import { useCallback, useEffect, useRef, useState } from 'react';

// 字幕列表里的搜索。
// 不动行的 DOM：命中的字用 CSS Custom Highlight API 上色（::highlight(earu-hit) / ::highlight(earu-hit-now)，styles.css），
// 命中的行在 li 上打 data-hit、当前那处所在的行打 data-hit-now（行边框）。行是 memo 的 Row 画的，这两个属性 React 不管、也不会擦掉。
// 搜的是列表里现在看得见的字：原文、译文、注释（打码的不算：练习时手上这一题的打码（MaskText）和「字幕打码」的雾，字都还在 DOM 里，FIELDS 把 .sub-mosaic 排掉，免得搜出被打码的字；鼠标吹开打码时叠上去的清楚克隆 .fog-clr 也排掉；注音的 <rt> 跳过）。大小写不分，搜索词里的空格对得上换行。
// 列表的字会变（译文一批批到、当前句出注音）：MutationObserver 看到就重算，当前那处尽量留在原地、不滚；
// 改搜索词时从当前句往后找第一处（后面没有就回到第一处），滚过去。
// 浏览器没有 Highlight（老的火狐 / Safari）：只剩行边框，计数、跳转照样能用
const HIT = 'earu-hit';
const NOW = 'earu-hit-now';
const FIELDS = '.text > .en:not(.sub-mosaic):not(.fog-clr), .text > .zh:not(.pending):not(.sub-mosaic):not(.fog-clr), .text > .note';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const registry = () => (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function' ? CSS.highlights : null);

// 文字里第 pos 个字落在哪个文字节点的第几个字（start：区间起点落在节点末尾时算下一个节点）
function place(range, nodes, pos, start) {
  for (const [node, at] of nodes) {
    const end = at + node.data.length;
    if (start ? pos < end : pos <= end) {
      if (start) range.setStart(node, pos - at);
      else range.setEnd(node, pos - at);
      return;
    }
  }
}

// 列表里每一处命中：{ i: 第几句, k: 这一句里的第几处, range }
function scan(list, q) {
  const re = new RegExp(q.split(/\s+/).map(esc).join('\\s+'), 'giu');
  const doc = list.ownerDocument;
  const skipRt = { acceptNode: (n) => (n.parentElement?.closest('rt') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
  const out = [];
  for (const li of list.querySelectorAll('li[data-i]')) {
    const i = Number(li.dataset.i);
    let k = 0;
    for (const el of li.querySelectorAll(FIELDS)) {
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, skipRt);
      const nodes = [];
      let text = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, text.length]); text += n.data; }
      if (!text) continue;
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[0].length) { re.lastIndex += 1; continue; }
        const range = doc.createRange();
        place(range, nodes, m.index, true);
        place(range, nodes, m.index + m[0].length, false);
        out.push({ i, k: k++, range });
      }
    }
  }
  return out;
}

function paint(list, hits, at) {
  const reg = registry();
  if (reg) {
    const rest = hits.filter((_, j) => j !== at).map((h) => h.range);
    if (rest.length) reg.set(HIT, new Highlight(...rest)); else reg.delete(HIT);
    if (at >= 0) reg.set(NOW, new Highlight(hits[at].range)); else reg.delete(NOW);
  }
  if (!list) return;
  const rows = new Set(hits.map((h) => h.i));
  const nowRow = at >= 0 ? hits[at].i : -1;
  for (const li of list.children) {
    const i = Number(li.dataset?.i);
    li.toggleAttribute('data-hit', rows.has(i));
    li.toggleAttribute('data-hit-now', i === nowRow);
  }
}

// listRef：列表的 <ul>；ready：<ul> 在不在（换字幕轨时会先卸掉再出来）；current：当前句；setFollow：列表的「跟随当前句」
export function useLineSearch({ listRef, ready, current, setFollow }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [view, setView] = useState({ n: 0, at: -1 });
  const inputRef = useRef(null);
  const hitsRef = useRef([]);
  const atRef = useRef(-1);
  const live = useRef({ open, q, current });
  live.current = { open, q, current };

  const show = useCallback((hits, at) => {
    hitsRef.current = hits;
    atRef.current = at;
    paint(listRef.current, hits, at);
    setView({ n: hits.length, at });
  }, [listRef]);

  // 把第 at 处所在的行滚到列表中间；滚了就不再跟随当前句（关搜索时恢复）
  const reveal = useCallback((at) => {
    const list = listRef.current;
    const h = hitsRef.current[at];
    const li = h && list?.querySelector(`[data-i="${h.i}"]`);
    if (!li) return;
    setFollow(false);
    const top = li.offsetTop - list.clientHeight / 2 + li.offsetHeight / 2;
    list.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' });
  }, [listRef, setFollow]);

  // fresh：改了搜索词，从当前句往后找、滚过去；keep：列表的字变了，当前那处尽量不动、不滚
  const run = useCallback((how) => {
    const { open: on, q: text, current: cur } = live.current;
    const list = listRef.current;
    const needle = text.trim();
    if (!on || !list || !needle) { show([], -1); return; }
    const hits = scan(list, needle);
    const fromCur = () => { const j = hits.findIndex((h) => h.i >= cur); return j >= 0 ? j : 0; };
    let at = -1;
    if (hits.length) {
      const old = how === 'keep' ? hitsRef.current[atRef.current] : null;
      if (!old) at = fromCur();
      else {
        const same = hits.findIndex((h) => h.i === old.i && h.k === old.k);
        const after = hits.findIndex((h) => h.i > old.i || (h.i === old.i && h.k > old.k));
        at = same >= 0 ? same : after >= 0 ? after : hits.length - 1;
      }
    }
    show(hits, at);
    if (how === 'fresh' && at >= 0) reveal(at);
  }, [listRef, show, reveal]);

  useEffect(() => { run('fresh'); }, [open, q, run]);
  useEffect(() => {
    const list = listRef.current;
    if (!open || !ready || !list) return undefined;
    run('keep');
    if (typeof MutationObserver === 'undefined') return undefined;
    let raf = 0;
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; run('keep'); });
    });
    // class 也要看：「字幕打码」开关只换 class（.sub-mosaic），不看的话开着搜索框切打码，命中不跟着变（复查 10-20）
    mo.observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [open, ready, listRef, run]);
  // 列表卸掉（收起抽屉、离开播放器）：颜色是整页一份的，要擦掉
  useEffect(() => () => paint(null, [], -1), []);

  const focusInput = () => { const el = inputRef.current; if (el) { el.focus(); el.select(); } };
  useEffect(() => { if (open) focusInput(); }, [open]);

  const openSearch = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setFollow(true);
  }, [setFollow]);
  const step = useCallback((d) => {
    const n = hitsRef.current.length;
    if (!n) return;
    const at = atRef.current < 0 ? (d > 0 ? 0 : n - 1) : (atRef.current + d + n) % n;
    show(hitsRef.current, at);
    reveal(at);
  }, [show, reveal]);
  // 搜索开着时点了一行：当前那处挪到这一行（点行本身照旧跳过去播放）
  const onPick = useCallback((e) => {
    const li = e.target.closest?.('li[data-i]');
    if (!li || !hitsRef.current.length) return;
    const j = hitsRef.current.findIndex((h) => h.i === Number(li.dataset.i));
    if (j >= 0 && j !== atRef.current) show(hitsRef.current, j);
  }, [show]);
  const onKeyDown = (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return; // 输入法选字时的回车不算
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    // 抽屉看到 defaultPrevented 就不收（ListDrawer）：Esc 只关搜索
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return { open, q, setQ, n: view.n, at: view.at, inputRef, openSearch, close, step, onPick, onKeyDown };
}
