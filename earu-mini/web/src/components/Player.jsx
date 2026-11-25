import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t, learnAttrs, learnNow, nativeAttrs, nativeNeedsAttrs } from '../i18n/index.js';
import { internalSeek } from '../core/player/sentencePlayer.js';
import { isFinished, onHeldChange, replay } from '../core/player/finished.js';
import ControlBar from './ControlBar.jsx';
import { ReplayIcon } from './icons.jsx';
import { overlayView, maskInfo, pipView } from './sort/display.js';
import MaskText from './sort/MaskText.jsx';
import TrPending from './TrPending.jsx';
import { usePlayerPrefs, subScaleOf, rememberPlayMode } from './usePlayerPrefs.js';
import { ccModeOf, setCcOn, srcWhich } from './ccMode.js';
import LearnText from './LearnText.jsx';
import { useSubSize } from './subSize.js';
import { stageClickSuppressed } from './float/stageClick.js';
import { takeVideo } from '../core/player/spareVideo.js';
import { query as hostQuery, typingTarget } from '../core/hostRoot.js';
import { matchShortcut, onShortcut } from '../core/shortcuts.js';
import { exitLayerFullscreen, toggleLayerFullscreen } from '../core/fullscreen.js';

const NEAR_BAR_PX = 60;   // 鼠标离进度条这么近（往上量），进度条那一条就压过字幕（见 nearBar）

// 画面英文字幕是纯文字：以前每个词能查（WordText，悬停 / 点 / 长按开词卡），
// 带逐词时间的片子正在念的词还变黄跳一下，两样都去掉了。
// 逐词时间照旧解析（core/subtitle/decode.js、lines.js，合句 sentences.js 断句要用），只是 WordText 不再认 kara / now，画面上没有逐词高亮了

