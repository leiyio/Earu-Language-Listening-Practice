import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react';
import { t, learnAttrs, nativeAttrs, nativeNeedsAttrs } from '../i18n/index.js';
import { useUiLang } from '../i18n/useUiLang.js';
import { LocateIcon, SearchIcon, UpIcon, DownIcon, CloseIcon, LineLoopIcon } from './icons.jsx';
import { useLineSearch } from './useLineSearch.js';
import LearnText from './LearnText.jsx';
import MaskText from './sort/MaskText.jsx';

const fmt = (s) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

// 字幕列表的一行：时间、原文（en：'text' 明文 | 'mosaic' 雾 | 其他 打码）、这句的循环钮
const Row = memo(function Row({ line, zh = null, view = 'both', pending = false, current, looping, loopOk = true, player, en = 'text', zhL = 'text' }) {
  useUiLang();
  const showEn = view !== 'zh' || zh == null;
  const showZh = view !== 'en';
  const masked = en === 'mask' || (zh != null && zhL === 'mask');
  const enNode = en === 'text' ? <LearnText text={line.text} attrs={learnAttrs()} />
    : en === 'mosaic' ? <LearnText text={line.text} className="en sub-mosaic" attrs={{ ...learnAttrs(), 'aria-hidden': true }} />
    : <MaskText still className="en" attrs={learnAttrs()} text={line.text} />;
  const zhAttrs = nativeNeedsAttrs() ? nativeAttrs() : null;
  const zhNode = zh == null ? null : zhL === 'text' ? <span className="zh" {...zhAttrs}>{zh}</span>
    : zhL === 'mosaic' ? <span className="zh sub-mosaic" {...zhAttrs} aria-hidden>{zh}</span>
    : <MaskText still className="zh" attrs={zhAttrs} text={zh} />;
  return (
    <li
      data-i={line.i}
      className={`line ${current ? 'current' : ''} ${looping ? 'looping' : ''} ${masked ? 'masked' : ''}`}
      onClick={() => player?.playLine(line.i)}
    >
      <span className="time">{fmt(line.start)}</span>
      <span className="text">
        {showEn && enNode}
        {showZh && (zhNode || (pending ? <span className="zh pending">{t('translating')}</span> : null))}
      </span>
      <span className="line-acts">
        <button
          type="button" className="loop-btn" title={t('loop')} aria-label={t('loop')} disabled={!looping && !loopOk}
          onClick={(e) => {
            e.stopPropagation();
            if (looping) player?.setLoop(-1);
            else { player?.setLoop(line.i); player?.playLine(line.i); }
          }}
        ><LineLoopIcon /></button>
      </span>
    </li>
  );
});

