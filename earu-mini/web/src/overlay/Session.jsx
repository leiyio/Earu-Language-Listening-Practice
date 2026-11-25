// 一个视频的耳如界面（本机版）：播放器、控制区 / 答题区 / 字幕列表（LiteSkin）、学习逻辑（study/useStudySession.jsx）。
// 字幕和视频从哪来由调用方给一个 useAdapter（钩子，模块级、不会换）：desktop/useLocalAdapter.js 读用户打开的本地文件和文件里的字幕轨。
// 它拿到 { ...adapterArgs, bridge, video, videoRef, learnRef, pickedFor, pickedRef, ownBar, showToast }，回：
//   src     { subs, zhSubs, tracks, cueTimes, subId, setSubId, readMore?, partial? }   字幕输入
//   media   { url, kind, file?, remux? }
//   entry / meta / show / sourceNote / subsError / progress / videoError / videoOk / onVideoError / onVideoOk / keys / toggleFullscreen / spin
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import Player from '../components/Player.jsx';
import Toast, { useToast } from '../components/Toast.jsx';
import { usePlayerPrefs } from '../components/usePlayerPrefs.js';
import { RATES } from '../components/ControlBar.jsx';
import { BackIcon } from '../components/icons.jsx';
import { useUiLang } from '../i18n/useUiLang.js';
import { t } from '../i18n/index.js';
import { uiDir } from '../i18n/lang.js';
import { fullscreenOn, query as hostQuery, typingTarget } from '../core/hostRoot.js';
import { matchShortcut } from '../core/shortcuts.js';
import { useStudySession, MODE_KEY } from '../study/useStudySession.jsx';

// 界面自己出了错（不该有）：不让它悄悄消失，照实说一句，给一个回首页的口
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { try { console.log('[Earu] overlay error:', err && err.message); } catch { /* 控制台不可用 */ } }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ov-login" role="alert">
        <strong>{t('dkBrand')}</strong>
        <p>{t('ovCrash')}</p>
        <button type="button" className="btn" onClick={() => { this.props.bridge.host({ type: 'earuGoLibrary' }).catch(() => {}); }}>{t('ovBackHome')}</button>
      </div>
    );
  }
}

// 顶栏：画面顶上一条渐变，左边「← 片名」，点箭头回首页
function TopBar({ bridge, title }) {
  return (
    <div className="stage-top">
      <button type="button" className="top-back" title={t('ovBackHomeTip')} aria-label={t('ovBackHomeTip')}
        onClick={() => { bridge.host({ type: 'earuGoLibrary' }).catch(() => {}); }}><BackIcon size={20} /></button>
      {title && <span className="top-title" dir="auto">{title}</span>}
    </div>
  );
}

