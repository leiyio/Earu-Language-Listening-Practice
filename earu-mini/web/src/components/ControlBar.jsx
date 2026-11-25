import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t, hasTranslation, ltrAttrs, uiDirAttrs } from '../i18n/index.js';
import { PlayIcon, PauseIcon, PrevLineIcon, NextLineIcon, LoopIcon, CcIcon, VolumeIcon, FullscreenIcon, PipIcon, QualityIcon } from './icons.jsx';
import { insideEvent } from '../core/hostRoot.js';
import PopMenu from './PopMenu.jsx';

// 速度档：0.5 0.75 1 1.25 1.5
export const RATES = [0.5, 0.75, 1, 1.25, 1.5];

// 没有字幕时那两颗按钮是快退 / 快进 10 秒：和「上一句 / 下一句」同一个带箭头的圆弧，中间的「句」换成「10」
// （尺寸、线宽照 icons.jsx 的统一规格：24×24、2px）
const Seek10Icon = ({ back }) => (
  <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <g transform={back ? undefined : 'translate(24 0) scale(-1 1)'}>
      <path d="M5.6 7.5A8 8 0 1 1 4 12" />
      <path d="M5.6 3.5v4h4" />
    </g>
    <text x="12" y="15.4" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none"
      fontFamily="Arial, sans-serif">10</text>
  </svg>
);

const fmt = (s) => {
  if (!Number.isFinite(s)) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
};

// 视频时间：播放中用 rAF 刷新，进度条才顺
function useVideoTime(video) {
  const [time, setTime] = useState({ cur: 0, dur: 0, buf: 0 });
  useEffect(() => {
    if (!video) return;
    let raf = 0;
    const read = () => {
      const b = video.buffered;
      let buf = 0;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.5) buf = Math.max(buf, b.end(i));
      setTime({ cur: video.currentTime, dur: video.duration || 0, buf });
    };
    const loop = () => { read(); raf = video.paused ? 0 : requestAnimationFrame(loop); };
    const onPlay = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const evs = ['timeupdate', 'durationchange', 'seeked', 'seeking', 'progress', 'loadedmetadata'];
    evs.forEach((e) => video.addEventListener(e, read));
    video.addEventListener('play', onPlay);
    read();
    return () => {
      cancelAnimationFrame(raf);
      evs.forEach((e) => video.removeEventListener(e, read));
      video.removeEventListener('play', onPlay);
    };
  }, [video]);
  return time;
}

