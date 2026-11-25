// 学习语言书写方向的纯函数（如阿拉伯语从右往左）。方向只来自语言档案 shared/langProfile.js 的 dir 列，这里不认语言代码。
// 注意两件事别混：界面语言是阿拉伯语（整页镜像，<html dir>，i18n/index.js isRtlUi）和在学的语言是阿拉伯语（练习区、字幕里的学习文字从右往左，下面这些）。
import { isRtlLearn } from '../../../shared/langProfile.js';

// 左右方向键在「写字方向」里的意思：-1 = 往前（回到前一格 / 前一个词），+1 = 往后，0 = 不是左右键。
// 从左往右的语言：左 = 前、右 = 后；从右往左的语言反过来（光标在 dir="rtl" 的输入框里本来就是这样走的，格子之间的跳转要跟上）
export function arrowStep(key, learn) {
  const rtl = isRtlLearn(learn);
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  return 0;
}

