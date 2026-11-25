import { useEffect, useRef, useState } from 'react';
import { insideEvent } from '../core/hostRoot.js';

// 弹出菜单的共用容器：
// 一颗按钮 + 点开后一个竖排列表；点菜单外面（insideEvent：影子根里也认得出「外面」）就收起；点选一项收起。
//   button({ open, toggle })  画那颗按钮（样式、图标、悬停提示由调用方定）
//   items  [{ key, node, on, disabled, title, onPick }]：node 是这一项里画什么；on 是现在选中的那项（亮着）；
//          disabled 灰着、点不动（悬停提示 title 照样出，说明为什么灰）；onPick 点选时调
//   down   往下开（默认往上开，贴着控制条底边；控制区在舞台上方，要往下开）
//   wrapClass / menuClass  加在外层容器、列表上的类名；menuProps 是列表上的别的属性（比如阿拉伯语界面的 dir）
//   initialOpen  测试用（服务器渲染没法点开菜单），平时不传
export default function PopMenu({ button, items, down = false, wrapClass = '', menuClass = '', menuProps = null, initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!insideEvent(ref.current, e)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className={`cb-menu-wrap${wrapClass ? ` ${wrapClass}` : ''}`} ref={ref}>
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <ul className={`cb-menu${down ? ' is-down' : ''}${menuClass ? ` ${menuClass}` : ''}`} {...menuProps}>
          {items.map((it) => (
            <li key={it.key}>
              <button type="button" className={it.on ? 'on' : ''} aria-pressed={it.on == null ? undefined : !!it.on} disabled={!!it.disabled} title={it.title}
                onClick={() => { if (it.disabled) return; it.onPick?.(); setOpen(false); }}>{it.node}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