// 远程片边读边出时字幕读到的段（mkv.js extractViaCues 的 diag.prog.ranges.all，[起, 止] 秒）：读的细节在 ref 里（不让界面跟着每一组重画），
// 这里每秒取一次，段没变不重画；不给 ref（本机文件、读全了）回 null
function useReadRanges(diagRef) {
  const [key, setKey] = useState('');
  useEffect(() => {
    setKey('');
    if (!diagRef) return undefined;
    const read = () => setKey(JSON.stringify(diagRef.current?.prog?.ranges?.all || ''));
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, [diagRef]);
  return useMemo(() => { try { const a = JSON.parse(key || '""'); return Array.isArray(a) ? a : null; } catch { return null; } }, [key]);
}

// subsRead：见 useReadRanges，给了就在条的下沿画出字幕读到的段（片长照真的算，没读到的地方照样能拖过去）
function ProgressBar({ video, time, subsRead = null }) {
  const ref = useRef(null);
  const read = useReadRanges(subsRead);
  const [hover, setHover] = useState(null); // { x, t }
  const [drag, setDrag] = useState(null); // 拖动中的时间
  const dur = time.dur || 0;
  const ratioAt = (e) => {
    const r = ref.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const shown = drag ?? time.cur;
  return (
    <div
      className={`cb-progress ${drag != null ? 'dragging' : ''}`} ref={ref}
      onPointerDown={(e) => {
        if (!dur) return;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 拖出条外也能跟着走，失败不影响点按 */ }
        setDrag(ratioAt(e) * dur);
      }}
      onPointerMove={(e) => {
        if (!dur) return;
        const r = ratioAt(e);
        setHover({ x: r * 100, t: r * dur });
        if (drag != null) setDrag(r * dur);
      }}
      onPointerUp={(e) => {
        if (drag == null) return;
        video.currentTime = ratioAt(e) * dur;
        setDrag(null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="cb-track">
        <div className="cb-buf" style={{ width: `${dur ? (time.buf / dur) * 100 : 0}%` }} />
        <div className="cb-played" style={{ width: `${dur ? (shown / dur) * 100 : 0}%` }} />
        <div className="cb-thumb" style={{ left: `${dur ? (shown / dur) * 100 : 0}%` }} />
        {dur > 0 && read?.map(([a, b]) => (
          <div key={a} className="cb-read" style={{ left: `${(Math.min(a, dur) / dur) * 100}%`, width: `${(Math.max(0, Math.min(b, dur) - a) / dur) * 100}%` }} />
        ))}
      </div>
      {hover && <div className="cb-tip" style={{ left: `${hover.x}%` }}>{fmt(hover.t)}</div>}
    </div>
  );
}

// 音量：鼠标移到喇叭上，上方弹出竖条（上面显示数值），上下拖或滚轮调
function Volume({ video }) {
  const [vol, setVol] = useState({ v: 1, muted: false });
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!video) return;
    const read = () => setVol({ v: video.volume, muted: video.muted });
    video.addEventListener('volumechange', read);
    read();
    return () => video.removeEventListener('volumechange', read);
  }, [video]);
  const level = vol.muted ? 0 : vol.v;
  const set = (x) => {
    const v = Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
    video.volume = v;
    video.muted = v === 0;
  };
  const fromPointer = (e) => {
    const r = trackRef.current.getBoundingClientRect();
    set((r.bottom - e.clientY) / r.height);
  };
  return (
    <div className={`cb-volume ${drag ? 'dragging' : ''}`} onWheel={(e) => set(level + (e.deltaY < 0 ? 0.05 : -0.05))}>
      <div className="cb-vol-pop">
        <div className="cb-vol-num">{Math.round(level * 100)}</div>
        <div
          className="cb-vol-track" ref={trackRef}
          onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 无所谓 */ } setDrag(true); fromPointer(e); }}
          onPointerMove={(e) => { if (drag) fromPointer(e); }}
          onPointerUp={() => setDrag(false)}
          onPointerCancel={() => setDrag(false)}
        >
          <div className="cb-vol-fill" style={{ height: `${level * 100}%` }} />
          <div className="cb-vol-knob" style={{ bottom: `${level * 100}%` }} />
        </div>
      </div>
      <button className="cb-btn" onClick={() => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; }}
        title={t(level ? 'cbMute' : 'cbUnmute')}>
        <VolumeIcon level={level} />
      </button>
    </div>
  );
}

// 速度菜单：弹出菜单的外框在 PopMenu.jsx（控制区的播放方式菜单共用）
function RateMenu({ rate, setRate }) {
  return (
    <PopMenu
      button={({ toggle }) => (
        <button className={`cb-btn cb-text ${rate !== 1 ? 'on' : ''}`} onClick={toggle} title={t('speed')}>
          {rate === 1 ? t('cbRate') : `${rate}×`}
        </button>
      )}
      items={[...RATES].reverse().map((r) => ({ key: r, node: `${r}×`, on: r === rate, onPick: () => setRate(r) }))}
    />
  );
}

