import { useLayoutEffect } from 'react';

// 画面字幕多大：按【视频画面实际显示的宽】算。
// 字号随画面宽线性涨，不是按比例，
// 大窗里涨得慢——1280 宽约 25px、1920 宽全屏 35px，小窗 960 宽约 21px 基本不变；最大化时从约 40px 降到约 33px。
//   基准 = clamp(16, 16 + (W − 650) × 0.014966, 38)，W = 视频画面实际显示的宽（contain：不算黑边、不算侧栏，见 videoDisplayW）
//   最终 = max(12, 基准 × 档位)，四舍五入到 0.1；档位五档（控制区「字幕大小」一行，存本机 subScale），默认 1
// 原文、译文同大。译文、注释、浮动答题区底栏母语都从这个数取（styles.css --sub-fs）；画中画、窄屏有自己的字号（styles.css），这里的数它们基本用不上
// 字幕行宽也按同一个画面：字号用 videoDisplayW（竖屏片按 16:9 放大），行宽用 videoPictureW（真实宽、不放大），写成 --sub-w
export const SUB_SCALES = [0.7, 0.85, 1, 1.15, 1.35];
export const SUB_FLOOR = 12;   // 最小档在小窗里也不小于 12px（16 × 0.7 = 11.2 会发虚）
export const subBasePx = (w) => Math.min(38, Math.max(16, 16 + (w - 650) * 0.014966));
export const subFontPx = (w, scale = 1) => Math.round(Math.max(SUB_FLOOR, subBasePx(w) * scale) * 10) / 10;

// 视频画面实际显示的宽（contain 算法）：cw、ch 是 video 元素的显示宽高（clientWidth / clientHeight），vw、vh 是片子的像素宽高（videoWidth / videoHeight）。
//   元数据还没到（vw 或 vh 是 0）、元素还没排版（ch 是 0）：退回元素宽 cw
//   竖屏片（vh > vw）：按「同样高度的 16:9 横屏片」算，即 min(容器宽, 显示高 × 16/9)——不然手机拍的竖屏片画面窄、字小得看不清
export function videoDisplayW(cw, ch, vw, vh) {
  const s = containScale(cw, ch, vw, vh);
  if (!(s > 0)) return cw;
  return vh > vw ? Math.min(cw, vh * s * 16 / 9) : vw * s;
}

// contain 缩放比：片子按这个比例缩进 video 元素（取宽、高两个方向里小的那个）。videoDisplayW（字号）和 videoPictureW（字幕行宽）共用，不各算一套。
// 元数据还没到（vw 或 vh 是 0）、元素还没排版（ch 是 0）：返回 0，调用方退回元素宽
const containScale = (cw, ch, vw, vh) => (vw > 0 && vh > 0 && ch > 0 ? Math.min(cw / vw, ch / vh) : 0);

// 画面【真实】铺出来的宽：4:3、竖屏片 contain 后 video 元素两侧是黑边，字幕行宽要限在这个宽里，不能伸进黑边。
// 和 videoDisplayW 的差别只在竖屏片：字号为了看得清按「同高 16:9」放大（那是个虚拟的宽），行宽不套 16/9。
// 但比 4:3 还窄的画面（竖屏、方形）行宽至少按「同高 4:3」给：竖屏片画面只有字号那个宽的三分之一，原文折成三行，
// 观影时原文那一格只留两行高（styles.css .overlay-sub.as-sort），第三行掉进控制区按钮行；按 4:3 给就和 4:3 片一样宽，左右各伸进黑边一点。
// 横屏、4:3 片就是真实画面宽，和 videoDisplayW 相等；永远不超过元素宽；元数据还没到、没排版：退回元素宽 cw（等于不限）
export function videoPictureW(cw, ch, vw, vh) {
  const s = containScale(cw, ch, vw, vh);
  return s > 0 ? Math.min(cw, Math.max(vw, vh * 4 / 3) * s) : cw;
}

// 量视频画面（没有 video 就量舞台：画中画，或页面里还没有视频元素），把字号写在舞台上（--sub-fs），里面的字幕、答题区底栏都从这儿继承（打码的雾按 em 糊，跟着字号走，不用另写格子）。
// 有 video 时还写 --sub-w（画面真实显示的宽，videoPictureW），styles.css 用它把字幕行宽限在画面里；没有 video 就清掉它
// 直接改 DOM、不走 React：拖窗口时一秒几十次，不能让整个播放器跟着重画。
//   again：画中画进出时舞台换了一个元素、换了窗口，要重新挂；video：量谁（外部宿主里是宿主自己的 video）；scale：控制区选的字幕大小档位
// 舞台和 video 都要看（开侧边字幕列表、切全屏时 video 变窄，舞台不变）；换片 / 切 P 时 video 的片子宽高变了，元素大小不一定变：再听 loadedmetadata、resize
export function useSubSize(stageRef, again, video = null, scale = 1) {
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const put = () => {
      const measured = video?.clientWidth > 0;
      const w = measured
        ? videoDisplayW(video.clientWidth, video.clientHeight, video.videoWidth, video.videoHeight)
        : el.clientWidth;   // 没有 video、或它还没排版：量舞台
      const px = subFontPx(w, scale);
      el.style.setProperty('--sub-fs', `${px}px`);
      // 字幕行宽的上限 = 画面真实显示的宽（4:3、竖屏片两侧黑边里不排字幕）；没有 video 可量（画中画）就不设，styles.css 退回原来的整个舞台宽
      if (measured) {
        const pw = videoPictureW(video.clientWidth, video.clientHeight, video.videoWidth, video.videoHeight);
        el.style.setProperty('--sub-w', `${Math.round(pw * 10) / 10}px`);
      } else {
        el.style.removeProperty('--sub-w');
      }
    };
    put();
    const RO = el.ownerDocument.defaultView?.ResizeObserver;   // 画中画小窗里的元素用小窗自己的
    const ro = RO ? new RO(put) : null;
    ro?.observe(el);
    if (video) ro?.observe(video);
    video?.addEventListener('loadedmetadata', put);
    video?.addEventListener('resize', put);
    return () => {
      ro?.disconnect();
      video?.removeEventListener('loadedmetadata', put);
      video?.removeEventListener('resize', put);
    };
  }, [stageRef, again, video, scale]);
}
