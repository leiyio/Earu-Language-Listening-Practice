import { memo } from 'react';
import { t, learnAttrs } from '../../i18n/index.js';
import { useUiLang } from '../../i18n/useUiLang.js';
import { Token } from './AnswerZone.jsx';

// 词块区：打乱后的药丸词块（预摆的词不在这里）。空了写「排列正确」或「词块已全部使用，可在答案区调整」（C:5588-5598）。
// 和答案区一样只吃题目和拖动状态，播放时间不传进来（memo，01 §4 第 1 条）。
// memo 挡住了父组件的重画：换界面语言时自己订一下，读屏名、预摆词的悬停提示跟着换
// 词块套在一层轨道（.sort-bank-track）里：平时它是 display: contents，词块照旧像 .sort-bank 的直接孩子那样折行；
// 放不下时轨道撑宽、词块区左右划（useElasticBank.js）。
// 有词块时阿拉伯语界面里照旧从左往右（learnAttrs，学英语就是 enAttrs()；学中文时标 lang，同答题区）；空了只剩一句界面文字（「排列正确」这类），跟着界面的方向
function TokenBank({ bank, placeholder, dragId, onTokenPointerDown, onTokenClick }) {
  useUiLang();
  return (
    <div className="sort-bank" data-zone="bank" aria-label={t('sortBankArea')} {...(bank.length ? learnAttrs() : null)}>
      <div className="sort-bank-track">
        {bank.length
          ? bank.map((tok) => (
            <Token key={tok.id} token={tok} dragging={dragId === tok.id} onPointerDown={onTokenPointerDown} onClick={onTokenClick} />
          ))
          : <span className="sort-placeholder">{placeholder}</span>}
      </div>
    </div>
  );
}

export default memo(TokenBank);
