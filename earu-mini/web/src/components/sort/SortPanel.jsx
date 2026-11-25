import { useCallback, useEffect, useRef } from 'react';
import { t, hasTranslation } from '../../i18n/index.js';
import MaskText from './MaskText.jsx';
import TrPending from '../TrPending.jsx';
import AnswerTemplate from './AnswerZone.jsx';
import TokenBank from './TokenBank.jsx';
import { useDragDrop } from './useDragDrop.js';
import { frozenExpanded, hintButton, noteText, bankPlaceholder, puzzleIndexOf, hiddenWhyText, zhLine, maskInfo } from './display.js';
import { answerGate } from '../../core/practiceMode.js';

// 排序答题区：标题栏「排序」+ 提示 / 重新打乱（排对后只剩「继续播放」）、答案区、词块。
// 正常看片（循环关着、在放）时答案区和词块区收起，只剩标题栏；练习里循环关着时整块变灰锁住（answerGate），点了说一声为什么。
// hintWhy：提示不计时的原因（useSortSession）。forceMask：练习里一直摆着答题区。onRelease：点「继续播放」（答对后才重新遮盖）。
// 词块是普通文字，不查词。
const LONG_PUZZLE_WORDS = 20;

// 「提示 2 秒」：灰着点了说一声为什么（触屏没有悬停）
function hintAct(hb, session, toast) {
  if (hb.disabled) { toast?.(hb.title); return; }
  session.hint();
}
// 「重新打乱」：重建这一题（预摆不变），并且从句首开始循环——没开循环的点了也会开
function shuffleAct(puzzle, session, player) {
  if (!puzzle) return;
  session.reshuffle();
  const index = puzzleIndexOf(puzzle);
  if (index >= 0) player?.setLoop(index);
}

export default function SortPanel({
  snap, session, player, state,
  hasLines, hasLine, lineHasWords,
  inStage = false, freeze = false, toast, hintWhy = null, forceMask = false, onRelease,
  zh = null, zhPending = false, zhLayer, zhFold = false, showZh = true,
}) {
  const rootRef = useRef(null);
  const puzzle = snap?.puzzle || null;
  const lastExpanded = useRef(null);
  const index = puzzleIndexOf(puzzle);
  const gate = answerGate({ forceMask, state, player, index });
  const locked = !!puzzle && !puzzle.solved && gate.shown && !gate.open;
  const expanded = frozenExpanded(lastExpanded.current, gate.shown, freeze);
  lastExpanded.current = expanded;
  const hinting = !!puzzle?.hint;
  const long = (puzzle?.original?.length || 0) > LONG_PUZZLE_WORDS;

  const onDrop = useCallback((id, drop) => { session.drop(id, drop); }, [session]);
  const onClick = useCallback((id) => { session.click(id); }, [session]);
  const { dragId, highlight, onTokenPointerDown, onTokenClick } = useDragDrop({
    rootRef, onDrop, onClick, disabled: !puzzle || puzzle.solved || hinting || locked,
  });
  const needLoop = () => toast?.(hiddenWhyText(gate.why));
  const onTokClick = locked ? (tok) => { if (!tok.preset) needLoop(); } : onTokenClick;
  const onReplay = useCallback(() => { if (index >= 0) player?.playOnce(index); }, [player, index]);

  const hb = hintButton(snap?.hint, { why: hintWhy });
  // 译文（底栏一行）：没开译文（hasTranslation 为假）时 zl 为 null，整行不出
  const zl = zhLine({ show: hasTranslation(), on: !!showZh, layer: zhLayer, zh, pending: zhPending });
  const zhNode = !zl ? null : zl.kind === 'mask' ? (
    <MaskText text={zl.text} info={maskInfo('zh', snap?.hint, { why: hintWhy })}
      onPeek={() => session.peekZh?.()} toast={toast} fold={zhFold} />
  ) : zl.kind === 'mosaic' ? <span className="sub-mosaic" aria-hidden>{zl.text}</span>
    : zl.kind === 'ghost' ? <span className="sub-ghost" aria-hidden>{zl.text}</span> : zl.pending ? <TrPending /> : zl.text;
  const onHint = () => hintAct(hb, session, toast);
  const onShuffle = () => (locked ? needLoop() : shuffleAct(puzzle, session, player));
  const release = onRelease || (() => player?.release());
  const note = puzzle ? '' : noteText({ hasLines, puzzle, hasLine, lineHasWords, loopMode: state.loopMode });
  const solved = !!puzzle?.solved;
  const stop = (e) => e.stopPropagation();

  return (
    <section ref={rootRef}
      className={`sort-panel${long ? ' is-long' : ''}${expanded ? '' : ' is-collapsed'}${hinting ? ' is-hinting' : ''}${inStage ? ' in-stage' : ''}${solved ? ' is-solved' : ''}${locked ? ' is-locked' : ''}`}
      aria-label={t('sortTitle')} onClick={stop} onDoubleClick={stop}>
      <header className="sort-head">
        <div className="sort-title"><strong>{t('kindSort')}</strong></div>
        <div className="sort-tools">
          {solved ? (
            <button type="button" className="sort-tool is-pri" title={t('sortReleaseTitle')} onClick={release}>{t('sortRelease')}</button>
          ) : (
            <>
              <button type="button" className={`sort-tool${hb.waiting ? ' is-waiting' : ''}${hinting ? ' is-on' : ''}`} aria-disabled={hb.disabled || undefined}
                aria-pressed={hinting} title={hb.title} onClick={onHint}>{hb.text}</button>
              <button type="button" className="sort-tool" aria-disabled={!puzzle || locked || undefined} title={t('sortShuffleTitle')}
                onClick={onShuffle}>{t('sortShuffle')}</button>
            </>
          )}
        </div>
      </header>
      {hinting && !solved && <div className="sort-cd" aria-hidden><i /></div>}
      <div className="sort-body">
        {!expanded && !inStage && <p className="sort-collapsed-tip">{t('sortCollapsed')}</p>}
        {expanded && (
          <>
            <div className={`sort-answer${solved ? ' is-correct' : ''}`} data-zone="answer" aria-label={t('sortAnswerArea')}>
              <AnswerTemplate puzzle={puzzle} dragId={dragId} highlight={highlight}
                onTokenPointerDown={onTokenPointerDown} onTokenClick={onTokClick} onReplay={onReplay} />
            </div>
            {/* 提示那 2 秒词块区不清空：照旧摆用户自己剩下的词块（puzzle.hint.bank 快照），压暗、不接鼠标 */}
            {!solved && (
              <TokenBank bank={(hinting ? puzzle?.hint?.bank : puzzle?.bank) || []} placeholder={puzzle ? bankPlaceholder(puzzle) : ''} dragId={dragId}
                onTokenPointerDown={onTokenPointerDown} onTokenClick={onTokClick} />
            )}
            {note && <p className="sort-note">{note}</p>}
          </>
        )}
      </div>
      {zl != null && <div className="sort-foot"><div className="sort-zh">{zhNode}</div></div>}
    </section>
  );
}
