import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createSortSession } from '../../core/sort/session.js';
import { puzzleId, isInProgress } from '../../core/sort/puzzle.js';
import { ensureWordRank, wordRankReady } from '../../core/dictation/rare.js';
import { hasWordRank } from '../../core/dictation/langRules.js';
import { practiceVisible, panelAction } from './display.js';

// 把排序的几块串起来：core/sort/session.js（题目、提示冷却）+ 播放器状态（出哪句的题、循环遍数）。本机版不上报、不计分。
// 入参：enabled 排序模式开着；subKey 字幕指纹（题目 id = `${subKey}:${句号}`）；lines 显示用的句子；rawLines 原文（可不传，默认用 lines）；
//   player / state 播放器和它的状态；lang 学习语种（zh / ja 走 core/sort/puzzleZh.js 的本机出题）；forceMask 练习里循环关着答不了题；grade 难度档（预摆几个词）。
// 返回 {snap, session, docVisible, hintWhy}：hintWhy 是提示不计时的原因（display.js practiceVisible）
export function useSortSession({ enabled, subKey, lines, rawLines, player, state, lang = 'en', forceMask = false, grade }) {
  const session = useMemo(() => createSortSession({}), []);
  useEffect(() => () => session.dispose(), [session]);

  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // 换片、换字幕轨：每句统计全作废、题目清掉
  useEffect(() => {
    session.resetAll();
  }, [session, subKey]);

  // 难度、学的语言告诉会话：一定写在下面「出哪句的题」那个 effect 前面，同一拍里先记下、再出题，这一句就已经按新难度摆
  useEffect(() => { session.setGrade(grade); }, [session, grade]);
  useEffect(() => { session.setLang(lang); }, [session, lang]);

  // 学英语、西语时等词频表装好再出题（预摆挑「比难度档更难的词」用，和听写同一批，core/dictation/prefill.js）：
  // 写法同听写 useDictSession，装不上也放行。别的语言不看词频表，不等
  const en = hasWordRank(lang);
  const [settled, setSettled] = useState({});
  const rankReady = wordRankReady(lang) || !!settled[lang];
  useEffect(() => {
    if (!enabled || !en || rankReady) return undefined;
    let live = true;
    ensureWordRank(lang).then(() => { if (live) setSettled((m) => ({ ...m, [lang]: true })); });
    return () => { live = false; };
  }, [enabled, en, lang, rankReady]);

  // 出哪句的题：跟着播放器的当前句走（display.js panelAction）。state 只在当前句、画面句、循环 / 暂停这些变了才换，
  // 不是每帧；播放头位置在这里现读一次（判断是不是已经走进空档）。
  // 出题带上这句的原文（rawLines[i].text）：说话人标签按原文判（SORT_VER s2）——SDH 轨恢复大小写以后的「Juror 6:」
  // 「Doug's mother:」光看显示文字认不出是标签，不带原文空位数会比 wordCount(原文) 多。
  // 中文题再带上当前句的标注（lineAnno）：标注到了这个 effect 会再跑一次，session.show 判断题要不要换（没动过的才换）。
  // 依赖只放当前句那一项：translate.js 每收一次回包都给一个新的 anno 数组，但没变的句子还是同一个对象，不会白跑
  const zh = lang === 'zh' || lang === 'ja';
  useEffect(() => {
    if (!enabled || !subKey || (en && !rankReady)) return;
    const i = state.index;
    const line = i >= 0 ? lines[i] : null;
    const cur = session.getSnapshot().puzzle;
    const targetId = line ? puzzleId(subKey, i) : null;
    const action = panelAction({
      state, line, time: player?.video?.currentTime ?? NaN,
      currentId: cur?.id ?? null, targetId, inProgress: isInProgress(cur),
    });
    if (action === 'show') {
      if (zh) session.show(targetId, line.text, rawLines?.[i]?.text, { zh: true, anno: null, lang });
      else session.show(targetId, line.text, rawLines?.[i]?.text);
    } else if (action === 'clear') session.clear();
  }, [enabled, subKey, en, rankReady, state, lines, rawLines, player, session, zh, lang]);

  // 词块是不是真的摆在眼前（提示 10 秒冷却从这一刻算）：排序模式、题摆出来了（循环或暂停，留白不算）、
  // 标签页在前台、不在画中画小窗里看（pip：画中画不是练习用的，小窗里不放面板；冷却不起算）。
  // 全屏时面板挂进了舞台（App 负责），照样算看得见。规则在 display.js practiceVisible，它顺带给出「只因为画中画」这个原因
  const [docVisible, setDocVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const f = () => setDocVisible(!document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const { visible, why: hintWhy } = practiceVisible({ enabled, state, docVisible, pip: false, puzzle: snap.puzzle, idle: false, forceMask, player });
  useEffect(() => { session.setVisible(visible); }, [session, visible]);

  // 循环走完一遍：记到那一句。播放器每到一次循环终点 state.loops +1，那时 loopIndex 就是那句
  const loopsRef = useRef(state.loops);
  useEffect(() => {
    const prev = loopsRef.current;
    loopsRef.current = state.loops;
    if (!enabled || !subKey || !(state.loops > prev) || state.loopIndex < 0) return;
    session.countLoop(puzzleId(subKey, state.loopIndex));
  }, [state.loops, state.loopIndex, enabled, subKey, session]);

  return { snap, session, docVisible, hintWhy };
}
