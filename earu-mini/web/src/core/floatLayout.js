// 浮动布局的常数和纯函数：不碰 DOM、不依赖 React，Node 里能测（scripts/float-test.mjs）。
// 坐标一律按播放器舞台（.stage）算，不按视口（说明 §1.1）：全屏的就是舞台，浮层放在里面进出全屏不用搬。

export const EDGE = 8;               // 面板离舞台边至少 8px
export const CLICK_SUPPRESS_MS = 250; // 拖完松手吞掉落到画面上的那下点击
// 闲置淡出 / 醒来后冻结再保持这么久

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// 像素位置 → 比例：0 = 贴左 / 上，1 = 贴右 / 下。可活动范围不到 8px 时比例记 0
function axisRatio(pos, size, Size) {
  const max = Math.max(EDGE, Size - size - EDGE);
  return max > EDGE ? clamp((pos - EDGE) / (max - EDGE), 0, 1) : 0;
}

