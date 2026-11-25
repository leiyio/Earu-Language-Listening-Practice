// 全屏的「谁是谁」（不接管 F11 键，只保留页面里的全屏按钮）。
// 桌面版只有一种全屏：整个窗口铺满屏幕（document.documentElement 全屏）。窗口允许页面全屏，
//   页面一请求窗口就整个全屏。主界面和播放页面的全屏要一致：
//   以前本地播放界面的舞台（.dk-lp）还能在整页全屏上面再叠一层，两颗钮各认各的层，按哪颗、按几下才回窗口说不清。现在页头的钮、播放界面的钮、
//   双击画面、F 键都是 toggleWindowFullscreen 这一个开关：有全屏就一下全退回窗口，没有就整页全屏；两颗钮的图标看的也是同一个状态（anyFullscreenOn）。
//   本地播放界面本来就 position: fixed 铺满窗口，整页全屏时画面和以前的舞台全屏一样；从播放界面回首页不退全屏。
// 网页里的播放器让自己的舞台（Player 的 stage）全屏——网页里整页全屏只会把整个网页放大，画面不会铺满。
//   toggleLayerFullscreen / exitLayerFullscreen / layerFullscreenElement 是给它留的，桌面版不用。
// 实测（无头 Chrome）：几层叠着时 document.exitFullscreen() 一次只退最上面一层，所以「全退」要循环退（exitAllFullscreen）。
// 这个文件只管判断和切换，不依赖 React；播放界面只调这里。

const docOf = (doc) => doc || (typeof document !== 'undefined' ? document : null);

// 页面能不能请求全屏（不能就不出按钮）：没有 requestFullscreen（老引擎）、被禁用（fullscreenEnabled 为 false）都不行
export function canPageFullscreen(doc) {
  const d = docOf(doc);
  return !!d && d.fullscreenEnabled !== false && typeof d.documentElement?.requestFullscreen === 'function';
}

// 现在是不是整页全屏（最上面一层全屏的就是 documentElement）
export function pageFullscreenOn(doc) {
  const d = docOf(doc);
  return !!d && !!d.fullscreenElement && d.fullscreenElement === d.documentElement;
}

// 有没有任何一层在全屏：播放界面的钮看这个（全屏着就画「退出全屏」，点一下全退回窗口）
export function anyFullscreenOn(doc) {
  const d = docOf(doc);
  return !!d && !!d.fullscreenElement;
}

// 全屏的元素里「不是整页」的那个（网站里词卡、拖影要挂进全屏元素才看得见；整页全屏时 body 本来就看得见）
export function layerFullscreenElement(doc) {
  const d = docOf(doc);
  const fs = d && d.fullscreenElement;
  return fs && fs !== d.documentElement ? fs : null;
}

// 网页播放器的全屏钮 / 双击 / f 键：只认自己的舞台。舞台正全屏着就退这一层，不然请求舞台全屏
export function toggleLayerFullscreen(el, doc) {
  const d = docOf(doc);
  if (!d || !el) return Promise.resolve();
  if (d.fullscreenElement === el) return Promise.resolve(d.exitFullscreen()).catch(() => {});
  return Promise.resolve(el.requestFullscreen?.()).catch(() => {});
}

// 只退自己那层（画中画、打开设置前要先退播放器全屏；整页全屏不碰）。el 不给 = 退掉所有不是整页的那层
export async function exitLayerFullscreen(el, doc) {
  const d = docOf(doc);
  if (!d) return;
  const fs = d.fullscreenElement;
  if (!fs || fs === d.documentElement) return;
  if (el && fs !== el) return;
  try { await d.exitFullscreen(); } catch { /* 退不出也照样往下走 */ }
}

// 整页全屏：已经是了就什么也不做
export function enterPageFullscreen(doc) {
  const d = docOf(doc);
  if (!canPageFullscreen(d)) return Promise.resolve(false);
  if (pageFullscreenOn(d)) return Promise.resolve(true);
  return Promise.resolve(d.documentElement.requestFullscreen()).then(() => true, () => false);
}

// 全部退掉回到窗口（叠着两层就退两次；上限 4 次，免得哪个引擎的 exitFullscreen 不改状态时死循环）
export async function exitAllFullscreen(doc) {
  const d = docOf(doc);
  if (!d) return;
  for (let i = 0; i < 4 && d.fullscreenElement; i++) {
    try { await d.exitFullscreen(); } catch { return; }
  }
}

// 桌面版唯一的全屏开关（播放界面的钮、双击画面、F 键）：没全屏就进整页全屏；任何一层在全屏就整个退回窗口
export function toggleWindowFullscreen(doc) {
  const d = docOf(doc);
  return d && d.fullscreenElement ? exitAllFullscreen(d) : enterPageFullscreen(d);
}
