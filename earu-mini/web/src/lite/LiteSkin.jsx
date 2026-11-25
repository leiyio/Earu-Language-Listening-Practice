import { cloneElement, useEffect, useRef, useState } from 'react';
import { useMobile } from './useMobile.js';
import { t } from '../i18n/index.js';
import { rememberPlayMode, subScaleOf } from '../components/usePlayerPrefs.js';
import { lt } from './liteText.js';
import { useSlideOut } from './slideOut.js';

// 精简播放界面「歌词式」。
// 由 Session 的 skin 参数挂进舞台、替掉桌面那套浮动层（控制区、字幕列表、浮动答题区）。两种宽度同一份组件，只是摆的地方不同（liteShadow.css）：
//   窄屏（≤760px）：画面在上、下面这些在画面下面
//   宽屏（≥761px）：画面在左、下面这些在右边一栏
//   画面下面：字幕列表，即 LineList
//   「练这句」：进练习；练习是从下往上的抽屉（排序 / 听写），画面一直露着
//   最底一排：循环、上一句、播放 / 暂停、下一句、设置；设置也是抽屉（速度、每句停、循环、原文 / 译文、字号）
// 学习的逻辑一律走 study（useStudySession）给的接口，这里只管排版。
const SIZES = [['mSizeS', 0.85], ['mSizeM', 1], ['mSizeL', 1.15]];
const SPEEDS = [[0.75, '0.75'], [1, '1×'], [1.25, '1.25']];
const CC_ORDER = ['show', 'fog', 'hide'];
const CC_NAME = { show: 'fcCcShow', fog: 'fcCcFog', hide: 'fcCcHide' };


// 手机上听写打字：软键盘弹出来盖住下半屏，iPhone 和新版安卓只缩「看得见的那块」（visualViewport），
// 页面不跟着缩，抽屉连同答案框都压在键盘底下。打字时（答案框有焦点、而且看得见的那块比没打字时矮了一截）给出键盘上面那块的位置，
// 练习抽屉就铺满它（顶条、画面暂时盖住；收起键盘回原样）。只是有焦点、键盘没弹（iPhone 不许网页替人弹键盘）不算
function useKeyboardBox(typing) {
  const [box, setBox] = useState(null);
  const full = useRef(0);        // 没打字时看得见的高度
  const typingRef = useRef(typing);
  typingRef.current = typing;
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const sync = () => {
      if (!typingRef.current) { full.current = vv.height; setBox(null); return; }
      const top = Math.round(vv.offsetTop);
      const h = Math.round(vv.height);
      const next = full.current - vv.height > 120 ? { top, h } : null;
      setBox((b) => (b && next && b.top === next.top && b.h === next.h ? b : next));
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
    return () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); };
  }, [typing]);
  return box;
}

// 进度条要的时间：代理播放器（YtIframeVideo）也发 timeupdate / durationchange
function useClock(video) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!video) return undefined;
    const bump = () => setTick((n) => (n + 1) % 1e9);
    const evs = ['timeupdate', 'durationchange', 'seeked', 'loadedmetadata', 'volumechange'];   // volumechange：「开声音」钮跟着静音与否显示
    evs.forEach((e) => video.addEventListener(e, bump));
    return () => evs.forEach((e) => video.removeEventListener(e, bump));
  }, [video]);
  const cur = Number(video?.currentTime) || 0;
  const dur = Number(video?.duration) || 0;
  return { cur, dur: Number.isFinite(dur) ? dur : 0 };
}

