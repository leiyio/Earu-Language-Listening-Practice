import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createDictSession, createMarks } from '../../core/dictation/session.js';
import { ensureWordRank, wordRankReady } from '../../core/dictation/rare.js';
import { puzzleId, isInProgress } from '../../core/sort/puzzle.js';
import { practiceVisible, panelAction } from '../sort/display.js';

// 听写版的 useSortSession：入参、返回的形状一样（enabled / subKey / lines / rawLines / player / state / lang / forceMask / grade），本机版不上报、不计分。
// 会话是 core/dictation/session.js（词位、判分、提示 / 看答案）；长句预填几个词看难度档 grade，预填要查词频表（rare.js），第一次出题前等它装好。
// 返回 {snap, session, docVisible, hintWhy}
export function useDictSession({ enabled, subKey, lines, rawLines, player, state, lang = 'en', forceMask = false, grade }) {
  const session = useMemo(() => createDictSession({ lang, marks: createMarks({ owner: () => 'local' }) }), []); // lang 只在建会话时当初值，之后变了靠下面的 setLang 告诉它
  useEffect(() => () => session.dispose(), [session]);

  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // 换片、换字幕轨：每句统计、答案框全作废，题目清掉
  useEffect(() => {
    session.resetAll();
  }, [session, subKey]);

  // 难度档告诉会话（预填几个词看它）：放在出题那个效果前面，同一轮渲染里先换档、再出题
  useEffect(() => { session.setGrade(grade); }, [session, grade]);
  // 学的语言同理（判词、词位表、预填按它）：一定写在出题那个效果前面
  useEffect(() => { session.setLang(lang); }, [session, lang]);

  // 词频表（预填挑「比难度档更难的词」用）：开着听写就去装，装好之前不出题，免得同一句先后挑出两批不一样的预填。
  // 装不上也放行（rare.js 回 null，prefill.js 跳过这一步），不能让网络问题把听写卡死
  // 词频表按语言各一张（英语 COCA、西语表面形词频）：settled 记下「这门语言的表已经试过装了」（成功失败都算），没有表的语言 wordRankReady 直接是 true
  const [settled, setSettled] = useState({});
  const rankReady = wordRankReady(lang) || !!settled[lang];
  useEffect(() => {
    if (!enabled || rankReady) return undefined;
    let live = true;
    ensureWordRank(lang).then(() => { if (live) setSettled((m) => ({ ...m, [lang]: true })); });
    return () => { live = false; };
  }, [enabled, lang, rankReady]);

  // 出哪句的题：跟着播放器的当前句走（display.js panelAction）。出题带上这句的原文（rawLines[i].text），说话人标签按原文剥
  useEffect(() => {
    if (!enabled || !subKey || !rankReady) return;
    const i = state.index;
    const line = i >= 0 ? lines[i] : null;
    const cur = session.getSnapshot().puzzle;
    const targetId = line ? puzzleId(subKey, i) : null;
    const action = panelAction({
      state, line, time: player?.video?.currentTime ?? NaN,
      currentId: cur?.id ?? null, targetId, inProgress: isInProgress(cur),
    });
    if (action === 'show') session.show(targetId, line.text, rawLines?.[i]?.text);
    else if (action === 'clear') session.clear();
  }, [enabled, subKey, rankReady, state, lines, rawLines, player, session]);

  // 答题区是不是真的摆在她眼前（提示、眼睛的闸门看它）：规则和排序同一个 practiceVisible
  const [docVisible, setDocVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const f = () => setDocVisible(!document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const { visible, why: hintWhy } = practiceVisible({ enabled, state, docVisible, pip: false, puzzle: snap.puzzle, idle: false, forceMask, player });
  useEffect(() => { session.setVisible(visible); }, [session, visible]);

  // 循环走完一遍：记到那一句（只算统计 loops，不管提示的读秒）
  const loopsRef = useRef(state.loops);
  useEffect(() => {
    const prev = loopsRef.current;
    loopsRef.current = state.loops;
    if (!enabled || !subKey || !(state.loops > prev) || state.loopIndex < 0) return;
    session.countLoop(puzzleId(subKey, state.loopIndex));
  }, [state.loops, state.loopIndex, enabled, subKey, session]);

  return { snap, session, docVisible, hintWhy };
}
