// 防误点（浮动模式-实现说明 §1.3）：按下和松开不在同一个元素上时，浏览器补发的 click 会落到两者的共同祖先 .stage 上，
// 触发「单击画面暂停 / 播放」——拖完控制区、答题区松手，触屏点醒闲置的答题区，都会这样。
// 这些地方松手时调 suppressStageClick(ms)，Player 的 onStageClick 先问 stageClickSuppressed()，在时间窗里就什么都不做。
// 时钟可以注入，Node 里能测。
import { CLICK_SUPPRESS_MS } from '../../core/floatLayout.js';

let until = 0;
let now = () => Date.now();

export function suppressStageClick(ms = CLICK_SUPPRESS_MS) {
  until = Math.max(until, now() + ms); // 连着调取较晚的那个结束时间
}

export function stageClickSuppressed() {
  return now() < until;
}

