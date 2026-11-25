import { Fragment, memo } from 'react';
import { t, learnAttrs } from '../../i18n/index.js';
import { useUiLang } from '../../i18n/useUiLang.js';
import { literalText } from './display.js';

// 一个词块（答案区里的「写在横线上的词」、词块区里的药丸）。key 用 token.id（同一句重新打乱 id 不变，换句不撞），
// 词块的 DOM 节点在拖动中不会被换掉（01 §4 第 1 条）。
// 预摆的词：压暗、斜纹、点不走拖不动，title「这个词已经替你摆好了，不用动它」。
export function Token({ token, dragging, drop, onPointerDown, onClick }) {
  const preset = !!token.preset;
  return (
    <button
      type="button"
      className={`sort-tok${preset ? ' is-preset' : ''}${dragging ? ' is-dragging' : ''}${drop ? ' is-drop-target' : ''}`}
      data-token-id={token.id}
      data-preset={preset ? '1' : undefined}
      aria-disabled={preset || undefined}
      title={preset ? t('sortPresetTitle') : undefined}
      onPointerDown={(e) => { if (!preset) onPointerDown?.(e, token); }}
      onClick={preset ? undefined : () => onClick?.(token)}
    >{token.text}</button>
  );
}

// 答案区：句子模板（标点、符号、非英文照原样固定显示，每个英文词一个等宽空位，看不出词多长）。
// 多人对白的换行在固定文字里，样式上 white-space: pre-wrap 显示成换行。
// 排对之后：词块原样留着（拆词才是练习的意义，合成纯文本就白练了），外面套一个绿色整句框，点框重播本句一次。
// 播放时间这类高频状态不传进来（memo）：只有题目、拖动状态变了才重画（01 §4 第 1 条）。
// memo 挡住了父组件的重画：换界面语言时自己订一下，空位、预摆词、重播的悬停提示跟着换
function AnswerTemplate({ puzzle, dragId, highlight, onTokenPointerDown, onTokenClick, onReplay }) {
  useUiLang();
  if (!puzzle) {
    return <div className="sort-template"><span className="sort-placeholder">{t('sortWaitSubs')}</span></div>;
  }
  // 英文句子：阿拉伯语界面里照旧从左往右（learnAttrs，学英语就是 enAttrs()：词块、空位、标点按英文的顺序排；拖放按位置算，也是从左往右）。
  // 学中文时标 lang（zh-CN / zh-TW）：日文界面里不标，词块会画成日文字形；词块上不标拼音
  const tpl = (
    <div className="sort-template" {...learnAttrs()}>
      {puzzle.parts.map((part, k) => {
        // 固定文字（标点、空格）去掉 ♪ 这类特殊符号再显示（display.js literalText）
        if (part.type === 'literal') return <Fragment key={`l${k}`}>{literalText(part.text)}</Fragment>;
        const tok = puzzle.answer[part.slotIndex];
        if (tok) {
          return (
            <Token key={tok.id} token={tok} dragging={dragId === tok.id} drop={highlight === `t${tok.id}`}
              onPointerDown={onTokenPointerDown} onClick={onTokenClick} />
          );
        }
        return (
          <span key={`s${part.slotIndex}`} className={`sort-slot${highlight === `s${part.slotIndex}` ? ' is-drop-target' : ''}`}
            data-slot-index={part.slotIndex} title={t('sortSlotTitle', { n: part.slotIndex + 1 })}>_______</span>
        );
      })}
    </div>
  );
  if (!puzzle.solved) return tpl;
  return (
    <div className="sort-solved" role="button" tabIndex={0} title={t('sortReplayTitle')}
      onClick={(e) => { e.stopPropagation(); onReplay?.(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onReplay?.(); } }}>
      {tpl}
    </div>
  );
}

export default memo(AnswerTemplate);
