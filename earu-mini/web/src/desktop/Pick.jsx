// 工具栏的下拉框（语言 / 排序 / 难度）：
// 系统自带的 <select> 弹出来是白底蓝条、和深色界面不搭，换成自己画的：按钮按当前选中的字收宽，弹出的列表按最长的选项自动定宽（不跟按钮一样宽），
// 样式和头像菜单一套（深紫底、圆角、选中的那项紫字带勾）。
// 列表一直在 DOM 里，关着时 hidden（测试直接读选项；display 从 none 变回来时入场动画会重新播）。
// 键盘：按钮上 ↓ / ↑ / Enter / 空格打开；列表里 ↑ ↓ Home End 移动，Enter / 空格选，Esc 关，Tab 关并照常走开。点列表外面关。
import { useEffect, useId, useRef, useState } from 'react';
import { svg } from './icons.jsx';

const Chevron = () => svg(<path d="M6 9l6 6 6-6" />, 14);
const Check = () => svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, 15);

// options: [{ id, name, n? }]；n 放到 data-n 上（语言各有几部片，测试读，界面不显示）
// label 是给人看的名字（跟着界面语言变）；pid 是给测试认的固定名字（data-pick，不跟着界面语言变），不给就用 label
export function Pick({ label, pid, value, options, onChange }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const btn = useRef(null);
  const list = useRef(null);
  const sel = Math.max(0, options.findIndex((o) => o.id === value));
  const cur = options[sel];

  const show = () => { setActive(sel); setOpen(true); };
  const close = (refocus) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (i) => {
    const o = options[i];
    close(true);
    if (o && o.id !== value) onChange(o.id);
  };

  useEffect(() => {
    if (!open) return undefined;
    list.current?.focus();
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onBtnKey = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e) => {
    const last = options.length - 1;
    const move = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last }[e.key];
    if (move !== undefined) { e.preventDefault(); setActive(move); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="dk-pick" data-pick={pid ?? label} ref={box}>
      <span id={`${uid}l`}>{label}</span>
      <div className="dk-pk">
        <button type="button" ref={btn} className="dk-pk-btn" id={`${uid}b`} data-value={cur?.id} aria-haspopup="listbox" aria-expanded={open}
          aria-labelledby={`${uid}l ${uid}b`} onClick={() => (open ? close(false) : show())} onKeyDown={onBtnKey}>
          {cur?.name}<Chevron />
        </button>
        <ul className="dk-pk-list" role="listbox" ref={list} tabIndex={-1} hidden={!open} aria-labelledby={`${uid}l`}
          aria-activedescendant={open ? `${uid}o${active}` : undefined} onKeyDown={onListKey}
          onMouseDown={(e) => e.preventDefault()} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget)) setOpen(false); }}>
          {options.map((o, i) => (
            <li key={o.id} id={`${uid}o${i}`} data-i={i} data-value={o.id} data-n={o.n} role="option" aria-selected={i === sel}
              className={i === active ? 'on' : undefined} onMouseMove={() => active !== i && setActive(i)} onClick={() => choose(i)}>
              {o.name}<Check />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