const fmt = (s) => {
  const v = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const ss = String(v % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
};

const Svg = ({ size = 22, children, fill = false }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Ico = {
  loop: <Svg><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" /></Svg>,
  prev: <Svg size={28}><path d="M6 5v14M19 5l-10 7 10 7z" /></Svg>,
  next: <Svg size={28}><path d="M18 5v14M5 5l10 7-10 7z" /></Svg>,
  play: <Svg size={28} fill><path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" /></Svg>,
  pause: <Svg size={26} fill><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Svg>,
  set: <Svg><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Svg>,
  prac: <Svg size={18}><rect x="3" y="4" width="7.5" height="7" rx="1.6" /><rect x="13.5" y="4" width="7.5" height="7" rx="1.6" /><rect x="3" y="14" width="18" height="6" rx="1.6" /></Svg>,
  again: <Svg size={19}><path d="M11 5L6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></Svg>,
  skip: <Svg size={19}><path d="M5 5l8 7-8 7zM13 5l8 7-8 7z" /></Svg>,
};

// 舞台上点一下是「暂停 / 接着放」、点两下是全屏（Player）：这层里的点击不往上冒
const stop = (e) => e.stopPropagation();

function Seg({ items, value, onPick, disabled = false, label }) {
  return (
    <div className="lm-seg" role="group" aria-label={label}>
      {items.map(([v, text]) => (
        <button key={String(v)} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} disabled={disabled}
          onClick={() => onPick(v)}>{text}</button>
      ))}
    </div>
  );
}

function Tog({ on, onFlip, disabled = false, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`lm-tog${on ? ' on' : ''}`} disabled={disabled} onClick={onFlip} />;
}

export default function LiteSkin({ study, changeMode, prefs, setPref, video }) {
  const mobile = useMobile();
  const [sheet, setSheet] = useState(null);   // 'set'：设置抽屉开着
  const [note, setNote] = useState('');       // 底部临时一句（练不了的原因、难度没存上），3 秒后收
  useEffect(() => { if (!note) return undefined; const id = setTimeout(() => setNote(''), 3000); return () => clearTimeout(id); }, [note]);
  const clock = useClock(video);

  const { player, state, cc, mode, position, stepSort, sortOk, sortWhy, practice: pm, kind, setSortPref } = study;
  const practicing = mode === 'sort';
  // 练这句、设置两个抽屉收起也往回滑（slideOut.js）
  const pracOut = useSlideOut(practicing);
  const setOut = useSlideOut(sheet === 'set');
  const [typing, setTyping] = useState(false);   // 练习抽屉里的输入框（听写答案框）有焦点
  const kb = useKeyboardBox(mobile && practicing && typing);
  const pracRef = useRef(null);
  useEffect(() => { if (!practicing) setTyping(false); }, [practicing]);   // 抽屉收了，输入框没来得及报失焦
  // 键盘刚弹出来：答案框不在看得见的地方就把抽屉中间那块滚到它
  useEffect(() => {
    const sheetEl = pracRef.current;
    if (!kb || !sheetEl) return;
    const body = sheetEl.querySelector('.lm-prac-body');
    const ans = sheetEl.querySelector('.dict-answer');
    if (!body || !ans) return;
    const b = body.getBoundingClientRect();
    const a = ans.getBoundingClientRect();
    if (a.top < b.top || a.bottom > b.bottom) body.scrollTop += a.top - b.top - 4;
  }, [kb?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const showGo = !practicing;
  const step = (d) => (practicing ? stepSort(d) : d < 0 ? player?.prev() : player?.next());
  const paused = video ? !!video.paused : !!state.paused;
  const playPause = () => { if (!video) return; if (video.paused) video.play()?.catch?.(() => {}); else video.pause(); };
  const locked = !!pm?.playModeLocked;
  const flipStop = () => { if (!player || locked) return; player.toggleStopMode(); rememberPlayMode(player, setPref, locked); };
  const flipLoop = () => { if (!player) return; player.toggleLoop(); rememberPlayMode(player, setPref, locked); };
  const seek = (e) => {
    if (!video || !clock.dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    video.currentTime = x * clock.dur;
  };
  const pct = clock.dur ? Math.min(100, (clock.cur / clock.dur) * 100) : 0;
  const ccItems = (modes) => CC_ORDER.filter((m) => modes.includes(m)).map((m) => [m, t(CC_NAME[m])]);

  return (
    <div className={`lm${practicing ? ' is-prac' : ''}`} style={{ '--lm-scale': subScaleOf(prefs) }} onClick={stop} onDoubleClick={stop}>
      <div className="lm-main">
        {/* 视频 / 字幕出问题时的提示（同控制区那块 trackPanel，平时什么都不画） */}
        <div className="lm-track">{study.trackPanel}</div>
        {/* 字幕列表：即 LineList。精简界面一直摆着，不要收起、换侧这两颗钮 */}
        {/* 「练这句」浮在列表右下角，和「回到当前句」圆钮摞在一起 */}
        <div className={`lm-list${showGo ? ' has-go' : ''}`}>
          {cloneElement(study.lineList, { onClose: undefined, onSide: undefined, view: cc.enMode === 'hide' && cc.zhMode !== 'hide' ? 'zh' : cc.zhMode === 'hide' && cc.enMode !== 'hide' ? 'en' : 'both' })}
          {showGo && (
            <div className="lm-go">
              {note && <span className="lm-note" role="status">{note}</span>}
              {/* 这句练不了：钮灰着，点了说为什么（触屏没有悬停） */}
              <button type="button" className={`lm-pill${sortOk ? '' : ' off'}`} aria-disabled={!sortOk || undefined} title={sortOk ? undefined : sortWhy}
                onClick={() => (sortOk ? changeMode('sort') : setNote(sortWhy || ''))}>{Ico.prac}{lt('mPractice')}</button>
            </div>
          )}
        </div>

        <div className="lm-bottom">
          <div className="lm-prog" onClick={seek} role="slider" aria-valuemin={0} aria-valuemax={Math.round(clock.dur)} aria-valuenow={Math.round(clock.cur)}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="lm-times"><span>{fmt(clock.cur)}</span><span>{fmt(clock.dur)}</span></div>
          <div className="lm-ctl">
            <button type="button" className={`lm-ib${state.loopMode ? ' on' : ''}`} title={t('fcLoop')} aria-label={t('fcLoop')} aria-pressed={!!state.loopMode} onClick={flipLoop}>{Ico.loop}</button>
            <button type="button" className="lm-ib" title={t('prevLine')} aria-label={t('prevLine')} onClick={() => step(-1)}>{Ico.prev}</button>
            <button type="button" className="lm-play" title={paused ? t('fcPlay') : t('fcPause')} aria-label={paused ? t('fcPlay') : t('fcPause')} onClick={playPause}>{paused ? Ico.play : Ico.pause}</button>
            <button type="button" className="lm-ib" title={t('nextLine')} aria-label={t('nextLine')} onClick={() => step(1)}>{Ico.next}</button>
            <button type="button" className={`lm-ib${sheet === 'set' ? ' on' : ''}`} title={t('settings')} aria-label={t('settings')} onClick={() => setSheet(sheet === 'set' ? null : 'set')}>{Ico.set}</button>
          </div>
        </div>
      </div>

      {/* 手机上练习抽屉顶上那条缝：压暗，点一下收起（电脑上不画，liteShadow.css） */}
      <div ref={pracOut} style={{ display: 'contents' }}>
      {practicing && !kb && <button type="button" className="lm-prac-mask" aria-label={t('wcClose')} onClick={() => changeMode('listen')} />}
      {practicing && (
        <div ref={pracRef} className={`lm-sheet lm-prac${kb ? ' is-kb' : ''}`} style={kb ? { top: kb.top, height: kb.h, bottom: 'auto' } : undefined}
          onFocus={(e) => { if (e.target.tagName === 'INPUT') setTyping(true); }}
          onBlur={(e) => { if (e.target.tagName === 'INPUT') setTyping(false); }}>
          <button type="button" className="lm-grab" aria-label={t('wcClose')} onClick={() => changeMode('listen')} />
          <div className="lm-prac-head">
            {pm?.showKindSeg
              ? <Seg label={t('kindGroup')} items={[['sort', t('kindSort')], ['dictate', t('kindDictate')]]} value={kind} onPick={(k) => setSortPref('kind', k)} />
              : <span className="lm-prac-title">{t('kindSort')}</span>}
            <span className="lm-pos">{position}</span>
          </div>
          <div className="lm-prac-body">{study.sortPanel(true)}</div>
          <div className="lm-btnrow">
            {/* 按下时不抢答案框的焦点：打着字点「再听」键盘不收 */}
            <button type="button" className="lm-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => player?.replay()}>{Ico.again}{lt('mAgain')}</button>
            <button type="button" className="lm-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => stepSort(1)}>
              <span className="lm-skip-t">{Ico.skip}{lt('mSkip')}</span>
            </button>
          </div>
        </div>
      )}
      </div>

      <div ref={setOut} style={{ display: 'contents' }}>
      {sheet === 'set' && (
        <>
          <div className="lm-dim" onClick={() => setSheet(null)} />
          <div className="lm-sheet lm-set" data-blocks-keys="">
            <button type="button" className="lm-grab" aria-label={t('wcClose')} onClick={() => setSheet(null)} />
            <div className="lm-set-title">{t('settings')}</div>
            <div className="lm-glabel">{lt('mGrpPlay')}</div>
            <div className="lm-grp">
              <div className="lm-row2"><span>{t('speed')}</span>
                <Seg label={t('speed')} items={SPEEDS} value={prefs?.speed ?? 1} onPick={(r) => setPref('speed', r)} /></div>
              <div className="lm-row2"><span>{lt('mStopEach')}</span>
                <Tog label={lt('mStopEach')} on={state.playMode === 'stop'} disabled={locked} onFlip={flipStop} /></div>
              <div className="lm-row2"><span>{lt('mLoopLine')}</span>
                <Tog label={lt('mLoopLine')} on={!!state.loopMode} onFlip={flipLoop} /></div>
            </div>
            <div className="lm-glabel">{lt('mGrpSub')}</div>
            <div className="lm-grp">
              <div className="lm-row2"><span>{lt('mSrc')}</span>
                <Seg label={lt('mSrc')} items={ccItems(cc.modes)} value={cc.enMode} disabled={!!cc.forceMaskEn} onPick={(m) => cc.setEnMode(m)} /></div>
              {study.tr.on && (
                <div className="lm-row2"><span>{lt('mTr')}</span>
                  <Seg label={lt('mTr')} items={ccItems(cc.modes)} value={cc.zhMode} onPick={(m) => cc.setZhMode(m)} /></div>
              )}
              <div className="lm-row2"><span>{lt('mSize')}</span>
                <Seg label={lt('mSize')} items={SIZES.map(([k, v]) => [v, lt(k)])} value={subScaleOf(prefs)} onPick={(v) => setPref('subScale', v)} /></div>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