// skin：舞台上那套浮动层（控制区、字幕列表、答题区）的组件，拿到 study 自己排版（lite/LiteSkin.jsx）
export function Session({ bridge, hostEl, rootEl, ownBar, video, container, useAdapter, adapterArgs, skin: Skin }) {
  const uiLang = useUiLang();
  const [toastMsg, showToast] = useToast();
  const [prefs, setPref] = usePlayerPrefs();
  const [isFs, setIsFs] = useState(fullscreenOn);
  useEffect(() => {
    const f = () => setIsFs(fullscreenOn());
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  // 每打开一个视频都先停在字幕列表、不自动进练习
  const [modePref, setModePref] = useState('listen');
  const changeMode = (m) => { setModePref(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* 存不了就这一次有效 */ } };

  const videoRef = useRef(null);
  const learnRef = useRef({ learn: 'en', script: 'Hans' });
  const pickedFor = useRef(null);
  const pickedRef = useRef(false);

  // ---- 字幕和媒体：由 useAdapter 给（本地文件里的字幕轨），当成「原文字幕」交给学习会话 ----
  const ad = useAdapter({ ...adapterArgs, bridge, video, videoRef, learnRef, pickedFor, pickedRef, ownBar, showToast });
  const { src, media } = ad;
  const [duration, setDuration] = useState(() => (Number.isFinite(video.duration) ? video.duration : null));
  useEffect(() => {
    const f = () => setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    f();
    video.addEventListener('durationchange', f);
    video.addEventListener('loadedmetadata', f);
    return () => { video.removeEventListener('durationchange', f); video.removeEventListener('loadedmetadata', f); };
  }, [video]);
  const adMeta = ad.meta;
  const meta = useMemo(() => (adMeta ? { ...adMeta, duration: adMeta.duration ?? duration } : { duration }), [adMeta, duration]);

  // 速度：以耳如控制区为准；视频自己的倍速被改了，把新值同步回速度偏好
  useEffect(() => {
    const f = () => {
      const r = video.playbackRate;
      if (r > 0 && RATES.includes(r) && r !== prefs.speed) setPref('speed', r);
    };
    video.addEventListener('ratechange', f);
    return () => video.removeEventListener('ratechange', f);
  }, [video, prefs.speed, setPref]);

  const study = useStudySession({
    learnRef, subs: src.subs, zhSubs: src.zhSubs, subsPartial: !!src.partial, tracks: src.tracks, pickedFor, setSubId: src.setSubId, entry: ad.entry ?? null, subId: src.subId, media,
    subsError: ad.subsError ?? null, modePref, meta, videoRef, showToast, prefs, setPref,
    videoError: !!ad.videoError, videoOk: ad.videoOk ?? true, progress: ad.progress, sourceNote: ad.sourceNote,
    readMore: src.readMore,
  });
  const { mode, stepSort, player, state, display, practice, lines } = study;

  // <html lang dir> 的宿主版：写在宿主元素上
  useEffect(() => {
    hostEl.setAttribute('lang', uiLang);
    hostEl.setAttribute('dir', uiDir(uiLang));
  }, [hostEl, uiLang]);

  // 快捷键（core/shortcuts.js 里播放器那几条，画中画除外）归耳如：keydown 由 Player 处理并拦下；keyup / keypress 也要拦
  const adKeys = ad.keys || [];
  useEffect(() => {
    const extra = new Set(adKeys.map((k) => k.toLowerCase()));
    const isExtra = (e) => !e.ctrlKey && !e.metaKey && !e.altKey && typeof e.key === 'string' && extra.has(e.key.toLowerCase());
    const mine = (e) => { const id = matchShortcut(e, { scope: 'player' }); return (id && id !== 'pip') || isExtra(e); };
    const f = (e) => {
      if (!mine(e)) return;
      if (typingTarget(e) || hostQuery('[data-blocks-keys]')) return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('keyup', f, true);
    window.addEventListener('keypress', f, true);
    return () => { window.removeEventListener('keyup', f, true); window.removeEventListener('keypress', f, true); };
  }, [adKeys]);
  useEffect(() => { rootEl.classList.toggle('ov-fs', isFs); }, [rootEl, isFs]);
  useEffect(() => { rootEl.classList.toggle('ov-ownbar', !!ownBar); }, [rootEl, ownBar]);
  const toggleFullscreen = ad.toggleFullscreen;
  const external = useMemo(() => ({
    video, container, ownBar: !!ownBar, toggleFullscreen: () => toggleFullscreen(), isFullscreen: () => fullscreenOn(), quality: null, spin: !!ad.spin, frame: false,
  }), [video, container, ownBar, toggleFullscreen, ad.spin]);

  return (
    <>
      <main className="workspace is-float">
        <section className="left">
          <Player
            videoRef={videoRef} url={media.url} player={player} state={state} lines={lines}
            display={display} onStep={mode === 'sort' ? stepSort : undefined}
            prefs={prefs} setPref={setPref} playModeLocked={practice.playModeLocked}
            float={media ? <Skin study={study} changeMode={changeMode} prefs={prefs} setPref={setPref} video={video} /> : null}
            stageClass="" hideBarWhenPaused inFloat
            onVideoError={ad.onVideoError} onVideoOk={ad.onVideoOk}
            top={ownBar ? <TopBar bridge={bridge} title={ad.show} /> : null}
            external={external}
            zh={study.tr.on ? study.tr.texts : null} zhPending={study.tr.on && study.tr.pending} zhInPanel={study.tr.on && mode === 'sort'}
          />
        </section>
      </main>
      {!isFs && <Toast msg={toastMsg} placement="top" />}
    </>
  );
}
