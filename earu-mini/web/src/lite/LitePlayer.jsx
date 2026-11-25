import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import siteCss from '../styles.css?shadow-css';
import overlayCss from '../overlay/overlay.css?shadow-css';
import liteCss from './liteShadow.css?shadow-css';
import { Session, ErrorBoundary } from '../overlay/Session.jsx';
import { useLocalAdapter } from '../desktop/useLocalAdapter.js';
import { chooseSource } from '../core/player/remuxSource.js';
import { getLocalLearn } from '../core/learnCache.js';
import { trackLangOf } from '../../../shared/langs.js';
import { setHostRoot, typingTarget } from '../core/hostRoot.js';
import { exitAllFullscreen, toggleWindowFullscreen } from '../core/fullscreen.js';
import { mountFog } from '../components/subFog.js';
import { BackIcon } from '../components/icons.jsx';
import { lt } from './liteText.js';
import LiteSkin from './LiteSkin.jsx';

// 本机练习版打开一部视频以后的播放界面：
//   舞台 .lite-lp（铺满窗口）：一个 closed 的 shadow root 宿主，里面是画面（.lite-frame）和 overlay/Session.jsx 那一整套（排序 / 听写），
//   样式表复用 overlay.css、再加 liteShadow.css；界面是歌词式（LiteSkin.jsx）。
// 只有本机视频：file 是用户自己选的 File，画面是 .lite-frame 里的 <video>，怎么放（MKV 换盒子）见 chooseSource，
//   字幕、进度、播放记录见 useLocalAdapter.js。杜比、DTS 声音浏览器放不了，照实说放不出声音。没有跟读录音、没有举报。
//   回首页 = 左上角箭头 → onClose。
const HOST_STYLE = 'all: initial !important; position: absolute !important; left: 0 !important; top: 0 !important; right: 0 !important; bottom: 0 !important; '
  + 'z-index: 2147483000 !important; display: block !important; pointer-events: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important;';