// layerAt(i) → {en}：第 i 句原文怎么出（display.js listLayers：排序时手上那一题的那层打码，控制区「遮盖」点亮时打雾）
// position：「第 N / M 句」，写在标题「字幕」旁边；不传就写「共 M 句」
const keepFocus = (e) => e.preventDefault();
const ALL_TEXT = () => ({ en: 'text', zh: 'text' });
// 译文在列表标题栏的小图标：只在翻着或出错时出，悬停说一句（没开译文时整个不出）
const TrIcon = ({ bad }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 5h9M8.5 3v2M6 5c.6 3.2 2.700 5.600 5.500 7M11.500 5c-.6 3.200-3 6-6.500 7.500M13 21l4-10 4 10M14.500 17.500h5" />
    {bad && <circle cx="20" cy="4" r="2" fill="currentColor" stroke="none" />}
  </svg>
);
export default function LineList({ lines, state, player, loading, progress, subsError, position = '', layerAt = null, zh = null, pending = false, trFailed = 0, view = 'both' }) {
  useUiLang();
  const ly = layerAt || ALL_TEXT;
  const listRef = useRef(null);
  const [follow, setFollow] = useState(true);
  const current = state.loopIndex >= 0 ? state.loopIndex : state.index;

  // 自动滚到当前句；用户自己滚动列表时暂停跟随。只滚列表自己，不用 scrollIntoView：
  // 浮动模式下列表在播放器舞台里，scrollIntoView 会把整个舞台连视频一起滚歪（舞台 overflow:hidden 也挡不住程序滚动）
  // 读出错了但已经读到一些（比如读到一半被拒）：读到的照样列出来，只有一句都没有才写「读取字幕失败」
  const hasList = !loading && lines.length > 0;
  useEffect(() => {
    if (!follow || current < 0) return;
    const list = listRef.current;
    const el = list?.querySelector(`[data-i="${current}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
    list.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' });
  }, [current, follow, lines]);

  // 搜索（useLineSearch）：标题行换成搜索框 + 「第几处 / 共几处」+ 上一处、下一处、关闭。
  // 只从放大镜钮开，不接 Ctrl+F 快捷键
  const search = useLineSearch({ listRef, ready: hasList, current, setFollow });
  const asked = search.q.trim();


  return (
    <div className="lines-panel">
      <div className="lines-head">
        {search.open ? (
          <div className="search-row">
            <label className="search-box">
              <SearchIcon size={16} />
              <input ref={search.inputRef} value={search.q} onChange={(e) => search.setQ(e.target.value)} onKeyDown={search.onKeyDown}
                placeholder={t('searchLinesPh')} aria-label={t('searchLinesPh')} autoComplete="off" spellCheck={false} enterKeyHint="search" />
            </label>
            {/* 「第几处 / 共几处」；搜不到写红色的 0 */}
            <span className={`search-count${asked && !search.n ? ' none' : ''}`}>{!asked ? '' : search.n ? `${search.at + 1}/${search.n}` : '0'}</span>
            {/* 上一处 / 下一处点了光标留在框里（keepFocus）：接着能改词、按回车、按 Esc 只关搜索；不然光标跑到钮上，Esc 会把整个抽屉收掉 */}
            <button type="button" className="btn small lines-icon" onMouseDown={keepFocus} onClick={() => search.step(-1)} disabled={!search.n}
              title={t('searchPrev')} aria-label={t('searchPrev')}><UpIcon /></button>
            <button type="button" className="btn small lines-icon" onMouseDown={keepFocus} onClick={() => search.step(1)} disabled={!search.n}
              title={t('searchNext')} aria-label={t('searchNext')}><DownIcon /></button>
            <button type="button" className="btn small lines-icon" onClick={search.close}
              title={t('searchClose')} aria-label={t('searchClose')}><CloseIcon /></button>
          </div>
        ) : (
          <>
            <span>{t('lines')}</span>
            <span className="muted small">{position || (lines.length ? t('linesCount', { n: lines.length }) : '')}</span>
            {zh && (pending || trFailed > 0) && (
              <span className={`tr-status${trFailed > 0 && !pending ? ' bad' : ''}`}
                title={pending ? t('trProgress', { done: zh.filter((x) => x != null).length, total: lines.length }) : t('trError')}>
                <TrIcon bad={trFailed > 0 && !pending} />
              </span>
            )}
            {/* 图标画的是点下去会变成的样子，悬停说清楚（能用图标就用图标：各语言字长不一） */}
            {hasList && (
              <button type="button" className="btn small lines-icon lines-search" onClick={search.openSearch}
                title={t('searchLines')} aria-label={t('searchLines')}>
                <SearchIcon />
              </button>
            )}
          </>
        )}
      </div>
      {loading ? (
        <div className="lines-empty muted">{t('extracting', { pct: Math.round(progress * 100) })}</div>
      ) : subsError && !lines.length ? (
        <div className="lines-empty bad" title={subsError}>{t('subsReadFailed')}</div>
      ) : !lines.length ? (
        <div className="lines-empty muted">{t('noLearnSub')}</div>
      ) : (
        <ul className={`lines view-${view}`} ref={listRef} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}
          onClickCapture={search.open ? search.onPick : undefined}>
          {lines.map((l) => {
            const y = ly(l.i);
            return (
              <Fragment key={l.i}>
              {l.gapBefore && <li className="lines-gap" aria-hidden="true" />}
              <Row line={l} zh={zh ? zh[l.i] ?? null : null} view={zh ? view : 'en'} pending={!!zh && pending} current={l.i === current} looping={l.i === state.loopIndex} loopOk={!player || player.canLoop(l.i)} player={player} en={y.en} zhL={y.zh || 'text'} />
              </Fragment>
            );
          })}
        </ul>
      )}
      {/* 回到当前句：自己滚走了列表才出，浮在列表右下角的浮动按钮，不占一行 */}
      {!follow && hasList && (
        <button type="button" className="lines-back" onClick={() => setFollow(true)} title={t('backToCurrent')} aria-label={t('backToCurrent')}>
          <LocateIcon />
        </button>
      )}
    </div>
  );
}