// 画质：quality 是外部给的对象（subscribe / get / choose，菜单名、锁的说明也由它给）；不传就不出这一项。
// （tip(名字) 是按钮的悬停说明。）
const NO_SUB = () => () => {};
const NO_Q = () => null;
const MiniLock = () => (
  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </svg>
);
function QualityMenu({ quality }) {
  const st = useSyncExternalStore(quality ? quality.subscribe : NO_SUB, quality ? quality.get : NO_Q);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!insideEvent(ref.current, e)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (!st || !st.list || !st.list.length) return null;
  const cur = st.list.find((x) => x.qn === st.current);
  return (
    <div className="cb-menu-wrap" ref={ref}>
      <button className="cb-btn cb-quality" onClick={() => setOpen((o) => !o)} title={cur ? quality.tip(cur.label) : quality.title} aria-label={quality.title}>
        <QualityIcon />
      </button>
      {open && (
        <ul className="cb-menu cb-q-menu">
          {st.list.map((x) => (
            <li key={x.qn}>
              <button className={x.qn === st.current ? 'on' : ''} title={x.lock ? quality.lockTip : undefined}
                onClick={() => { setOpen(false); if (x.qn !== st.current) quality.choose(x.qn); }}>
                <span>{x.label}</span>{x.lock && <MiniLock />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// CC：原文、译文分开开关。勾上 = 照常出，没勾 = 糊成雾（字幕打码），
// 和控制区「字幕打码」两颗按钮是同一对设置。注释不打码、没有开关。
// 原文那一项学中文时文案自动换成「中文字幕」（i18n LEARN_ALT subEn → subLearn）。
// 注音放在学习设置里，这里没有「拼音」项：
// 菜单是原文、译文两项，学什么语言都一样
// initialOpen：测试用（静态渲染没法点开菜单），平时不传
// forceMaskEn：练习时原文强制打码（practiceMode.js forceMask），原文那一项不出；没有译文可开的话整个菜单不出
export function SubMenu({ subEn, subZh, setSubEn, setSubZh, initialOpen = false, forceMaskEn = false }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!insideEvent(ref.current, e)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (forceMaskEn && !hasTranslation()) return null;
  const any = (!forceMaskEn && subEn) || subZh;
  return (
    <div className="cb-menu-wrap" ref={ref}>
      <button className="cb-btn" onClick={() => setOpen((o) => !o)} title={t('subMenu')}><CcIcon on={any} /></button>
      {open && (
        <ul className="cb-menu cb-check" {...uiDirAttrs()}>
          {!forceMaskEn && <li><button className={subEn ? 'on' : ''} onClick={() => setSubEn(!subEn)}>{subEn ? '✓ ' : ''}{t('subEn')}</button></li>}
          {/* 母语就是英语：没有译文，「译文」不出 */}
          {hasTranslation() && <li><button className={subZh ? 'on' : ''} onClick={() => setSubZh(!subZh)}>{subZh ? '✓ ' : ''}{t('subZh')}</button></li>}
        </ul>
      )}
    </div>
  );
}

// hasLines：这部片有没有句子。没有时 player.prev()/next() 退回前后 10 秒（sentencePlayer.js step），
// 两颗按钮就画成快退 / 快进、提示写「后退 10 秒」（有字幕时才换成上一句 / 下一句）
// onStep(dir)：排序模式下上一句 / 下一句走排序那套（跳过剥完没词的句子，App 给）；不传 = player.prev()/next()。
// 循环按钮两个模式一样（toggleLoop）；拖进度条退出循环模式由播放器自己管（sentencePlayer onSeeking）
// inFloat：浮动模式（浮动模式-实现说明 §2.5 B 段）：速度、循环、字幕三颗挪进控制区，这里不放（同一个按钮不放两处）；
//   onList：给字幕列表时（精听；练习也给，practiceMode.js listOk）多一颗「字幕列表」，开关左边的整片字幕抽屉（listOpen 时亮）。侧栏布局的控制条一点不变
// mobile：窄屏布局（core/mobile.js）。点画面才出的那条：进度条（手指好按、圆点常显）、播放 / 暂停、时间，浏览器有全屏才出全屏；
//   画中画（系统自带的小窗，只有画面、没字幕；浏览器给才出）。
//   不放音量（iPhone 网页改不了音量，用侧键）、速度和字幕（在「⋯」面板里）。上一句 / 下一句 / 循环竖着拿时在下面那排大按钮里，
//   只在横着拿（只看片、下面那排藏了）时出（.cb-land，styles.css）。条藏着时画面底边留一道细进度（.cb-mini）。
//   canFs：这个浏览器能让舞台全屏（iPhone 没有，点了没反应，不出按钮）
export default function ControlBar({ video, player, paused, looping, loopLocked = false, rate, setRate, subEn, subZh, setSubEn, setSubZh, isFs, toggleFullscreen, deskFs = false, inPip, togglePip, canPip, hasLines = true, onStep, inFloat = false, onList, listOpen = false, mobile = false, canFs = true, quality = null, forceMaskEn = false, pipCc = null, setPipCc, subsRead = null }) {
  const time = useVideoTime(video);
  if (!video) return null;
  const stop = (e) => e.stopPropagation(); // 控制条上的点击不要触发「点画面暂停 / 双击全屏」
  if (mobile) {
    const pct = time.dur ? Math.min(100, (time.cur / time.dur) * 100) : 0;
    return (
      <>
        <div className="cbar is-m" onClick={stop} onDoubleClick={stop} {...ltrAttrs()}>
          <ProgressBar video={video} time={time} subsRead={subsRead} />
          <div className="cb-row">
            <div className="cb-left">
              <button className="cb-btn" onClick={() => (video.paused ? video.play().catch(() => {}) : video.pause())}
                aria-label={paused ? t('fcPlay') : t('fcPause')}>
                {paused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button className="cb-btn cb-land" onClick={() => (onStep ? onStep(-1) : player?.prev())} aria-label={t(hasLines ? 'prevLine' : 'back10')}>
                {hasLines ? <PrevLineIcon /> : <Seek10Icon back />}
              </button>
              <button className="cb-btn cb-land" onClick={() => (onStep ? onStep(1) : player?.next())} aria-label={t(hasLines ? 'nextLine' : 'fwd10')}>
                {hasLines ? <NextLineIcon /> : <Seek10Icon />}
              </button>
              <span className="cb-time"><b>{fmt(time.cur)}</b> / {fmt(time.dur)}</span>
            </div>
            <div className="cb-right">
              <button className={`cb-btn cb-land ${looping ? 'on' : ''}`} onClick={() => player?.toggleLoop()} aria-label={t('loop')} aria-pressed={!!looping} disabled={!!loopLocked}><LoopIcon /></button>
              {canPip && (
                <button className={`cb-btn ${inPip ? 'on' : ''}`} onClick={togglePip} aria-label={t(inPip ? 'cbPipBack' : 'cbPip')} aria-pressed={!!inPip}>
                  <PipIcon exit={inPip} />
                </button>
              )}
              {canFs && !inPip && (
                <button className="cb-btn" onClick={toggleFullscreen} aria-label={t(isFs ? 'cbFsExit' : 'cbFs')}>
                  <FullscreenIcon exit={isFs} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="cb-mini" aria-hidden {...ltrAttrs()}><i style={{ width: `${pct}%` }} /></div>
      </>
    );
  }
  return (
    <div className="cbar" onClick={stop} onDoubleClick={stop} {...ltrAttrs()}>
      <ProgressBar video={video} time={time} subsRead={subsRead} />
      <div className="cb-row">
        <div className="cb-left">
          <button className="cb-btn" onClick={() => (video.paused ? video.play() : video.pause())} title={t(paused ? 'cbPlayKey' : 'cbPauseKey')}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button className="cb-btn" onClick={() => (onStep ? onStep(-1) : player?.prev())} title={t('withKey', { label: t(hasLines ? 'prevLine' : 'back10'), key: '←' })}>
            {hasLines ? <PrevLineIcon /> : <Seek10Icon back />}
          </button>
          <button className="cb-btn" onClick={() => (onStep ? onStep(1) : player?.next())} title={t('withKey', { label: t(hasLines ? 'nextLine' : 'fwd10'), key: '→' })}>
            {hasLines ? <NextLineIcon /> : <Seek10Icon />}
          </button>
          <span className="cb-time"><b>{fmt(time.cur)}</b> / {fmt(time.dur)}</span>
        </div>
        <div className="cb-right">
          {!inFloat && <RateMenu rate={rate} setRate={setRate} />}
          {!inFloat && <button className={`cb-btn cb-loop ${looping ? 'on' : ''}`} onClick={() => player?.toggleLoop()} title={t('withKey', { label: t('loop'), key: 'R' })} disabled={!!loopLocked}><LoopIcon /></button>}
          {/* pipCc：画中画里 CC 只有一颗开关，亮 = 两行照原样出、灭 = 都不出（Player 管，和控制区那两颗互不影响） */}
          {!inFloat && (pipCc != null
            ? <button className={`cb-btn${pipCc ? ' on' : ''}`} onClick={() => setPipCc(!pipCc)} title={t('subMenu')} aria-pressed={pipCc}><CcIcon on={pipCc} /></button>
            : <SubMenu subEn={subEn} subZh={subZh} setSubEn={setSubEn} setSubZh={setSubZh} forceMaskEn={forceMaskEn} />)}
          {inFloat && onList && (
            <button className={`cb-btn cb-text ${listOpen ? 'on' : ''}`} onClick={onList} title={t('listTabTitle')}>{t('listButton')}</button>
          )}
          {quality && !inPip && <QualityMenu quality={quality} />}
          <Volume video={video} />
          {/* 桌面版（deskFs）P 键不开画中画（Player.jsx 'pip'），提示不写 (P) */}
          {canPip && (
            <button className={`cb-btn ${inPip ? 'on' : ''}`} onClick={togglePip} title={t(inPip ? 'cbPipBack' : deskFs ? 'cbPip' : 'cbPipKey')}>
              <PipIcon exit={inPip} />
            </button>
          )}
          {/* 置顶（无边框窗口）：桌面版、全屏钮左边、全屏时不出 */}
          {/* deskFs：桌面版全屏钮，提示用桌面版那句 */}
          {canFs && !inPip && (
            <button className="cb-btn" onClick={toggleFullscreen} title={t(deskFs ? (isFs ? 'dkFullscreenExit' : 'dkFullscreen') : (isFs ? 'cbFsExitKey' : 'cbFsKey'))}>
              <FullscreenIcon exit={isFs} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