export default function LitePlayer({ file, kind, ent, onClose }) {
  const stageRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [ready, setReady] = useState(false);   // 放哪种盒子选好了、界面挂上了（选好之前左上角先给个返回钮）
  const goBack = () => { exitAllFullscreen().catch(() => {}); closeRef.current(); };

  useEffect(() => {
    const stage = stageRef.current;
    let dead = false;
    let host = null;
    let root = null;
    let unFog = null;
    let source = null;   // 本地片：chooseSource 的结果 { url, remux }
    const frame = document.createElement('div');
    frame.className = 'lite-frame lite-frame-local';
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    // 点画面暂停 / 接着放（同桌面版本地视频）
    const onTap = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
    video.addEventListener('click', onTap);
    frame.appendChild(video);

    const bridge = { host: async (msg) => { if (msg && msg.type === 'earuGoLibrary') goBack(); return { ok: true }; } };

    const shadowParts = () => {
      host = document.createElement('div');
      host.setAttribute('data-earu-demo', '');
      host.style.cssText = HOST_STYLE;
      const shadow = host.attachShadow({ mode: 'closed' });
      const css = `${siteCss}\n${overlayCss}\n${liteCss}`;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
      } catch {
        const st = document.createElement('style');
        st.textContent = css;
        shadow.appendChild(st);
      }
      const rootEl = document.createElement('div');
      rootEl.className = 'ov-root lite-ov';
      shadow.appendChild(rootEl);
      // 画面放在 shadow 里、排在 .ov-root 后面：liteShadow.css 用 .ov-root:has(...) ~ .lite-frame 跟着字幕列表、答题区让位
      shadow.appendChild(frame);
      unFog = mountFog(shadow);
      setHostRoot({ host, root: shadow, container: rootEl });
      const keepIn = (e) => { if (!(e.ctrlKey || e.metaKey || e.altKey) && typingTarget(e)) e.stopPropagation(); };
      for (const type of ['keydown', 'keyup', 'keypress', 'contextmenu']) shadow.addEventListener(type, keepIn);
      stage.appendChild(host);
      return { shadow, rootEl };
    };
    const { shadow, rootEl } = shadowParts();
    const mount = (useAdapter, adapterArgs) => {
      root = createRoot(rootEl);
      root.render(
        <ErrorBoundary bridge={bridge}>
          <Session bridge={bridge} hostEl={host} rootEl={rootEl} ownBar video={video} container={stage}
            useAdapter={useAdapter} adapterArgs={adapterArgs} skin={LiteSkin} />
        </ErrorBoundary>,
      );
    };
    // 怎么放照桌面版 LocalPlayer：浏览器能放的直接放文件，放不了的 MKV 换成 MP4 的盒子边转边播；选好了再挂界面。
    // 换盒子那头的消息（放不了画面 / 放不了声音）先记着，useLocalAdapter 挂上以后补
    const sig = { fail: false, audio: false, on: null };
    const fire = (what) => { sig[what] = true; sig.on?.(what); };
    chooseSource(file, { onAudioDropped: () => fire('audio'), onFail: () => fire('fail') }, trackLangOf(getLocalLearn()))
      .catch(() => ({ url: URL.createObjectURL(file), remux: null }))
      .then((s) => {
        if (dead) { s.remux?.destroy(); URL.revokeObjectURL(s.url); return; }
        source = s;
        video.disableRemotePlayback = !!s.remux;
        video.src = s.url;
        s.remux?.attach(video);
        setReady(true);
        mount(useLocalAdapter, { file, kind, source: s, ent, toggleFullscreen: () => { toggleWindowFullscreen(); }, sig });
      });
    // 手机上往下拖整页会触发浏览器的「下拉刷新」，播放界面整页本来就不该动：
    // 一是整页不许回弹（overscroll-behavior，安卓 Chrome、iOS 16 起的 Safari 认）；二是单指拖动只放行能滚的那块（练习区、设置抽屉），
    // 别处的拖动当场拦下（iPhone 上的 Chrome 认不认第一条没底，靠第二条兜）。排序拖词走 pointer 事件，拦 touchmove 不影响
    const de = document.documentElement;
    const oldOver = [de.style.overscrollBehavior, document.body.style.overscrollBehavior];
    de.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    const scrolls = (el) => {
      const cs = getComputedStyle(el);
      return (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)
        || (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1);
    };
    // 拦要挂在元素上（挂 shadow root 上 Chrome 不当它拦得住，事件发过来就是拦不了的）；shadow 是 closed 的，外面的舞台看不见拖的是哪块，
    // 里面先看一眼、能滚的记下来，冒泡到舞台再看拦不拦
    const scrollOk = new WeakSet();
    const markScroll = (e) => {
      for (const el of e.composedPath()) {
        if (el === shadow) break;
        if (el instanceof Element && scrolls(el)) { scrollOk.add(e); return; }
      }
    };
    const noPull = (e) => { if (e.touches.length === 1 && !scrollOk.has(e) && e.cancelable) e.preventDefault(); };
    rootEl.addEventListener('touchmove', markScroll, { passive: true });
    stage.addEventListener('touchmove', noPull, { passive: false });
    return () => {
      dead = true;
      rootEl.removeEventListener('touchmove', markScroll);
      stage.removeEventListener('touchmove', noPull);
      [de.style.overscrollBehavior, document.body.style.overscrollBehavior] = oldOver;
      setHostRoot(null);
      unFog?.();
      video.removeEventListener('click', onTap);
      // 先卸界面（收尾时最后存一次进度，要读播放头），再拆播放器。React 在渲染收尾时不许同步卸另一棵树，放到下一轮
      setTimeout(() => {
        root?.unmount();
        host?.remove();
        video.pause();
        if (source) {
          if (source.remux) { source.remux.destroy(); source.remux.release(); } else URL.revokeObjectURL(source.url);
        }
        video.removeAttribute('src');
        video.load();
      }, 0);
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lite-lp" ref={stageRef}>
      {!ready && (
        <button type="button" className="dk-lp-back" title={lt('back')} aria-label={lt('back')} onClick={goBack}><BackIcon size={20} /></button>
      )}
    </div>
  );
}
