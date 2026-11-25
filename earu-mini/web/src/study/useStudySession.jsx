// 学习会话：只管播放、原文字幕、字幕列表、遮盖、循环、变速、排序、听写（本机版没有翻译、难度、解析、校准、注音、跟读）。
//   输入 inp：Session 给的字幕轨、字幕、视频元素、偏好、提示条……；
//   返回：Session / LiteSkin 要用的那几样。
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pickSubtitleTrack, trackIsLang } from '../core/lang.js';
import { setLearn, setNative } from '../i18n/index.js';
import { useTranslation } from './useTranslation.js';
import { learnScriptOf, learnShows, trackLangOf } from '../../../shared/langs.js';
import { getLocalLearn, onLocalLearn } from '../core/learnCache.js';
import TrackPanel from '../components/TrackPanel.jsx';
import LineList from '../components/LineList.jsx';
import { playModeOf } from '../components/usePlayerPrefs.js';
import { CC_MODES, ccModeOf, setCcMode, setCcOn, srcWhich, pracTrModeOf, setPracTrMode } from '../components/ccMode.js';
import { useSentencePlayer } from '../components/useSentencePlayer.js';
import SortPanel from '../components/sort/SortPanel.jsx';
import { useSortSession } from '../components/sort/useSortSession.js';
import DictPanel from '../components/dict/DictPanel.jsx';
import { useDictSession } from '../components/dict/useDictSession.js';
import { resolvePractice } from '../core/practiceMode.js';
import { listLayers, cuePosition, sortOffWhy, maskIndexOf, overlayView } from '../components/sort/display.js';
import { puzzleId } from '../core/sort/puzzle.js';
import { subsKey } from '../core/subsKey.js';
import { hasPracticeWords } from '../../../shared/practiceWords.js';
import { useLocalSettings } from './useLocalSettings.js';

export const NO_LINES = [];

// 学中文时字幕读哪一份：worker 给像中文的轨另算的中文视图（zhSubs）盖在原来那份上；学别的语言就是原来那份
export const viewOf = (learn, subs, zhSubs) => (learn === 'zh' && subs ? { ...subs, ...(zhSubs || {}) } : subs);
// 默认字幕轨（第一次选、学习语言变了重选）：上次手动选过的轨优先，它得是在学的语言
export function pickTrack({ tracks, subs, view, ent, learn, script }) {
  const saved = tracks.find((x) => x.id === ent?.subId && x.kind === 'text' && x.cueCount > 0 && (learn === 'en' || trackIsLang(x, view[x.id], trackLangOf(learn))));
  if (saved) return saved.id;
  return (learn === 'zh' ? pickSubtitleTrack(tracks, 'zh', view, { script }) : pickSubtitleTrack(tracks, trackLangOf(learn), subs))?.id ?? null;
}
// 选轨是按哪种学习语言、哪种字形选的：变了才重选
export const pickKeyOf = (learn, script) => (learn === 'zh' ? `zh|${script}` : trackLangOf(learn));

// 精听 / 排序：界面偏好，记在本机
export const MODE_KEY = 'earu.mode';

const useLocalLearn = () => useSyncExternalStore(onLocalLearn, getLocalLearn, getLocalLearn);

