// 本机视频的 Session 适配器（overlay/Session.jsx 开头写着接口）：字幕和视频从用户打开的本地文件来。
//   读轨道和字幕（core/openMedia.js 起 Worker）→ 选字幕轨（pickTrack：上次选过的优先）→ 跳到上次看到的地方、开播
//   → 播放时每 5 秒存进度（useProgressSaver）→ 片名（core/title.js parseTitle 整理）
// 一部片一个 Session（换片随 key 卸掉重来），所以这里的状态不用管「换片」。
// adapterArgs（LitePlayer.jsx 给）：file、kind、source（chooseSource 的结果 {url, remux}）、ent（播放记录，没记上就是 null）、
//   toggleFullscreen（稳定的函数）、sig（换盒子那头的消息：放不了画面 / 放不了声音）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openMedia } from '../core/openMedia.js';
import { parseTitle, titleLabel, titleShow } from '../core/title.js';
import { internalSeek } from '../core/player/sentencePlayer.js';
import { isFinished } from '../core/history.js';
import { useProgressSaver } from '../components/useProgressSaver.js';
import { markPlaying } from '../core/player/remuxSource.js';
import { pickKeyOf, pickTrack, viewOf } from '../study/useStudySession.jsx';
import { t } from '../i18n/index.js';

const NO_KEYS = [];

// 进度条上方左上角的片名：parseTitle 整理过的；认不出来就写去掉扩展名的文件名
const EXT_RE = /\.(mkv|mp4|webm|m4v|mov)$/i;
export function barTitleOf(file, title) {
  const tt = title || parseTitle(file.name);
  const label = titleLabel(tt);
  if (!label) return file.name.replace(EXT_RE, '');
  const show = titleShow(tt);
  return show + label.slice(show.length);
}

export function useLocalAdapter({ file, kind, source, ent, toggleFullscreen, sig, video, videoRef, learnRef, pickedFor, showToast }) {
  const [tracks, setTracks] = useState(null);
  const [meta, setMeta] = useState(null);
  const [subs, setSubs] = useState(null);
  const [zhSubs, setZhSubs] = useState(null);
  const [cueTimes, setCueTimes] = useState(null);
  const [progress, setProgress] = useState(0);
  const [subsError, setSubsError] = useState(null);
  const [subId, setSubId] = useState(null);
  // 视频先于界面开始加载：界面挂上来之前 <video> 已经报过的错 / 已经解出的画面，在这里补上
  const [videoError, setVideoError] = useState(() => !!video.error && !source.remux);
  const [videoOk, setVideoOk] = useState(() => video.readyState >= 2 && video.videoWidth > 0);

  // ---- 读轨道和字幕 ----
  const apply = (r) => {
    setTracks(r.tracks);
    setSubs(r.subs);
    setZhSubs(r.zhSubs || null);
    setCueTimes(r.cueTimes || null);
    const { learn, script } = learnRef.current;
    pickedFor.current = pickKeyOf(learn, script);
    setSubId(pickTrack({ tracks: r.tracks, subs: r.subs, view: viewOf(learn, r.subs, r.zhSubs), ent, learn, script }));
  };
  useEffect(() => {
    const cancel = openMedia(file, kind, {
      onProbe: ({ tracks: tk, ...m }) => { setTracks(tk); setMeta(m); },
      onProgress: setProgress,
      onSubs: (r) => { setSubsError(null); apply(r); },
      onError: (message) => { setSubsError(message); setSubs((s) => s || {}); },
    });
    return () => { cancel(); };
  }, [file, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 跳到上次看到的地方（才开头或已看完就从头来），然后直接开始播 ----
  // 走播放器内部的跳转（internalSeek）：直接写 currentTime 会被当成用户拖了进度条。浏览器不让自动播就算了，等她自己点
  useEffect(() => {
    const position = ent?.position || 0;
    const go = () => {
      if (position > 3 && video.duration && !isFinished(position, video.duration)) internalSeek(video, position);
      video.play().catch(() => {});
    };
    if (video.readyState >= 1) { go(); return undefined; }
    video.addEventListener('loadedmetadata', go, { once: true });
    return () => video.removeEventListener('loadedmetadata', go);
  }, [video]); // eslint-disable-line react-hooks/exhaustive-deps

  useProgressSaver(videoRef, ent?.id ?? null);

  // ---- 换盒子那头的消息：边转边播放不了画面 → 按「画面放不了」报；放不了声音 → 提一句、只放画面 ----
  useEffect(() => {
    const on = (what) => {
      if (what === 'fail') setVideoError(true);
      else showToast(t('remuxNoAudio'), 5000);
    };
    if (sig.fail) on('fail');
    if (sig.audio) on('audio');
    sig.on = on;
    return () => { if (sig.on === on) sig.on = null; };
  }, [sig, showToast]);

  const title = useMemo(() => (meta ? parseTitle(file.name, meta.title) : null), [file, meta]);
  const show = useMemo(() => barTitleOf(file, title), [file, title]);
  const media = useMemo(() => ({ file, kind, url: source.url, remux: source.remux, sample: false }), [file, kind, source]);
  const shownTracks = useMemo(() => markPlaying(tracks, source.remux), [tracks, source]);
  const src = useMemo(() => ({ subs, zhSubs, tracks: shownTracks, cueTimes, subId, setSubId }), [subs, zhSubs, shownTracks, cueTimes, subId]);
  // 边转边播的片出错交给换盒子那头报（sig.fail），自己不报
  const onVideoError = useCallback(() => { if (!source.remux) setVideoError(true); }, [source]);
  const onVideoOk = useCallback(() => setVideoOk(true), []);

  return {
    src, media, entry: ent, meta, show, title, subsError, progress, videoError, videoOk, onVideoError, onVideoOk,
    sourceNote: '', keys: NO_KEYS, toggleFullscreen, spin: true,
  };
}
