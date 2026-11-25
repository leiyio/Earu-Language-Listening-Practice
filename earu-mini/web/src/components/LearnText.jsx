import { memo } from 'react';

// 学习内容的一句原文（画面底部原文、字幕列表的原文）：普通文字，没有注音、没有查词。
// className：外层的类（画面、列表都是 'en'）；attrs：learnAttrs()（从右往左的语言给 dir / lang）。
function LearnText({ text, className = 'en', attrs = null }) {
  return <span className={className} {...attrs}>{text}</span>;
}

export default memo(LearnText);