// 鼠标停 3 秒不动就把控制条和鼠标指针藏起来（侧栏布局暂停时一直显示；浮动模式暂停时也藏，见 hideBarWhenPaused）。
// keep()：到点时还要不要再等一轮（鼠标停在控制条上不藏）
function useIdle(ms = 3000, keep = null) {
  const [idle, setIdle] = useState(false);
  const timer = useRef(0);
  const keepRef = useRef(keep);
  keepRef.current = keep;
  const poke = () => {
    setIdle(false);
    clearTimeout(timer.current);
    const fire = () => { if (keepRef.current?.()) timer.current = setTimeout(fire, ms); else setIdle(true); };
    timer.current = setTimeout(fire, ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return [idle, poke, () => { clearTimeout(timer.current); setIdle(true); }];
}

// 画中画用 Document Picture-in-Picture（Chrome/Edge 116+）：把整个播放区（画面 + 字幕 + 控制条）
// 渲染进小窗；不支持时退回浏览器自带的画中画（只有画面，没有字幕）。
const hasDocPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
// iPhone 的系统画中画（移动端）：先走标准接口（requestPictureInPicture）；没有标准接口的退回 WebKit 自己的那套
// （webkitSetPresentationMode，老 iPhone / 个别环境）。进出两边都听，进没进以 webkitPresentationMode 为准
const WEBKIT_PIP = 'picture-in-picture';
const webkitPipOk = (v) => typeof v?.webkitSupportsPresentationMode === 'function' && !!v.webkitSupportsPresentationMode(WEBKIT_PIP)
  && typeof v.webkitSetPresentationMode === 'function';
// 出不出按钮：WebKit（iPhone / Mac Safari）只信 webkitSupportsPresentationMode。iPhone 从桌面图标打开的网页 App 里
// document.pictureInPictureEnabled 照样是 true，可点了进不去（WebKit bug 303885，iOS 14.5～26 都这样；
// 点了没反应），这个接口在那里回 false（系统自带控件的画中画钮也看它）。片子还没加载时它也回 false，加载了再画一次就出来
const nativePipOk = (v) => (typeof v?.webkitSupportsPresentationMode === 'function'
  ? !!v.webkitSupportsPresentationMode(WEBKIT_PIP)
  : !!document.pictureInPictureEnabled);
// 能不能让舞台（div）全屏：iPhone 的网页没有这个函数（只有 video 自己能进系统全屏），窄屏布局就不出全屏按钮
const CAN_FS = typeof Element !== 'undefined' && typeof Element.prototype.requestFullscreen === 'function';

// 画面字幕带注音时放不下就一级级退：带注音的长句（行距拉开、词块被注音撑宽）在竖屏控制条出来、
// 字幕底边抬到 86px 时，整块字幕的上沿会顶出舞台，第一行连注音看不见。量着退：0 照常；1 藏这一句的译文；2 再不出注音（只剩原文，和没注音时一样高）。
// key 变了（换一句、开关原文 / 译文、手机控制条出 / 收：字幕底边跟着上下）从 0 重新量；同一个 key、同一个画面大小里只退不进，不来回跳；
// 画面大小变了（转屏、进出画中画、拖窗口）、字体下载完（字宽变了）从 0 重新量。
// 什么时候量：画完还没上屏（useLayoutEffect；在这里接着退的几轮也都在上屏之前，不闪）、字幕尺寸变了（ResizeObserver：译文晚到）、
// 字幕挪位置的过渡走完（手机控制条出 / 收时 bottom 有 .2s 过渡，过渡中量到的是半路的位置，不作数，等 transitionend）。
// 上沿取字幕框和第一行注音里高的那个：手机上行距收紧了，第一行的注音会探出字幕框一点。
// 只在这句真画出了注音（.has-py，拼音、音标都是它）时退：注音关着时 key 是空串，什么都不做（学英语、注音关着时画面字幕一个字节不变）
function useSubFit(key, stageRef) {
  const subRef = useRef(null);
  const [fit, setFit] = useState({ key: '', lvl: 0 });
  const lvl = key && fit.key === key ? fit.lvl : 0;
  useLayoutEffect(() => {
    const sub = subRef.current;
    const stage = stageRef.current;
    if (!key || !sub || !stage) return undefined;
    const over = () => {
      const rt = sub.querySelector('rt');
      const top = Math.min(sub.getBoundingClientRect().top, rt ? rt.getBoundingClientRect().top : Infinity);
      return top < stage.getBoundingClientRect().top - 0.5;
    };
    const check = () => {
      if (lvl >= 2 || !sub.isConnected || !sub.querySelector('.has-py')) return;
      if (sub.getAnimations?.().some((a) => a.playState === 'running')) return;
      if (over()) setFit((f) => (f.key === key && f.lvl > lvl ? f : { key, lvl: lvl + 1 }));
    };
    const refit = () => { if (lvl > 0) setFit({ key, lvl: 0 }); else check(); };
    check();
    let size = `${stage.clientWidth}x${stage.clientHeight}`;
    const RO = sub.ownerDocument.defaultView?.ResizeObserver;   // 画中画小窗里的元素用小窗自己的
    const ro = RO ? new RO(() => {
      const now = `${stage.clientWidth}x${stage.clientHeight}`;
      if (now === size) check();
      else { size = now; refit(); }
    }) : null;
    ro?.observe(sub);
    ro?.observe(stage);
    sub.addEventListener('transitionend', check);
    const fonts = sub.ownerDocument.fonts;
    fonts?.addEventListener?.('loadingdone', refit);
    return () => {
      ro?.disconnect();
      sub.removeEventListener('transitionend', check);
      fonts?.removeEventListener?.('loadingdone', refit);
    };
  }, [key, lvl, stageRef]);
  return [subRef, lvl];
}

function copyStyles(win) {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    win.document.head.appendChild(node.cloneNode(true));
  }
}

// zh：按句子编号的译文；notes：每句的注释（画面顶部单独一行）；
// zhPending：译文还在路上（画面上显示「正在获取中文翻译…」，不拿英文顶替）；
// zhGaveUp：翻完了、有几句没翻成（useTranslation.js zhGaveUp），没译文的那句母语位置画淡色「—」；
// originalOnly：手动选到了非英文轨（只显示、不翻译）
// display：画面字幕按模式（规则在 sort/display.js overlayView）：
//   {mode: 'listen' | 'sort', solvedIndex, puzzleIndex, sortEn, sortZh, setSortEn, setSortZh, peek, firstZh, fold, masks, maskOn, maskEn}。不传 = 精听（和以前一样）。
//   puzzleIndex = 答题区里这道题是第几句：非循环暂停在两句之间、题还留着时画面给这一句（和答题区中文同一个判断）
//   peek / firstZh：手上这道题偷看着哪一层、新用户第一题的译文先亮着（overlayView）；fold：这一题的译文正「先亮后收」（MaskText）；
//   masks：{en, zh: display.js maskInfo 给的能不能点开, onPeek(kind), toast}——排序时手上这道题的打码点开就是提示（偷看就是提示）
//   maskOn：学习设置「练习时遮住字幕和翻译」：false = 手上这道题的译文不打码，没给 = 开
//   maskEn：原文层的打码开关，没给 = 跟 maskOn；练习时是 true（原文层强制打码），译文层仍只看 maskOn
//   排序模式下 CC 菜单的两个开关就是「排序时底部原文」「翻译」（学习设置里那两项），精听模式是本机的两个开关
// float：浮动模式的浮层（控制区、答题区、字幕抽屉，App 建好的元素，浮动模式-实现说明 §3.1）：渲染在 .stage 里、控制条前面，
//   画中画时不渲染（小窗不是练习用的）。元素由 App 建，Player 自己重画（闲置、暂停、全屏）时引用不变，React 直接跳过它。
// zhInPanel：排序模式的中文在答题区里：画面底部只出英文整句，挂在答题区下面 6px（under-prac）；画中画里不生效。
// stageClass：拼到 .stage 上的类（浮动精听拉开字幕抽屉时 list-open，画面字幕往右让）。
// extraKeys：{list: fn} 这类额外快捷键（键名是快捷键表里的 id），并进同一套守卫；画中画小窗里不生效。
// hideBarWhenPaused：浮动模式下暂停时控制条也 3 秒自动藏（浮动模式-实现说明 §6 第 1 条：排序时英文整句正好落在控制条上）。
// inFloat / onList / listOpen：浮动模式下控制条拿掉速度、循环、字幕（挪进控制区），给字幕列表时（practiceMode.js listOk）加一颗「字幕列表」。画中画时不生效（控制区不在）。
// prefs / setPref：本机播放偏好（App 的 usePlayerPrefs）；不传就自己管一份（测试、旧调用）
// onStep(dir)：←/→ 和控制条上一句 / 下一句（排序模式跳过剥完没词的句子）；不传 = player.prev()/next()
// onPipChange(inPip)：进出画中画时告诉外面——画中画不是练习用的，小窗开着时提示的 10 秒冷却不起算
// remux：url 是换盒子边转边播的地址时，那个会话（core/player/remuxSource.js chooseSource 回的），给了地址以后把 video 交给它
// phon：注音（App 按学习设置的「注音」和
//   core/annotate/index.js 那张表备好）：null = 不出注音（关着、这种语言没有注音）；{ at(i) → 第 i 句的料 | null }（学中文是这句的标注 {w, p}，
//   学英语是整片的「词 → 音标」表）。画面底部的原文按词出读音（LearnText）。开关只在学习设置里，画面字幕菜单里不再有「拼音」。
//   学中文时精听模式的原文开关是另一个本机键 subSrcZh（默认关 = 打码），英文的 subEn 不动
// mobile：窄屏布局（core/mobile.js）。舞台只有画面、画面字幕和控制条，答题区 / 字幕列表在舞台下面（App 的 MobileDeck）：
//   点画面 = 出 / 收控制条（不切播放，播放暂停用按钮）；放着时出来 3 秒自己收，暂停着不收；双击什么都不做（不全屏、不放大）；
//   画面字幕是纯文字、点词不查词；zhInPanel 时中文只在答题区、画面底部照常只出英文（不挂在答题区下面）
// playModeLocked：练习（排序 / 听写）里只许单句循环，Q（每句停）不响应（practiceMode.js playModeLocked）
// subsRead：远程片边读边出时读字幕的细节（ref，desktop/useLocalAdapter.js 的 subsDiag），交给控制条在进度条下沿画出字幕读到的段；读全了、本机文件不给
export default function Player({ videoRef, url, player, state, lines, onVideoError, onVideoOk,
  display, float = null, stageClass = '', extraKeys = null, hideBarWhenPaused = false,
  inFloat = false, onList, listOpen = false, prefs: prefsIn, setPref: setPrefIn, onStep, onPipChange, remux = null, mobile = false,
  external = null, top = null, subsRead = null, playModeLocked = false, zh = null, zhPending = false, zhGaveUp = false, zhInPanel = false }) {
  // video 元素只建一次，在页面和画中画小窗之间搬来搬去，播放不中断；
  // 如果交给 React 渲染，换容器时会重建 video，从头加载。
  // 先拿点按时备好的那个（core/player/spareVideo.js）：iPhone 上选完文件才能自动出声播
  // external：外部宿主提供的播放器——视频是外部页面自己的 <video>，不建、不搬、不给地址、不管画中画；全屏、倍速菜单也归外部。
  //   { video, toggleFullscreen(), isFullscreen(), container（外部播放器容器，进度条的闲置隐藏听它上面的鼠标）, ownBar（画不画进度条） }
  const ext = !!external;
  const frameOnly = ext && !!external.frame;   // 内嵌框架：没有全屏、画中画（Session.jsx frame）
  const video = useMemo(() => (external ? external.video : takeVideo()), [external?.video]); // eslint-disable-line react-hooks/exhaustive-deps
  videoRef.current = video;
  const remuxRef = useRef(remux);
  remuxRef.current = remux;
  // 跨窗口搬 video 时浏览器可能把它重新加载一遍（实测搬进 iframe 会从 0 秒开始），
  // 所以搬之前记下进度和播放状态，真的重载了就恢复。
  // 从画中画小窗搬回页面时，等这里拿到新位置，小窗已经关了、video 的进度读出来是 0（回来以后停在 00:00、片头是黑场，
  // 看着像画面没了；实测回来是 0 秒、暂停）——所以关小窗前先记下来（pipSnap，leavePip / 小窗的 pagehide），这里优先用它
  const pipSnap = useRef(null);
  const slotRef = useCallback((el) => {
    if (!el || ext) return;
    const crossDoc = video.ownerDocument !== el.ownerDocument && video.currentSrc;
    const snap = crossDoc && (pipSnap.current || { t: video.currentTime, playing: !video.paused, rate: video.playbackRate });
    pipSnap.current = null;
    el.appendChild(video);
    if (!snap) return;
    const restore = () => {
      // 走播放器内部的跳转：直接写 currentTime 会被 SentencePlayer 当成「用户拖了进度条」——拖完一律开播、
      // 拖出本句还退出循环，暂停着搬进小窗的会自己播起来。播不播只看搬之前在不在播
      if (Math.abs(video.currentTime - snap.t) > 0.5) internalSeek(video, snap.t);
      // 搬家时正好在循环句尾的留白里，速度是 0（留白靠速度 0 冻住画面）：不照搬，否则重载那一下又关了循环，片子会一直停住
      if (snap.rate > 0) video.playbackRate = snap.rate;
      if (snap.playing) video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', restore, { once: true });
    setTimeout(() => video.removeEventListener('loadedmetadata', restore), 5000);
    // 边转边播的片：它的 MediaSource 接不到别的页面里，要在新页面里另建一个（core/player/remuxSource.js moved）
    remuxRef.current?.moved();
  }, [video, ext]);

  const stageRef = useRef(null);
  const [ownPrefs, ownSetPref] = usePlayerPrefs();
  const prefs = prefsIn || ownPrefs;
  const setPref = setPrefIn || ownSetPref;
  const rate = prefs.speed;
  const setRate = (r) => setPref('speed', r);
  // 学中文（App 每次画之前 setLearn，B10 接线；之前一律英语，下面几行学英语时就是原来的 subEn）：
  // 精听模式的原文开关换成 subSrcZh（默认打码）；排序模式的原文照旧是学习设置里那一项（display.sortEn）。注音开不开看 phon（学习设置）
  // 精听的原生字幕、翻译字幕是控制区的三态（显示 / 隐藏 / 起雾，ccMode.js）；底下控制条的字幕菜单只有开 / 关，读写老布尔（隐藏在那里当起雾）
  const learnZh = learnNow() === 'zh';
  const srcW = srcWhich(learnZh);
  const srcMode = ccModeOf(prefs, srcW);
  const trMode = ccModeOf(prefs, 'tr');
  const srcOn = srcMode === 'show';
  const setSrc = (v) => setCcOn(setPref, srcW, v);
  const [paused, setPaused] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [pipWin, setPipWin] = useState(null);
  const [nativePip, setNativePip] = useState(false);
  // 鼠标停在控制条上不藏：到点时按鼠标最后的坐标现查底下是不是控制条。不能记 mousemove 那一下的 target——
  // 条藏着时 pointer-events:none，那一下落在视频上；鼠标本来就在条那块、轻轻一动条出来了，人不再动，记下的还是「不在条上」，
  // 3 秒后条又藏了。到点时条是显示着的，elementFromPoint 摸得到它（弹出菜单是它的孩子，也算）
  const lastPt = useRef(null);
  // 鼠标进到进度条上方 60px 以内（含答题区底下那截）：在舞台上标 data-near-bar，进度条那一条压过排序时挂在答题区下面的那行英文
  // （styles.css）。光靠 .cbar:hover 太晚：答题区底边盖着那一条的上沿，鼠标得贴到进度条上方十几像素才算，往下挪的路上字幕一直挡着进度条
// 直接改 DOM 属性、不走 state，鼠标一动就重画整个 Player 不值
  // 鼠标正停在画面上打码的那句上（挂在答题区下面那一行打码的原文）：这一下是要点它，进度条不压上来
  const nearBar = (x, y) => {
    const stage = stageRef.current;
    const bar = stage?.querySelector('.cb-progress');
    if (!stage) return;
    // 观影时遮盖的那行（.sub-mosaic，不能点、只靠鼠标划过吹开）也算：排序位置的字幕落在控制条带里，控制条一被悬停就盖住它，雾吹开了也看不见
    // （Mac 测试 F2，三种窗口尺寸都这样）。.mask-text 也带 .sub-mosaic
    const onMask = y != null && [...stage.querySelectorAll('.overlay-sub .sub-mosaic')].some((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    const near = y != null && !onMask && !!bar && y >= bar.getBoundingClientRect().top - NEAR_BAR_PX;
    if (near) stage.dataset.nearBar = '1';
    else delete stage.dataset.nearBar;
    // 光不标 near-bar 不够：打码的那句整句落在控制条里、进度条从它中间穿过，鼠标从答题区往下挪一定先碰到控制条，.cbar:hover 一抬，
    // 点下去就成了拖进度条（会从 32 秒跳到 59 秒、题换掉、没算提示）。标 data-on-mask，styles.css 让控制条退到打码那句下面
    if (onMask) stage.dataset.onMask = '1';
    else delete stage.dataset.onMask;
  };
  const overBarNow = () => {
    const p = lastPt.current;
    // 舞台所在的根（外部宿主可能在 shadow root 里，document.elementFromPoint 只回宿主元素，摸不到里面的控制条）
    const root = stageRef.current?.getRootNode?.();
    return !!(p && root?.elementFromPoint?.(p.x, p.y)?.closest?.('.cbar, .stage-top'));
  };
  const [idle, poke, leave] = useIdle(3000, overBarNow);
  useEffect(() => { lastPt.current = null; }, [pipWin]); // 进出小窗换了窗口，旧坐标不作数
  // 外部宿主：舞台不接鼠标（点画面、双击全屏都归外部页面），进度条的闲置隐藏听外部播放器容器上的鼠标移动
  useEffect(() => {
    const c = external?.container;
    if (!c) return undefined;
    const f = () => poke();
    c.addEventListener('mousemove', f);
    return () => c.removeEventListener('mousemove', f);
  }, [external?.container]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = display?.mode === 'sort' ? 'sort' : 'listen';
  const inPip = !!pipWin || nativePip;
  // 画中画：小窗不打码、CC 一颗开关管两行（display.js pipView）；和控制区那两颗互不影响，每次进小窗都先开着
  const pipOne = inPip && !!display?.desk;
  const [pipCc, setPipCc] = useState(true);
  useEffect(() => { if (!inPip) setPipCc(true); }, [inPip]);
  const view0 = overlayView({
    mode, state, solvedIndex: display?.solvedIndex ?? -1, puzzleIndex: display?.puzzleIndex ?? -1,
    listen: { en: srcMode, zh: trMode }, sort: { en: !!display?.sortEn, zh: !!display?.sortZh },
    originalOnly: false, peek: display?.peek || null, firstZh: !!display?.firstZh, maskOn: display?.maskOn !== false, maskEn: display?.maskEn, forceMask: !!display?.forceMask, remask: !!display?.remask, zhMode: display?.zhMode,
  });
  const view = pipOne ? pipView(view0, pipCc, false) : view0;
  // 手上这道题打码的那层（MaskText：真字 + 雾，和别的句子同一个样子）：按 masks 给的状态（能不能点开、为什么不能）；
  // attrs：和这一层不打码时一样（lang / dir），字跟着同一种字体排
  const mask = (kind, text, attrs) => {
    const m = display?.masks;
    const mine = view.index >= 0 && view.index === display?.puzzleIndex;
    const info = (mine && m?.[kind]) || maskInfo(kind, null);
    return (
      <MaskText className={kind} attrs={attrs} text={text} info={info} onPeek={() => m?.onPeek?.(kind)} toast={m?.toast}
        fold={kind === 'zh' && mine && !!display?.fold} />
    );
  };
  const shownLine = view.index >= 0 ? lines[view.index] : null;
  // 这句注音的料：注音关着时不取，LearnText 只画文字
  const looping = state.loopMode; // 循环模式开着就亮（两句之间等着咬住下一句时也亮）
  const cb = useRef({});
  cb.current = { onVideoError, onVideoOk };

  // 速度换片不重置（速度记在设置里）
  // remux：这部片浏览器放不了、换成 MP4 盒子边转边播（core/player/remuxSource.js，iPhone 上的 MKV）。iPhone 的 ManagedMediaSource
  // 要求先关掉隔空播放（不然接不上），所以在给地址之前设；地址给了再交出 video，它要看播放头、听跳转。直接放文件的照旧
  // 起始页的示例片：拿到的 video 已经给上这个地址、缓冲到能播了（core/sample.js prepareSample，经 spareVideo.js 交过来）——
  // 地址一样就不再赋一遍（再赋浏览器会从头重新加载、重下开头那一段）
  useEffect(() => {
    if (ext) { setPaused(video.paused); return undefined; }
    video.disableRemotePlayback = !!remux;
    if (video.getAttribute('src') !== (url || '')) video.src = url || '';
    setPaused(true);
    remux?.attach(video);
  }, [video, url, remux, ext]);
  // 关片（Player 卸载）：边转边播的片把 video 上的地址摘掉，它的 MediaSource 和攒着的缓冲才放得掉（core/player/remuxSource.js release）；
  // 网上的片子（示例片，浏览器边下边播）也摘掉地址：不然关了以后浏览器还在后台接着下。
  // 等这一轮收尾都跑完再摘：App 的 useProgressSaver 收尾时最后存一次进度，要读播放头和片长，和这里在同一轮里、排在后面
  useEffect(() => () => {
    if (ext) return;
    const r = remuxRef.current;
    setTimeout(() => {
      if (r) r.release();
      else if (/^https?:/i.test(video.getAttribute('src') || '')) { video.removeAttribute('src'); video.load(); }
    }, 0);
  }, [video, ext]);
  useEffect(() => { player?.setRate(rate); }, [player, rate]);

  useEffect(() => {
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onError = () => cb.current.onVideoError?.();
    // 「画面编码 H.265 要看显卡」的提示（TrackPanel）等「真解出画面」才收：loadeddata 那一下错过了（提示会一直不消失），
    // 放起来以后真有解出来的帧也算。每次换地址（loadstart）重新算，同一个地址只报一次
    let okSent = false;
    const ok = () => { if (!okSent) { okSent = true; cb.current.onVideoOk?.(); } };
    const onStart = () => { okSent = false; };
    const onLoaded = () => { if (video.videoWidth > 0) ok(); };
    const onTick = () => { if (video.videoWidth > 0 && (video.getVideoPlaybackQuality?.().totalVideoFrames ?? 1) > 0) ok(); };
    const onEnterPip = () => setNativePip(true);
    const onLeavePip = () => setNativePip(false);
    const onPresent = () => setNativePip(video.webkitPresentationMode === WEBKIT_PIP);
    const evs = [['play', onPlay], ['pause', onPause], ['error', onError], ['loadstart', onStart], ['loadeddata', onLoaded], ['timeupdate', onTick],
      ['enterpictureinpicture', onEnterPip], ['leavepictureinpicture', onLeavePip], ['webkitpresentationmodechanged', onPresent]];
    evs.forEach(([e, f]) => video.addEventListener(e, f));
    return () => evs.forEach(([e, f]) => video.removeEventListener(e, f));
  }, [video]);

  // 等数据时画面正中转圈：边下边播时，拖到还没下的地方、网慢、断了一会儿，浏览器在等数据，
  // 画面停在上一帧、时钟已经跳过去、按钮还是「暂停」（看着像卡死了，断网久了也没个预兆）。
  // 只在「要往下放（在播 / 正在跳转）又没有能往下放的数据（readyState 不到 HAVE_FUTURE_DATA）」时转；连着 400 毫秒都这样才露出来——
  // 本机文件跳一下、循环回句首都是一眨眼的事，不让它闪。出了错不转（放不了的提示 / 示例片回起始页另有处理）。
  // 除了听事件还每 0.2 秒看一眼：Chrome 跳转时先报 seeking、readyState 过一会儿才掉下去，掉下去那一下不一定再报 waiting，光听事件会漏
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    if (ext && !external.spin) return undefined;   // 外部播放器自己转圈；本地视频（external.spin）没有外部播放器，照样转
    let since = 0;   // 从什么时候起一直在等（0 = 没在等）
    const check = () => {
      const want = !!video.getAttribute('src') && !video.error && video.readyState < 3 && (video.seeking || !video.paused);
      if (!want) { since = 0; setBuffering(false); return; }
      if (!since) since = performance.now();
      if (performance.now() - since >= 400) setBuffering(true);
    };
    const evs = ['waiting', 'seeking', 'seeked', 'playing', 'play', 'pause', 'canplay', 'loadstart', 'emptied', 'error', 'stalled'];
    evs.forEach((e) => video.addEventListener(e, check));
    const id = setInterval(check, 200);
    check();
    return () => { clearInterval(id); evs.forEach((e) => video.removeEventListener(e, check)); setBuffering(false); };
  }, [video, ext, external?.spin]); // eslint-disable-line react-hooks/exhaustive-deps

  // 放完了：画面盖黑、正中一个重播钮（所有视频都盖）。放没放完只问 core/player/finished.js，每次渲染现问；
  // 这里只听会改变它的事件、让播放界面重画。单句循环开关一变 Player 本来就重画，循环关掉的那一下就盖上
  const [, finBump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const evs = ['ended', 'play', 'seeked', 'pause', 'emptied', 'loadstart'];
    evs.forEach((e) => video.addEventListener(e, finBump));
    const off = onHeldChange((v) => { if (v === video) finBump(); });
    return () => { off(); evs.forEach((e) => video.removeEventListener(e, finBump)); };
  }, [video]);
  const finished = isFinished(video);

  // 全屏的是外层 stage（字幕浮层和控制条才跟得进去），不是 video 本身
  useEffect(() => {
    const onChange = () => setIsFs(external ? external.isFullscreen() : !!document.fullscreenElement && document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    onChange();   // 挂上时就在全屏里（整页全屏时打开视频）：钮一开始就是「退出全屏」，不等下一次 fullscreenchange
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // iPhone 的网页没有 requestFullscreen（只有 video 自己能进系统全屏）：没有就什么都不做，不报错（窄屏布局也不出全屏按钮）
  const toggleFullscreen = () => {
    if (frameOnly) return;   // 内嵌框架：不全屏（Session.jsx frame）
    if (external) { external.toggleFullscreen(); return; }
    if (pipWin) return;
    // 没有外部宿主：只让自己的舞台全屏（core/fullscreen.js）；有 external 时全屏是整页那一种，走上面那行
    toggleLayerFullscreen(stageRef.current);
  };

  // 回到页面里播放（小窗控制条上的按钮、页面上占位的那颗）：先记下进度（见 slotRef），再把主窗口叫到前面，最后关小窗。
  // 叫到前面是因为：主窗口最小化以后在小窗里点它，画面回到了缩在任务栏里的主窗口，看着像没反应；
  // Chrome 自带的「回到标签页」（小窗右上角）没这个问题。Chrome 123 起，小窗里点按钮（小窗有用户激活）时 opener 的 focus()
  // 能把主窗口真正叫到前面（最小化的也恢复）；更老的浏览器不认，只是没效果
  const leavePip = () => {
    if (!pipWin) return;
    pipSnap.current = { t: video.currentTime, playing: !video.paused, rate: video.playbackRate };
    try { window.focus(); } catch { /* 不要紧 */ }
    pipWin.close();
  };

  const togglePip = async () => {
    // 外部宿主里的视频：直接用浏览器自带的画中画
    if (external) {
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      else { video.disablePictureInPicture = false; video.requestPictureInPicture().catch(() => {}); }
      return;
    }
    if (pipWin) { leavePip(); return; }
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
    if (video.webkitPresentationMode === WEBKIT_PIP) { video.webkitSetPresentationMode('inline'); return; }
    await exitLayerFullscreen(stageRef.current);   // 只退自己那层播放器全屏，整页全屏不碰
    if (hasDocPip) {
      const w = 640;
      const h = Math.round(w * ((video.videoHeight || 9) / (video.videoWidth || 16)));
      try {
        adoptPipWindow(await window.documentPictureInPicture.requestWindow({ width: w, height: h }));
        return;
      } catch { /* 开不了小窗就退回自带画中画 */ }
    }
    if (document.pictureInPictureEnabled) video.requestPictureInPicture().catch(() => {});
    else if (webkitPipOk(video)) video.webkitSetPresentationMode(WEBKIT_PIP);
  };

  const adoptPipWindow = (win) => {
    copyStyles(win);
    win.document.title = t('dkBrand');   // 程序名
    win.document.body.className = 'pip-body';
    // 译文的语言（App 设在主窗口 html 上）：小窗里的字幕按它挑字体、阿拉伯语从右往左；换了母语下面的 effect 再抄。
    // 界面方向（阿拉伯语界面从右往左）一起抄：控制条本身照旧从左往右（ControlBar 自己标 dir="ltr"）
    win.document.documentElement.dataset.tr = document.documentElement.dataset.tr || '';
    win.document.documentElement.dir = document.documentElement.dir || 'ltr';
    // 小窗被关（Chrome 自带的「回到标签页」、×，或者 leavePip）：还没记进度的这时记（这一刻 video 还在小窗里，进度读得到）
    win.addEventListener('pagehide', () => {
      if (!pipSnap.current) pipSnap.current = { t: video.currentTime, playing: !video.paused, rate: video.playbackRate };
      setPipWin(null);
    });
    setPipWin(win);
  };
  // 开发时测试用：把任意同源窗口（比如 iframe）当成画中画小窗
  if (import.meta.env.DEV) window.__setPipWin = (win) => (win ? adoptPipWindow(win) : setPipWin(null));

  // 页面关掉 / 组件卸载时把小窗也关了
  useEffect(() => () => pipWin?.close(), [pipWin]);
  // 小窗开着时用户在设置里换了母语：译文换语言（App 重拉），小窗的 data-tr 跟着抄（每次画都对一下，便宜）；换了界面语言，方向也跟着抄
  useEffect(() => {
    if (!pipWin) return;
    pipWin.document.documentElement.dataset.tr = document.documentElement.dataset.tr || '';
    pipWin.document.documentElement.dir = document.documentElement.dir || 'ltr';
  });

  // 快捷键：页面和画中画小窗里都生效；能打字的地方（输入框、文本框、可编辑区域）不拦。
  // 下拉框这里要接管：字幕轨下拉框就在播放器下面，
  // 选过字幕轨以后焦点还停在下拉框上，Windows 的 Chrome/Edge 对收起的下拉框按 ←/→ 会直接换选项并触发 change——
  // 用户以为在换句，其实在一条条换字幕轨，每换到一条英文轨就整份发去翻译；
  // 按空格是把下拉框展开，视频不暂停。这里 preventDefault 了，下拉框就不动。
  // ↑/↓、Alt+↓ 不是快捷键，照旧留给下拉框：只用键盘的人靠它换轨（选完 TrackPanel 会让下拉框失焦）
  // 设置面板这类浮层开着时（它们带 data-blocks-keys）整个让路：浮层自己处理 Esc、输入（00 §4.4 Player 一行）
  useEffect(() => {
    if (!player) return;
    // 键怎么配看快捷键表（core/shortcuts.js），这里只管每个动作做什么；做了返回 true
    const act = (id, repeat) => {
      switch (id) {
        case 'playPause': video.paused ? video.play() : video.pause(); return true;
        // Shift + ←/→：前后 10 秒；没字幕的片 ←/→ 本身也是 ±10 秒（在 SentencePlayer 里）
        case 'seekBack': player.seekBy(-10); return true;
        case 'seekFwd': player.seekBy(10); return true;
        // 排序模式：跳过剥完没词的句子、首尾不环绕（App 的 onStep）；R 照旧开关循环模式
        case 'prev': onStep ? onStep(-1) : player.prev(); return true;
        case 'next': onStep ? onStep(1) : player.next(); return true;
        // Q 开关「每句停」、R 开关「单句循环」（三种播放方式互斥由播放器管）；动手之后把连续 / 每句停记到本机偏好。
        // 练习里 Q 不响应，但键照样归耳如（外部宿主对 Q 的 keyup / keypress 也是一律拦下），不漏给外部页面
        // 按住不放的自动重复不算（不然一按住就来回切）
        case 'loop': if (!repeat) { player.toggleLoop(); rememberPlayMode(player, setPref, playModeLocked); } return true;
        case 'stopMode': if (!playModeLocked && !repeat) { player.toggleStopMode(); rememberPlayMode(player, setPref, playModeLocked); } return true;
        case 'replay': player.replay(); return true;
        case 'fullscreen': toggleFullscreen(); return true;
        case 'pip': if (external) return false; togglePip(); return true;
        // 画中画时（含浏览器自带画中画：按键落在页面上）不生效：L 开的抽屉这时不渲染
        default: if (extraKeys?.[id] && !inPip) { extraKeys[id](); return true; } return false;
      }
    };
    const onKey = (e) => {
      const id = matchShortcut(e, { scope: 'player' });
      if (!id) return;
      if (typingTarget(e)) return;
      if (hostQuery('[data-blocks-keys]')) return;
      if (act(id, e.repeat)) { e.preventDefault(); e.stopPropagation(); poke(); }
    };
    // 外部转过来的键（表里带修饰键的那些；现在还没有，留着备用）
    const offShell = onShortcut((id) => { if (!hostQuery('[data-blocks-keys]') && act(id, false)) poke(); });
    const wins = [window, pipWin].filter(Boolean);
    wins.forEach((w) => w.addEventListener('keydown', onKey, true));
    return () => { offShell(); wins.forEach((w) => w.removeEventListener('keydown', onKey, true)); };
  });

  // 窄屏布局：点画面出 / 收控制条（mobile 时 hideUi 只看它）。barPoke 一变就重新计 3 秒（按着进度条拖、点条上的按钮）
  const [barOn, setBarOn] = useState(false);
  const [barPoke, setBarPoke] = useState(0);
  useEffect(() => {
    if (!mobile || !barOn || paused) return undefined;
    const id = setTimeout(() => setBarOn(false), 3000);
    return () => clearTimeout(id);
  }, [mobile, barOn, paused, barPoke]);
  const onStagePointer = mobile ? (e) => { if (barOn && e.target.closest?.('.cbar')) setBarPoke((n) => n + 1); } : undefined;

  // 单击画面 播放/暂停，双击 全屏；单击等一下，确认不是双击的前半下
  const clickTimer = useRef(0);
  const onStageClick = () => {
    if (stageClickSuppressed()) return; // 刚拖完面板 / 词块、触屏点醒答题区：这一下不是点画面（浮动模式-实现说明 §1.3）
    if (mobile) { setBarOn((v) => !v); return; }
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => (video.paused ? video.play() : video.pause()), 220);
  };
  // 双击也先问：双击句子解析层的 × / 空白，第一下关了层，第二下和 dblclick 落到画面上，不能因此进出全屏
  const onStageDouble = () => {
    if (stageClickSuppressed()) return;
    if (mobile) return;   // 窄屏布局双击什么都不做（不全屏；页面本身也不双击放大，touch-action: manipulation）
    clearTimeout(clickTimer.current);
    toggleFullscreen();
  };

  const hideUi = mobile ? !barOn : idle && (!paused || hideBarWhenPaused);
  // 排序模式中文在答题区里：画面底部只出英文、挂在答题区下面（画中画里答题区不在，中英照常画在画面上）
  const underPrac = zhInPanel && !inPip && !mobile;
  const zhOnStage = !(mobile && zhInPanel && !inPip);
  // 浮动精听照排序时的位置摆（精听的字幕位置和排序时一致：母语在上，目标语言在下）：
  // 母语在上、落在排序时答题区里那行母语的位置；原文在下、落在排序时挂在答题区下面那行原文（under-prac）的位置。手机、画中画照旧
  const asSort = inFloat && !mobile && !inPip && !underPrac;
  const sortCc = mode === 'sort' && !!display?.setSortEn;
  // 画面字幕放不下时退几级（useSubFit；只在注音开着时有 key）。电脑上字幕不随控制条动（「字幕不让路」），key 里不带控制条；字幕大小档位在 key 里（换档字变了，重新量，调小了能把退掉的找回来）
  const fitKey = false ? `${shownLine.i}|${mobile && !hideUi ? 1 : 0}|${view.en || '-'}|${view.zh || '-'}|${subScaleOf(prefs)}` : '';
  const [subRef, fitLvl] = useSubFit(fitKey, stageRef);
  useSubSize(stageRef, pipWin, pipWin ? null : video, subScaleOf(prefs));   // 字幕字号、打码格子按视频画面实际显示的宽算，再乘控制区选的档位（subSize.js）；画中画里没有 video 可量，按舞台
  const pipCb = useRef(onPipChange);
  pipCb.current = onPipChange;
  useEffect(() => { pipCb.current?.(inPip); }, [inPip]);

  const stage = (
    <div className={`stage ${hideUi ? 'idle' : ''} ${pipWin ? 'in-pip' : ''} ${stageClass}${ext ? ' is-ext' : ''}${ext && isFs ? ' is-fs' : ''}`} ref={stageRef}
      onClick={onStageClick} onDoubleClick={onStageDouble}
      onMouseMove={mobile ? undefined : (e) => { lastPt.current = { x: e.clientX, y: e.clientY }; nearBar(e.clientX, e.clientY); poke(); }}
      onMouseLeave={mobile ? undefined : () => { lastPt.current = null; nearBar(null, null); leave(); }}
      onPointerDown={onStagePointer} onPointerMove={onStagePointer && ((e) => { if (e.buttons) onStagePointer(e); })}>
      {!ext && <div className="video-slot" ref={slotRef} />}
      {/* 画面字幕：中文就是 AI 译文，默认开；英文默认关。循环留白里不显示（state.waiting）。
          中文开着、译文还没到：写「正在获取中文翻译…」，绝不拿英文顶替 */}
      {/* 手动选到非英文轨（只显示不翻译）：这条轨没有译文，中文开着就把它的原文放在画面上，
          不然按默认设置（英文关、中文开）画面上一个字都没有 */}
      {/* 排序模式：显示谁由 overlayView 定（排序时原文看「底部原文」、译文看「翻译」；手上还没排对的这一题两层都打码、
          点开就是提示：MaskText） */}
      {/* under-prac 出纯文字、不包可查的词：它压在控制条上面（不挡点击），词能接鼠标就挡住了进度条和按钮，
          点进度条变成点画面。排序时查词查答题区的词块 */}
      {/* 英文原文：阿拉伯语界面（从右往左）里照旧从左往右（learnAttrs：学英语就是 enAttrs()，句末的标点不跑到左边去）。
          学中文时原文标 lang（zh-CN / zh-TW：日文界面里不标会画成日文字形），注音开着就按词出读音（LearnText：学中文拼音、学英语音标）；
          under-prac 那一句只标 lang、不出注音：它在答题区和控制条之间，只有两行原文高（styles.css --prac-bottom），放不下两层 */}
      {shownLine && !finished && underPrac && view.en && (
        <div className="overlay-sub under-prac">
          {view.en === 'text' ? <span className="en" {...learnAttrs()}>{shownLine.text}</span>
            : view.en === 'mosaic' ? <span className="en sub-mosaic" {...learnAttrs()} aria-hidden>{shownLine.text}</span>
            : mask('en', shownLine.text, learnAttrs())}
        </div>
      )}
      {shownLine && !finished && !underPrac && (view.en || (view.zh && zhOnStage)) && (() => {
        const learnEl = <>
          {view.en === 'text' && <LearnText text={shownLine.text} attrs={learnAttrs()} />}
          {/* 字幕打码（mosaic）：原字照样排（注音开着连注音一起），盖上雾，开关时字幕不跳 */}
          {view.en === 'mosaic' && <LearnText text={shownLine.text} className="en sub-mosaic" attrs={{ ...learnAttrs(), 'aria-hidden': true }} />}
          {view.en && view.en !== 'text' && view.en !== 'mosaic' && mask('en', shownLine.text, learnAttrs())}
        </>;
        const nAttrs = nativeNeedsAttrs() ? nativeAttrs() : null;
        const nativeEl = zh && view.zh && zhOnStage && (zh[shownLine.i] != null
          ? (view.zh === 'text' ? <span className="zh" {...nAttrs}>{zh[shownLine.i]}</span>
            : view.zh === 'mosaic' ? <span className="zh sub-mosaic" {...nAttrs} aria-hidden>{zh[shownLine.i]}</span>
            : mask('zh', zh[shownLine.i], nAttrs))
          : zhPending ? <span className="zh pending"><TrPending /></span> : zhGaveUp && <span className="zh pending">—</span>);
        // asSort：原文那一格（.sub-learn）原文关着也占着，母语不因开关原文上下跳
        return asSort
          ? <div className="overlay-sub as-sort" ref={subRef}>{nativeEl}<div className="sub-learn">{learnEl}</div></div>
          : <div className="overlay-sub" ref={subRef}>{learnEl}{nativeEl}</div>;
      })()}
      {/* 顶部注释：双关笑点、梗的出处、英制换算从译文里分出来放这儿，底部中文字幕保持干净。
          单独一个开关，默认开；循环留白里和底部字幕一起藏 */}
      {/* 等数据时的圈（见上面 buffering）：不挡点击，和起始页示例片卡上那个圈同一个样子 */}
      {buffering && <div className="stage-wait" aria-hidden><span className="sample-spin" /></div>}
      {/* 放完：黑底盖住画面（外部播放器停在最后一帧的画面、片尾推荐都挡住），正中重播钮；画面字幕、注释这时不画（见上）。
          点黑底不落到画面上变成「播放 / 全屏」，只有钮重播；窄屏上点黑底照样出 / 收控制条。顶栏、控制区、控制条压在它上面照常能用 */}
      {finished && (
        <div className="end-cover" onClick={(e) => { e.stopPropagation(); if (mobile) setBarOn((v) => !v); }} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" className="end-replay" onClick={(e) => { e.stopPropagation(); replay(video); }} title={t('replayFilm')} aria-label={t('replayFilm')}>
            <ReplayIcon size={36} />
          </button>
        </div>
      )}
      {/* 顶栏（外部宿主且显示自带进度条时给：← 片名）：和控制条一起出、一起藏 */}
      {!inPip && top}
      {!inPip && float}
      {/* 画中画时浮层不在，控制区挪走的速度、循环、字幕回到控制条上，不然整个画中画期间没处开关字幕、改速度；
          「字幕列表」开的抽屉这时也不渲染，点了只会偷偷改掉本机记的开合。小窗里用侧栏那套控制条 */}
      {(!ext || external.ownBar) && <ControlBar
        video={video} player={player} paused={paused} looping={looping} loopLocked={!!state?.loopLocked}
        rate={rate} setRate={setRate}
        subEn={sortCc ? !!display.sortEn : srcOn} subZh={sortCc ? (display.forceMask ? display.zhMode === 'show' : !!display.sortZh) : trMode === 'show'}
        setSubEn={sortCc ? display.setSortEn : setSrc} setSubZh={sortCc ? (display.forceMask ? (v) => display.setPracZh(v ? 'show' : 'fog') : display.setSortZh) : (v) => setCcOn(setPref, 'tr', v)}
        isFs={isFs} toggleFullscreen={toggleFullscreen} deskFs={!!external} hasLines={lines.length > 0}
        inPip={inPip} togglePip={togglePip} canPip={frameOnly ? false : ext ? !!document.pictureInPictureEnabled : (hasDocPip || nativePipOk(video))} onStep={onStep}
        inFloat={inFloat && !inPip} onList={inPip ? undefined : onList} listOpen={listOpen}
        mobile={mobile} canFs={CAN_FS && !frameOnly} quality={external?.quality || null}
        forceMaskEn={sortCc && !!display.forceMask} pipCc={pipOne ? pipCc : null} setPipCc={setPipCc}
        subsRead={subsRead}
      />}
    </div>
  );

  return (
    <div className="player">
      {pipWin ? (
        <>
          <div className="pip-placeholder">
            <div>{t('pipPlaying')}</div>
            <button className="btn" onClick={leavePip}>{t('cbPipBack')}</button>
          </div>
          {createPortal(stage, pipWin.document.body)}
        </>
      ) : stage}

      {/* 快捷键放在按钮的悬停提示里，画面上不挂说明文字 */}
    </div>
  );
}