export function useStudySession(inp) {
  const { learnRef, subs, zhSubs, tracks, pickedFor, setSubId, entry, subId, media, subsError, modePref, meta, videoRef, showToast, prefs, setPref, videoError, videoOk, progress, readMore, sourceNote, subsPartial } = inp;
  const settings = useLocalSettings();
  const loopSet = settings.values.loop;
  const learn = useLocalLearn();
  const script = learnScriptOf(learn === 'zh' ? 'zh-CN' : learn);
  learnRef.current = { learn, script };
  setLearn(learn, learn !== 'zh' ? learn : script === 'Hant' ? 'zh-TW' : 'zh-CN');

  const viewSubs = useMemo(() => viewOf(learn, subs, zhSubs), [learn, subs, zhSubs]);
  // 学习语言变了：按新的重选一次轨（这部片还没选过 = pickedFor 为空时不动，等读字幕那边选）
  useEffect(() => {
    if (!tracks || !subs || pickedFor.current == null) return;
    const k = pickKeyOf(learn, script);
    if (pickedFor.current === k) return;
    pickedFor.current = k;
    setSubId(pickTrack({ tracks, subs, view: viewSubs, ent: entry, learn, script }));
    readMore?.(learn, script);
  }, [learn, script, tracks, subs, viewSubs, entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (viewSubs && subId != null ? viewSubs[subId] || NO_LINES : NO_LINES), [viewSubs, subId]);
  const subTrack = tracks?.find((x) => x.id === subId);
  const trackOk = !!subTrack && trackIsLang(subTrack, lines, learn);
  const practicable = useMemo(() => lines.map((l) => hasPracticeWords(learn, l.text)), [lines, learn]);
  const practicableCount = useMemo(() => practicable.reduce((n, x) => n + (x ? 1 : 0), 0), [practicable]);
  const sortOk = learnShows(learn, 'sort') && trackOk && !subsPartial && practicableCount > 0;
  const learnTrack = subTrack && !trackOk && tracks
    ? (learn === 'zh' ? pickSubtitleTrack(tracks, 'zh', viewSubs, { script }) : pickSubtitleTrack(tracks, trackLangOf(learn), subs)) : null;
  const sortWhy = sortOffWhy({
    loading: !!media && (!subs || !!subsPartial),
    failed: !!subsError && !lines.length,
    otherTrack: !!learnTrack && learnTrack.id !== subId && (viewSubs?.[learnTrack.id]?.length ?? 0) > 0,
  });
  // 存着「排序」但这部片排不了：这一次按精听显示，存的偏好不改
  const mode = media && modePref === 'sort' && sortOk ? 'sort' : 'listen';
  const pm = resolvePractice({ dictHost: true, mode, learn, kindPref: settings.values.sort?.kind });

  // 练习时循环只咬能练的句子；点「练这句」那一刻的这句不受限
  const entryRef = useRef(-1);
  const sortFilter = useCallback((i) => practicable[i] !== false, [practicable]);
  const { player, state } = useSentencePlayer(videoRef, media?.url, lines, {
    lead: loopSet.lead, tail: loopSet.tail, gap: loopSet.gap, filter: mode === 'sort' ? sortFilter : null,
    earlyBack: !!media?.remux, growing: !!subsPartial, linesKey: subId,
  });
  // 记住的播放方式：新建出播放器时本机偏好是「每句停」就开上；练习里只许循环、不恢复；从练习回到观影换回练习前的
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const modeLocked = mode === 'sort' || pm.playModeLocked;
  const restoreRef = useRef({ player: null, locked: modeLocked, before: null });
  useEffect(() => {
    const prev = restoreRef.current;
    const same = prev.player === player;
    const before = !modeLocked || !same ? null : prev.locked ? prev.before : player?.playModeNow() ?? null;
    restoreRef.current = { player, locked: modeLocked, before };
    if (!player || modeLocked) return;
    if (same && !prev.locked) return;
    if (same) { player.restorePlayMode(prev.before || playModeOf(prefsRef.current)); return; }
    if (playModeOf(prefsRef.current) === 'stop' && player.playModeNow() === 'continuous') player.setPlayMode('stop');
  }, [player, modeLocked]); // eslint-disable-line react-hooks/exhaustive-deps
  // 进练习时默认开着循环（只亮按钮、不开播）；记下「练这句」那一刻要循环的句子
  const armRef = useRef({ player: null, mode: null });
  useEffect(() => {
    const prev = armRef.current;
    if (player && mode === 'sort' && (prev.player !== player || prev.mode !== 'sort')) {
      entryRef.current = player.loopPick(player.video.currentTime);
      player.armLoop();
    }
    if (mode !== 'sort') entryRef.current = -1;
    armRef.current = { player, mode };
  }, [player, mode]);
  useEffect(() => {
    if (!player) return;
    player.setOpts({ filter: mode === 'sort' ? (i) => practicable[i] !== false && (i === entryRef.current || true) : null });
  }, [player, mode, practicable]);

  // 题目编号用的字幕指纹（本机算）
  const [key, setKey] = useState(null);
  useEffect(() => {
    if (!trackOk || subsPartial || !lines.length) { setKey(null); return undefined; }
    let alive = true;
    subsKey(trackLangOf(learn), lines).then((k) => { if (alive) setKey(k); });
    return () => { alive = false; };
  }, [trackOk, subsPartial, lines, learn]);
  const subKey = key && trackOk && !subsPartial ? key : null;

  // 母语译文（没填 AI 接口时 tr.on 为假：下面所有译文相关的东西都是 null / 不画）
  const tr = useTranslation({ lines, subKey, learn, near: state.index });

  const curId = subKey && state.index >= 0 ? puzzleId(subKey, state.index) : null;
  const kind = pm.kind;
  const sort = useSortSession({
    enabled: mode === 'sort' && kind === 'sort', subKey, lines, player, state, lang: learn, forceMask: pm.forceMask, grade: settings.values.grade,
  });
  const dict = useDictSession({
    enabled: mode === 'sort' && kind === 'dictate', subKey, lines, player, state, lang: learn, forceMask: pm.forceMask, grade: settings.values.grade,
  });
  const prac = kind === 'dictate' ? dict : sort;
  const puzzle = prac.snap.puzzle;
  const puzzleIndex = puzzle ? Number(puzzle.id.slice(puzzle.id.lastIndexOf(':') + 1)) : -1;
  useEffect(() => { player?.setFocus(mode === 'sort' ? puzzleIndex : -1); }, [player, mode, puzzleIndex]);

  // 答对以后两层都亮，直到点「继续播放」才重新盖上
  const solvedIndex = mode === 'sort' && puzzle?.solved && puzzle.id === curId ? state.index : -1;
  const [remaskId, setRemaskId] = useState(null);
  useEffect(() => { if (solvedIndex < 0) setRemaskId(null); }, [solvedIndex]);
  const remask = solvedIndex >= 0 && remaskId === puzzle?.id;
  const onRelease = () => {
    if (solvedIndex >= 0 && puzzle) setRemaskId(puzzle.id);
    player?.release();
  };
  const maskIndex = maskIndexOf({ mode, enabled: !!subKey, curId, puzzleId: puzzle?.id ?? null, state, practicable, puzzleIndex });
  const setSortPref = (k, v) => settings.setSortPref(k, v);
  const peek = { en: !!puzzle?.hint && puzzle.id === curId, zh: tr.on && !!prac.snap.zhPeek && puzzle?.id === curId };
  const pracZhMode = pm.forceMask ? pracTrModeOf(prefs) : 'fog';
  // 译文开着时：母语跟界面语言、<html data-tr> 给各语言字体用
  const nativeCode = tr.on ? tr.target : null;
  setNative(nativeCode);
  useEffect(() => {
    const el = document.documentElement;
    if (nativeCode) el.dataset.tr = nativeCode; else delete el.dataset.tr;
    return () => { delete el.dataset.tr; };
  }, [nativeCode]);
  const sortSession = prac.session;
  const dictate = kind === 'dictate';
  const masks = mode === 'sort' && puzzle && !puzzle.solved ? {
    onPeek: () => { if (dictate) sortSession.peekEn(); else sortSession.hint(); },
    toast: showToast, dictate, why: prac.hintWhy, hint: prac.snap.hint,
  } : null;
  const display = { mode, solvedIndex, puzzleIndex: mode === 'sort' ? maskIndex : -1, peek, masks, remask, toast: showToast, zhMode: pracZhMode };

  // 控制区「字幕」三态（显示 / 隐藏 / 遮盖）：练习时锁在遮盖
  const srcW = srcWhich(learn === 'zh');
  const cc = mode === 'sort'
    ? { en: false, enMode: 'fog', modes: CC_MODES, forceMaskEn: true, setEnMode: () => {}, zhMode: pracZhMode, setZhMode: (m) => setPracTrMode(setPref, m) }
    : (() => {
      const enMode = ccModeOf(prefs, srcW);
      const zhMode = ccModeOf(prefs, 'tr');
      return { en: enMode === 'show', enMode, modes: CC_MODES, setEn: (v) => setCcOn(setPref, srcW, v), setEnMode: (m) => setCcMode(setPref, srcW, m), zhMode, setZhMode: (m) => setCcMode(setPref, 'tr', m) };
    })();
  const layerAt = useMemo(() => listLayers({ mode, solvedIndex, puzzleIndex: maskIndex, peek, maskOn: false, forceMask: pm.forceMask, remask, zhMode: pracZhMode, cc: tr.on ? { en: cc.en, zh: cc.zhMode === 'show' } : { en: cc.en } }),
    [mode, solvedIndex, maskIndex, peek.en, peek.zh, pm.forceMask, remask, cc.en, cc.zhMode, pracZhMode, tr.on]); // eslint-disable-line react-hooks/exhaustive-deps

  // 答题区里那行译文这一刻该画成什么（overlayView 的译文层，和画面上同一个判断）
  const zhView = tr.on && mode === 'sort'
    ? overlayView({ mode: 'sort', state, zhMode: pracZhMode, sort: { en: true, zh: true }, solvedIndex, puzzleIndex: maskIndex, peek, maskOn: true, maskEn: true, forceMask: pm.forceMask, remask })
    : null;
  const zhLayer = zhView && maskIndex >= 0 && zhView.index === maskIndex ? zhView.zh : null;

  // ←/→、上一句 / 下一句：跳过剥完没词的句子
  const stepSort = useCallback((dir) => {
    if (!player) return;
    if (!lines.length) { player.step(dir); return; }
    player.step(dir, { accept: (i) => practicable[i] !== false });
  }, [player, lines, practicable]);

  const position = cuePosition(mode === 'sort' ? practicable : lines.map(() => true), state.index);

  const trProps = tr.on ? {
    zh: puzzleIndex >= 0 ? tr.texts[puzzleIndex] ?? null : null, zhPending: tr.pending, zhLayer, zhFold: false, showZh: true,
  } : {};
  const sortPanel = () => (kind === 'dictate' ? (
    <DictPanel
      snap={dict.snap} session={dict.session} player={player} state={state}
      hasLines={practicableCount > 0} hasLine={state.index >= 0} lineHasWords={state.index >= 0 ? practicable[state.index] : null}
      toast={showToast} hintWhy={dict.hintWhy} forceMask={pm.forceMask} onStep={stepSort} lang={learn} onRelease={onRelease} {...trProps}
    />
  ) : (
    <SortPanel
      snap={sort.snap} session={sort.session} player={player} state={state}
      hasLines={practicableCount > 0} hasLine={state.index >= 0} lineHasWords={state.index >= 0 ? practicable[state.index] : null}
      toast={showToast} hintWhy={sort.hintWhy} forceMask={pm.forceMask} lineStart={puzzleIndex >= 0 ? lines[puzzleIndex]?.start : undefined} onRelease={onRelease} lang={learn} {...trProps}
    />
  ));

  const trackPanel = media ? (
    <>
      {sourceNote && <div className="panel"><div className="notice warn">{sourceNote}</div></div>}
      <TrackPanel tracks={tracks} meta={meta} subs={viewSubs} subsError={subsError} subId={subId} learnLang={learn} videoError={videoError} videoOk={videoOk} />
    </>
  ) : null;
  const lineList = (
    <LineList lines={lines} state={state} player={player} loading={!subs} progress={progress} subsError={subsError} layerAt={layerAt}
      zh={tr.on ? tr.texts : null} pending={tr.on && tr.pending} trFailed={tr.on ? tr.failed : 0} />
  );
  return { tr, learn, lines, player, state, mode, practice: pm, kind, sort, dict, sortOk, sortWhy, practicableCount, setSortPref, display, cc, layerAt, stepSort, position, sortPanel, trackPanel, lineList, subTrack };
}
