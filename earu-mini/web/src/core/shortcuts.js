// 快捷键表：全站的快捷键都定在这一张表里。
// 每条：id 动作、win Windows 键、mac Mac 键、scope 在哪生效（app 整个窗口 / player 播放器）、run 谁来做
//   run 'shell'：外层容器自己做（后退 / 视频层退到头关层）；'page'：网页自己做
// 谁来接键：带 Ctrl / Alt / ⌘ 的组合和 F 键由外层容器接住（见 shellTable），它自己的动作它做，别的转给网页（emitShortcut）；
//   不带修饰键的单键（空格、← →、字母）网页自己听——要先看是不是在打字（typingTarget）、浮层开着没有（data-blocks-keys）
// 不进表的：系统复制粘贴、Mac 应用菜单、对话框里的 Esc / Enter / Tab，生词卡、听写这类小部件自己的按键（两个系统一样）

const page = (id, key, scope = 'player') => ({ id, win: key, mac: key, scope, run: 'page' });

export const SHORTCUTS = Object.freeze([
  { id: 'back', win: 'Alt+ArrowLeft', mac: 'Meta+[', scope: 'app', run: 'shell' },
  page('playPause', 'Space'),
  page('seekBack', 'Shift+ArrowLeft'),     // 前后 10 秒
  page('seekFwd', 'Shift+ArrowRight'),
  page('prev', 'ArrowLeft'),               // 上一句 / 下一句（没字幕的片是 ±10 秒，播放器自己判断）
  page('next', 'ArrowRight'),
  page('loop', 'R'),                       // 单句循环
  page('stopMode', 'Q'),                   // 每句停
  page('replay', 'S'),                     // 重听这一句
  page('fullscreen', 'F'),
  page('pip', 'P'),                        // 画中画（只有网页自己放的片）
  page('list', 'L'),                       // 字幕列表
].map(Object.freeze));

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];

// 'Alt+ArrowLeft' → { ctrl, alt, shift, meta, key }；key 单个字母一律大写
export function parseCombo(combo) {
  const parts = String(combo || '').split('+');
  // 键本身是「+」时（'Ctrl++'）最后两段是空串
  let key = parts.pop();
  if (key === '' && parts.length && parts[parts.length - 1] === '') { parts.pop(); key = '+'; }
  const has = new Set(parts);
  const out = { ctrl: has.has('Ctrl'), alt: has.has('Alt'), shift: has.has('Shift'), meta: has.has('Meta'), key: key.length === 1 ? key.toUpperCase() : key };
  return out;
}

export function isMacPlatform(nav = globalThis.navigator) {
  try {
    const p = nav?.userAgentData?.platform || nav?.platform || '';
    return /mac|iphone|ipad/i.test(p);
  } catch {
    return false;
  }
}

// 这个键要不要外层容器来接：带 Ctrl / Alt / ⌘，或者是 F1–F24
export function shellCatches(combo) {
  const c = parseCombo(combo);
  return c.ctrl || c.alt || c.meta || /^F([1-9]|1\d|2[0-4])$/.test(c.key);
}

// 交给外层容器的那部分表（earuShell.keys.set 收）：它接的键才给，单键网页自己听
export const shellTable = (table = SHORTCUTS) => table
  .filter((s) => shellCatches(s.win) || shellCatches(s.mac))
  .map(({ id, win, mac, run }) => ({ id, win, mac, run }));

// 事件里按的键 → 表里的键名（大写字母、'Space'）
function eventKey(e) {
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') return 'Space';
  return k && k.length === 1 ? k.toUpperCase() : k;
}
const sameMods = (c, e, ignoreShift) =>
  c.ctrl === !!e.ctrlKey && c.alt === !!e.altKey && c.meta === !!e.metaKey && (ignoreShift ? !c.shift : c.shift === !!e.shiftKey);
// 非拉丁键盘（俄语、阿拉伯语……）按 R 那个位置出的是「к」：表里是英文字母时，再按键位（e.code = 'KeyR'）认一次
function keyMatches(c, e) {
  const k = eventKey(e);
  if (k === c.key) return true;
  return /^[A-Z]$/.test(c.key) && typeof k === 'string' && k.length === 1 && !/[\x00-\x7f]/.test(k) && e.code === `Key${c.key}`;
}

// 按键事件对上表里哪一条，返回 id（对不上返回 null）。
// 先找修饰键完全一样的；按着 Shift 又没对上，就当没按 Shift 再找一次（Shift+R 照旧是 R，Shift+← 有自己的一条）
export function matchShortcut(e, { scope = 'player', mac = isMacPlatform(), table = SHORTCUTS } = {}) {
  if (!e || typeof e.key !== 'string') return null;
  const rows = table.filter((s) => s.scope === scope);
  const find = (ignoreShift) => {
    for (const s of rows) {
      const c = parseCombo(mac ? s.mac : s.win);
      if (sameMods(c, e, ignoreShift) && keyMatches(c, e)) return s.id;
    }
    return null;
  };
  return find(false) || (e.shiftKey ? find(true) : null);
}

// 外层容器接住、转给网页的键（id）在这里分发给正在听的播放器
const subs = new Set();
export function onShortcut(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function emitShortcut(id) {
  if (typeof id !== 'string' || !SHORTCUTS.some((s) => s.id === id && s.run === 'page')) return;
  for (const cb of [...subs]) {
    try { cb(id); } catch { /* 一个订阅出错不碍别的 */ }
  }
}
