import { Component, Suspense, lazy, useEffect, useMemo, useSyncExternalStore } from 'react';
import { t } from '../i18n/index.js';
import { useUiLang } from '../i18n/useUiLang.js';
import { UI_LANGS, UI_LANG_NAMES, setUiLang } from '../i18n/lang.js';
import { Pick } from '../desktop/Pick.jsx';
import { BrandLogo, FilmIcon } from '../desktop/icons.jsx';
import PickButton from '../components/PickButton.jsx';
import RecentList from '../components/RecentList.jsx';
import { DropOverlay, useFileDrop } from '../components/DropZone.jsx';
import { LEARN_CODES } from '../core/learnLines.js';
import { getLocalLearn, onLocalLearn, setLocalLearn } from '../core/learnCache.js';
import { lt } from './liteText.js';
import { useLocalHome } from './useLocalHome.js';

// 本机练习版首页：打开本机视频（点选 + 拖放）、最近播放、选在学语言、选界面语言。
// 没有账号、不联网；设置存本机 localStorage（在学语言 core/learnCache.js，界面语言 i18n/lang.js）。
// 版面用桌面版首页那套样式（desktop.css 的 dk-pagehead / dk-drop），深色、字重只有 400 / 700。
// 播放页这块文件取不到（页面开着的时候站点换了新版，旧文件名没了）：自动刷新一次拿新页面；一分钟内刷过就不再刷，交给下面的 LazyGuard 说一声
const RELOAD_KEY = 'earu.chunkReload';
const LitePlayer = lazy(() => import('./LitePlayer.jsx').catch((err) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* 存不了就不自动刷新 */ }
  if (Date.now() - last < 60000) throw err;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { throw err; }
  window.location.reload();
  return new Promise(() => {});
}));

// 播放器那一块（按需加载）出错：回首页、说一声，不整页白屏
class LazyGuard extends Component {
  constructor(p) { super(p); this.state = { bad: false }; }
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch() { this.props.onFail?.(); }
  render() { return this.state.bad ? null : this.props.children; }
}

// 页面标题：中文界面写「耳如 Earu」，其他语言写「Earu」
const titleOf = (lang) => (lang === 'zh-CN' || lang === 'zh-TW' ? '耳如 Earu' : 'Earu');
const learnName = (code) => UI_LANG_NAMES[code === 'zh' ? 'zh-CN' : code] || code;

export default function LiteApp() {
  const ui = useUiLang();
  useEffect(() => { document.title = titleOf(ui); }, [ui]);
  const learn = useSyncExternalStore(onLocalLearn, getLocalLearn, getLocalLearn);
  const local = useLocalHome();
  const { openLocal, openRecent, remove, recent, note, playing, closePlayer, fail } = local;
  const dragOver = useFileDrop(openLocal, !!playing);   // 拖进窗口哪里都收

  const learnOpts = useMemo(() => LEARN_CODES.map((c) => ({ id: c, name: learnName(c) })), [ui]);  // eslint-disable-line react-hooks/exhaustive-deps
  const uiOpts = useMemo(() => UI_LANGS.map((c) => ({ id: c, name: UI_LANG_NAMES[c] })), []);
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  return (
    <>
      <div className="dk-app lite-app" inert={!!playing}>
        <div className="dk-body">
          <header className="dk-pagehead lite-head">
            <BrandLogo size={26} />
            <h1>{t('dkBrand')}</h1>
            <div className="lite-head-picks">
              <Pick label={t('dkLearnSwitch')} pid="learn" value={learn} options={learnOpts} onChange={setLocalLearn} />
              <Pick label={t('setSecUiLang')} pid="ui" value={ui} options={uiOpts} onChange={(l) => setUiLang(l)} />
            </div>
          </header>
          <div className="dk-panel">
            <main className="dk-main dk-local">
              <section className={`dk-drop${dragOver ? ' over' : ''}`} aria-label={t('dkLocalOpen')}>
                <span className="dk-drop-icon"><FilmIcon size={30} /></span>
                <div className="dk-drop-text">
                  <h2>{touch ? lt('localTitleM') : t('dkLocalTitle')}</h2>
                </div>
                <PickButton className="btn primary big dk-pick-btn" label={t('dkLocalOpen')} onFile={openLocal} />
              </section>
              {note && <p className="dk-note" role="alert">{note.text}</p>}
              <RecentList items={recent} onOpen={openRecent} onRemove={remove} />
            </main>
          </div>
        </div>
      </div>
      {playing && (
        <LazyGuard key={`local:${playing.key}`} onFail={() => { closePlayer(); fail(); }}>
          <Suspense fallback={<div className="lite-lp" />}>
            <LitePlayer file={playing.file} kind={playing.kind} ent={playing.ent} onClose={closePlayer} />
          </Suspense>
        </LazyGuard>
      )}
      {dragOver && <DropOverlay />}
    </>
  );
}
