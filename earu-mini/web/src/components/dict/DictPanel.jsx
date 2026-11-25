import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { t, learnAttrs, learnNow, hasTranslation } from '../../i18n/index.js';
import MaskText from '../sort/MaskText.jsx';
import TrPending from '../TrPending.jsx';
import { arrowStep } from '../../core/direction.js';
import { spaceInside } from '../../core/dictation/judge.js';
import { charButtonsOf, keyboardRowsOf } from '../../core/dictation/langRules.js';
import { lowerOf, upperOf } from '../../../../shared/langProfile.js';
import { fixing, typingSpace, fixSpace } from '../../core/dictation/keys.js';
import { frozenExpanded, puzzleIndexOf, hiddenWhyText, zhLine, maskInfo } from '../sort/display.js';
import { answerGate } from '../../core/practiceMode.js';

// 听写的答题区。和 SortPanel 同一副骨架：标题栏（题型 + 难度角标 + 文字钮）、中间一块、底栏一行译文；
// 样式复用 .sort-*，听写自己的只有 .dict-*。窄屏不出听写（practiceMode.js dictHost）。
//
// 中间这一块（按格输入，不是边打边判）：
//   「你的答案」+ 和排序同款的虚线答案框，框里先按词长画好一词一格的下划线（格子露出词数和词长）：
//     打的字写在当前格里（中性色），不判；空格、按键往哪格走见 core/dictation/keys.js：
//     空格跳到从当前格起第一个空着的格子（当前格空着就找后面的），全填满或在最后一格 = 一起判（数字格里打了 twenty 这种还没完的，
//     空格留在格里，judge.js spaceInside）。原句里两个词只隔一个连字符、点、冒号、斜杠（well-known、U.S.、10:30）时，打这个符号和空格一样。
//     回车一起判（没有「检查」钮）：对的格子变灰、锁住（光标进不去），错的变红、没打的红虚线；光标停在第一个错的格子、整词选中（fresh），
//     第一下按键清空它（空格、退格只清空，字母直接打进去）。改错时空格清空下一个错的格子跳过去，最后一个错的格子按空格再判；
//     重打过的格子变蓝（'fixed'），再判之前都还算错的格子。
//     退格 / ← 在格子开头回上一格，→ 在末尾去下一格（改错时只在错的格子之间走）；点哪个格子就到哪个格子。全对以后框里换成整句，回车 = 下一句。
//     「提示一下」亮的 2 秒里框里换成整句（琥珀色），画面字幕照旧打码（只显示答案，不解除打码）。
//   框里真正接键盘的是一个看不见的 <input>，它的值就是当前格的字（点框就把焦点给它；Esc 交还键盘、输入法选字时的空格回车不算）。
//   全对以后它留着、变只读，只为接住回车去下一句；只读时不算「在打字」（hostRoot.typingTarget），播放器的快捷键照常
//   一行说明（只在有话要说的时候出：没全对、没有题；平时不挂操作说明）；计分没计上时说为什么
// 头部按钮和排序一致，一律文字钮：没答对时【提示一下】【清空重写】，
// 答对后换成「+N 分」【句子解析】【继续播放 ›】。没有看答案、检查、首字母提示这几颗图标钮。
// 没有重播键、播放 / 暂停键：听写时这一句一直循环，暂停、播放在控制区；答案框里空格是打字，不是暂停。
//
// 键盘：Player 的快捷键让路靠两层——typingTarget(e)（焦点在 input 里就不处理）和 data-blocks-keys。后者 Player / ListDrawer 是
// 全页面 hostQuery 查的，挂久了会把整页快捷键永远关掉，所以只在答案框有焦点的时候才挂在外层 section 上。
//
// 入参和 SortPanel 对齐（snap、session 来自 useDictSession）：
//   onStep    全对以后回车 =「下一句」（useStudySession 的 stepSort）
//   onAnalyze 「句子解析」，同 SortPanel（够 3 个词才出，core/analyze.js canAnalyze）
//   lang      学习语种（答案框的 lang 属性）
// 其余（zh / zhPending / zhLayer / zhFold / showZh / onToggleZh / report / level / inStage / freeze / hideZhToggle / toast / hintWhy / forceMask / onRelease）同 SortPanel：
//   循环关着（shut）框里已打的字留着、打不进去，「提示一下」「清空重写」、点答案框都只 toast 一声「开循环才能答题」

// 要不要把焦点给答案框：焦点原本就在里面（同一个 input 一直挂着，换句时自然留着）算「已经在」；
// 页面上没有任何焦点元素才给；用户正点着别的输入框（字幕列表搜索框、宿主页自己的输入框）不抢。
// 嵌在 shadow DOM 宿主里时这块在 shadow DOM 里：用 getRootNode().activeElement 判里面有没有焦点，再看宿主页面有没有别的焦点
function shouldGrab(el) {
  if (!el || !el.isConnected) return false;
  const root = el.getRootNode();
  const doc = el.ownerDocument;
  if (root.activeElement === el) return false;
  const bare = (x) => !x || x === doc.body || x === doc.documentElement;
  if (root === doc) return bare(doc.activeElement);
  return !root.activeElement && bare(doc.activeElement);
}

// 回车判出的一格对错（session.getVerdict）→ 样式；没判过（undefined）是中性
const CELL_CLS = { ok: ' is-ok', bad: ' is-bad', empty: ' is-bad is-miss', fixed: ' is-fixed' };

// 每格后面跟着的那一个分隔符（原句里两个词之间只有一个连字符、点、冒号、斜杠这类字，没有空格）：打这个字也跳下一格
function gapsOf(parts) {
  const out = [];
  let prev = -1;
  let buf = '';
  for (const p of parts || []) {
    if (p.type !== 'slot') { buf += p.text; continue; }
    if (prev >= 0) out[prev] = [...buf].length === 1 && !/\s/.test(buf) ? buf : '';
    prev = p.slotIndex;
    buf = '';
  }
  return out;
}

export default function DictPanel({
  snap, session, player, state,
  hasLines, hasLine, lineHasWords,
  inStage = false, freeze = false, toast, hintWhy = null, onStep, lang = 'en',
  forceMask = false, onRelease,
  zh = null, zhPending = false, zhLayer, zhFold = false, showZh = true,
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const puzzle = snap?.puzzle || null;
  const lastExpanded = useRef(null);   // null = 刚挂上、没有上次状态：闲置冻结时取当前的（PZ-1）
  const gate = answerGate({ forceMask, state, player, index: puzzleIndexOf(puzzle) });
  const shut = !!puzzle && !puzzle.solved && gate.shown && !gate.open;
  const needLoop = () => toast?.(hiddenWhyText(gate.why));   // 循环关着 / 这句还在整理翻译（answerGate why）
  const expanded = frozenExpanded(lastExpanded.current, gate.shown, freeze);
  lastExpanded.current = expanded;

  // 各格的字、对错只有一份来源：会话（setCell / getCells / getVerdict）。会话只在「有字 / 没字」翻转时才换快照，每敲一个键靠 redraw 重画
  const [, redraw] = useReducer((n) => n + 1, 0);
  const cells = puzzle ? session.getCells(puzzle.id) : [];
  const verdict = puzzle ? session.getVerdict(puzzle.id) : [];
  const fixes = puzzle ? session.getFixes(puzzle.id) || [] : [];   // 西语少打重音符号的格：{格号: 正确拼法}（其他语言恒空）
  const charKeys = charButtonsOf(lang);
  const kbdRows = keyboardRowsOf(lang);   // 俄、阿、印地的屏幕字母键（按行排）；没有的语言是 null
  const composing = useRef(false);        // 韩、日、中输入法正在拼写（composition）：拼写中不判、不吞字、不当空格跳格
  const [check, setCheck] = useState(null);       // 回车没全对：{id, n}（还差几个），改了字就清
  const [fresh, setFresh] = useState('');         // 刚判完、还没按键的那一题 id（句乐部的 'fix'）：第一下按键清空第一个错的格子
  const [focused, setFocused] = useState(false);
  const peeking = !!puzzle?.hint;   // 「提示一下」那 2 秒：答案亮着，输入框只读、回车不交卷、清空重写不理
  const editable = !!puzzle && !puzzle.solved && expanded && !peeking && !shut;
  const hasInput = !!puzzle && expanded;

  // 光标在第几格：{id, k}；换了题回到第一个没锁住的格子。判过以后锁住的是对的格子，没锁住的就是错的格子
  const n = puzzle ? puzzle.slots.length : 0;
  const locked = (i) => verdict[i] === 'ok';
  const nextOpen = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < n; i += dir) if (!locked(i)) return i;
    return -1;
  };
  const [pos, setPos] = useState({ id: '', k: 0 });
  const k = pos.id === puzzle?.id && pos.k < n && !locked(pos.k) ? pos.k : Math.max(0, nextOpen(-1, 1));
  const cellText = cells[k] || '';
  const gaps = useMemo(() => gapsOf(puzzle?.parts), [puzzle?.parts]);
  // 预填的格子（puzzle.preset，core/dictation/prefill.js 挑的）：会话已经把它们当「回车判对、锁住」的格子交出来（getCells 带着正确答案、getVerdict 回 'ok'），
  // 光标、空格、退格绕开锁住的格子用的是上面的 locked / nextOpen，这里只多标一个 is-preset，让样式能把它和「用户自己答对的」分开
  const presetSet = useMemo(() => new Set(puzzle?.preset || []), [puzzle?.preset]);

  // 看不见的 input 里的选区：画格子里的光标 / 选中用。换格（go）时定选区：放在末尾（how = 'start' 放开头，'all' 整词选中）
  const [sel, setSel] = useState([0, 0]);
  const pendingSel = useRef(null);
  const placed = useRef('');
  const go = (i, how) => {
    pendingSel.current = how || 'end';
    setPos({ id: puzzle.id, k: i });
  };
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !editable) return;
    const key = `${puzzle.id}#${k}`;
    let how = pendingSel.current;
    if (!how && placed.current !== key) how = 'end';
    placed.current = key;
    pendingSel.current = null;
    if (!how) return;
    const len = el.value.length;
    if (typeof how === 'object') el.setSelectionRange(Math.min(how.at, len), Math.min(how.at, len));   // 字符钮插完字：光标落在插入的字后面
    else if (how === 'all') el.setSelectionRange(0, len);
    else if (how === 'start') el.setSelectionRange(0, 0);
    else el.setSelectionRange(len, len);
    setSel([el.selectionStart, el.selectionEnd]);
  });

  // 换题（换句、换片）关词卡（和排序一样）：只关答题区开的，字幕列表里查的词不跟着换句关
  // 新一句出题 / 答案框刚摆出来：按 shouldGrab 把焦点给答案框。浮动答题区闲置冻结着（freeze，答题区透明、不接鼠标）时不抢：
  // 抢了用户的字会敲进看不见的框里；鼠标一回来、解冻那一刻再给
  useEffect(() => {
    if (editable && !freeze && shouldGrab(inputRef.current)) inputRef.current.focus({ preventScroll: true });
  }, [puzzle?.id, editable, freeze]);
  // 答案框没了（收起）：焦点自然回到页面，别让「有焦点」的状态挂着
  useEffect(() => { if (!hasInput) setFocused(false); }, [hasInput]);

  const onChange = (e) => {
    if (!editable) return;
    // 普通词格里不收空白（空格在 onKeyDown 里就变成了跳格；输入法上屏带出来的空格丢掉）；数字格里留着（twenty five）。
    // 输入法拼写中（composing）原样收：拼音里的间隔符、韩文组字中间态动一个字都会把拼写打断；上屏（onCompositionEnd）再整理
    const v = puzzle.slots[k].value === null && !composing.current && !e.nativeEvent?.isComposing ? e.target.value.replace(/\s+/g, '') : e.target.value;
    setCheck(null);
    setFresh('');
    session.setCell(k, v);
    setSel([e.target.selectionStart, e.target.selectionEnd]);
    redraw();
  };
  // 西语字符钮（á é í ó ú ü ñ）：在光标处插一个字（有选中就换掉选中的）。钮上按下不让答案框丢焦点（onMouseDown preventDefault）。
  // 光标在格首、这一格的词是大写开头时插大写（Él、Ñandú）；数字格（slot.value 非空）也让插，判分里数字格不会用到它们，无害
  const insertChar = (ch) => {
    const el = inputRef.current;
    if (!editable || !el) return;
    const a = el.selectionStart ?? el.value.length;
    const b = el.selectionEnd ?? a;
    const first = [...(puzzle.slots[k]?.text || '')][0] || '';
    const c = a === 0 && first && first !== lowerOf(lang, first) ? upperOf(lang, ch) : ch;
    const v = el.value.slice(0, a) + c + el.value.slice(b);
    setCheck(null);
    setFresh('');
    session.setCell(k, v);
    pendingSel.current = { at: a + c.length };
    setSel([a + c.length, a + c.length]);
    redraw();
    el.focus({ preventScroll: true });
  };
  const doCheck = () => {
    if (!puzzle || puzzle.solved || peeking) return;
    const r = session.check();
    if (r && !r.solved && !r.ignored) {
      setCheck({ id: puzzle.id, n: r.wrong });
      setFresh(puzzle.id);
      if (r.first >= 0) go(r.first, 'all');
      inputRef.current?.focus({ preventScroll: true });
    } else {
      setCheck(null);
      setFresh('');
    }
    redraw();
  };
  const onCompositionStart = () => { composing.current = true; };
  const onCompositionEnd = (e) => { composing.current = false; onChange(e); };   // 上屏：这时才去掉空白、存进格子
  const onKeyDown = (e) => {
    if (composing.current || e.nativeEvent?.isComposing || e.keyCode === 229) return; // 输入法选字时的回车、空格不算
    if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
    if (!editable) {
      if (e.key === 'Enter' && puzzle?.solved && onStep) { e.preventDefault(); onStep(1); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === 'Enter') { e.preventDefault(); doCheck(); return; }
    const jump = e.key === ' ' || (gaps[k] && e.key === gaps[k]);
    if (fresh === puzzle.id) {
      // 刚判完的第一下：空格、退格只清空这一格；字母整词选中着，打进去就换掉（onChange 清 fresh）；左右键不清空、照常走
      if (jump || e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setFresh('');
        session.setCell(k, '');
        pendingSel.current = 'end';
        redraw();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setFresh('');
    }
    if (jump) {
      if (e.key === ' ' && atEnd && spaceInside(puzzle.slots[k], el.value)) return;
      e.preventDefault();
      const r = fixing(verdict, n) ? fixSpace(verdict, k, n) : typingSpace(cells, k, n, locked);
      if (r.check) { doCheck(); return; }
      if (r.clear) session.setCell(r.to, '');
      go(r.to);
      return;
    }
    // 左右键按学习语言的写字方向算前后（阿拉伯语从右往左：右 = 前一格、左 = 后一格）
    const step = arrowStep(e.key, learnNow());
    if ((e.key === 'Backspace' || step < 0) && atStart) {
      const pv = nextOpen(k, -1);
      if (pv >= 0) { e.preventDefault(); go(pv); }
    } else if (step > 0 && atEnd) {
      const nx = nextOpen(k, 1);
      if (nx >= 0) { e.preventDefault(); go(nx, 'start'); }
    }
  };

  // 头部两颗钮。「提示一下」= 答题区亮原句 2 秒（session.peekEn，视同看了答案）：灰着点了说一声为什么（触屏没有悬停）；亮着的 2 秒里再点不算
  const st = snap?.hint?.state || 'none';
  const gateOk = st === 'ready';
  const peekTitle = st === 'ready' || st === 'showing' ? t('dictPeekEnTitle')
    : st === 'waiting' ? t('dictHintWaitTitle')
      : st === 'solved' ? t('sortHintSolved')
        : st === 'hidden' ? hiddenWhyText(hintWhy) : t('maskHidden');
  const onPeek = () => {
    if (peeking) return;
    if (!gateOk) { toast?.(peekTitle); return; }
    session.peekEn();
  };
  const canAct = !!puzzle && !puzzle.solved && !peeking && !shut;
  // 「清空重写」：没锁住的格子全清空、对错作废，光标回第一个没锁住的格子，并且从句首开始循环（同排序的「重新打乱」）
  const onClear = () => {
    if (shut) { needLoop(); return; }
    if (!canAct) return;
    const first = session.clearAll();
    setCheck(null);
    setFresh('');
    if (first >= 0) go(first);
    inputRef.current?.focus({ preventScroll: true });
    const index = puzzleIndexOf(puzzle);
    if (index >= 0) player?.setLoop(index);
    redraw();
  };

  // 译文（底栏一行）：没开译文时 zl 为 null，整行不出；点开打码的译文 = 偷看
  const zl = zhLine({ show: hasTranslation(), on: !!showZh, layer: zhLayer, zh, pending: zhPending });
  const zhNode = !zl ? null : zl.kind === 'mask' ? (
    <MaskText text={zl.text} info={maskInfo('zh', snap?.hint, { why: hintWhy, dictate: true })}
      onPeek={() => session.peekZh?.()} toast={toast} fold={zhFold} />
  ) : zl.kind === 'mosaic' ? <span className="sub-mosaic" aria-hidden>{zl.text}</span>
    : zl.kind === 'ghost' ? <span className="sub-ghost" aria-hidden>{zl.text}</span> : zl.pending ? <TrPending /> : zl.text;

  // 一行说明（有话要说才出）
  let note = '';
  let noteWarn = false;
  if (!hasLines) note = t('sortNoteNoLines');
  else if (!puzzle) note = hasLine && lineHasWords === false ? t('sortNoteNoWords') : t('sortNoteGap');
  else if (!puzzle.solved && check && check.id === puzzle.id && check.n > 0) { note = t('dictCheckWrong', { n: check.n }); noteWarn = true; }

  // 全对以后：计上了头部出「+N 分」，没计上框下说为什么
  const solved = !!puzzle?.solved;

  const stop = (e) => e.stopPropagation(); // 挂在舞台里时，面板上的点击不能触发「点画面暂停 / 双击全屏」
  // 点答案框 = 把焦点给看不见的输入框（点在哪个格子上就先到哪个格子：格子的 onMouseDown 先跑再冒上来）。按下时就给、不让焦点先掉到页面上
  const grab = (e) => { if (shut) needLoop(); if (!editable) return; e.preventDefault(); inputRef.current?.focus({ preventScroll: true }); };

  // 框里写什么：全对 / 「提示一下」那 2 秒是整句（提示时琥珀色，同排序的提示），平时是格子
  let typed = null;
  if (puzzle) {
    if (puzzle.solved || peeking) {
      const cls = puzzle.solved ? 'is-ok' : 'is-shown';
      typed = puzzle.parts.map((p, i) => (p.type === 'literal'
        ? <span key={i} className="dict-lit">{p.text}</span>
        : <span key={i} className={`dict-w ${cls}${puzzle.solved && fixes[p.slotIndex] ? ' is-accent' : ''}`}
          title={puzzle.solved && fixes[p.slotIndex] ? t('dictAccentTip', { w: fixes[p.slotIndex] }) : undefined}>{p.text}</span>));
    } else {
      typed = puzzle.slots.map((slot, i) => {
        const text = cells[i] || '';
        const v = verdict[i];
        const here = focused && i === k;
        const fix = v === 'ok' ? fixes[i] : null;      // 少打了重音符号：这一格标黄、显示正确拼法
        let body = fix || text;
        if (here) {
          const a = Math.min(sel[0], text.length);
          const b = Math.min(Math.max(sel[1], a), text.length);
          body = (
            <>
              {text.slice(0, a)}
              {a === b ? <span className="dict-caret" /> : <span className="dict-sel">{text.slice(a, b)}</span>}
              {text.slice(b)}
            </>
          );
        }
        return (
          <span key={i} className={`dict-cell${CELL_CLS[v] || ''}${presetSet.has(i) ? ' is-preset' : ''}${fix ? ' is-accent' : ''}${here ? ' is-cur' : ''}`} style={{ '--n': [...slot.text].length }}
            title={fix ? t('dictAccentTip', { w: fix }) : undefined}
            onMouseDown={() => { if (editable && !locked(i)) { setFresh(''); go(i); } }}>
            {body}
          </span>
        );
      });
    }
  }
  const boxCls = !puzzle ? '' : puzzle.solved ? ' is-correct' : peeking ? ' is-peek' : '';

  return (
    <section ref={rootRef}
      className={`sort-panel dict-panel${expanded ? '' : ' is-collapsed'}${peeking ? ' is-hinting' : ''}${inStage ? ' in-stage' : ''}${solved ? ' is-solved' : ''}${shut ? ' is-locked' : ''}`}
      aria-label={t('sortTitle')} onClick={stop} onDoubleClick={stop}
      data-blocks-keys={focused && (editable || peeking) ? '' : undefined}>
      <header className="sort-head">
        <div className="sort-title"><strong>{t('kindDictate')}</strong></div>
        <div className="sort-tools">
          {solved ? (
            <>
              <button type="button" className="sort-tool is-pri" title={t('sortReleaseTitle')} onClick={onRelease || (() => player?.release())}>{t('sortRelease')}</button>
            </>
          ) : (
            <>
              <button type="button" className={`sort-tool${st === 'waiting' ? ' is-waiting' : ''}${peeking ? ' is-on' : ''}`}
                aria-disabled={(!gateOk && !peeking) || undefined} aria-pressed={peeking} title={peekTitle} onClick={onPeek}>{st === 'waiting' ? t('sortHintWait', { n: snap?.hint?.leftSec ?? '' }) : t('sortHint')}</button>
              <button type="button" className="sort-tool" aria-disabled={!canAct || undefined} title={t('dictClearTitle')}
                onClick={onClear}>{t('dictClear')}</button>
            </>
          )}
        </div>
      </header>
      {peeking && !solved && <div className="sort-cd" aria-hidden><i /></div>}
      <div className="sort-body dict-body">
        {!expanded && !inStage && <p className="sort-collapsed-tip">{t('sortCollapsed')}</p>}
        {expanded && (
          <>
            {puzzle && (
              <>
                {editable && kbdRows && (
                  <div className="dict-kbd" role="group" aria-label={t('dictCharsLabel')} onMouseDown={(e) => e.preventDefault()} {...learnAttrs()}>
                    {kbdRows.map((row, ri) => (
                      <div key={ri} className="dict-kbd-row">
                        {row.map((ch) => (
                          <button key={ch} type="button" className="dict-char dict-key" tabIndex={-1} onClick={() => insertChar(ch)}>{ch}</button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {editable && charKeys.length > 0 && (
                  <div className="dict-chars" role="group" aria-label={t('dictCharsLabel')} onMouseDown={(e) => e.preventDefault()}>
                    {charKeys.map((ch) => (
                      <button key={ch} type="button" className="dict-char" tabIndex={-1} title={t('dictCharTitle', { c: ch })} onClick={() => insertChar(ch)}>{ch}</button>
                    ))}
                  </div>
                )}
                <div className={`sort-answer dict-answer${boxCls}`} onMouseDown={grab}>
                  <div className="dict-typed" aria-hidden={puzzle.solved || peeking ? undefined : true} {...learnAttrs()}>{typed}</div>
                  {hasInput && (
                    <input ref={inputRef} className="dict-input" type="text" value={editable || peeking ? cellText : ''} readOnly={!editable} {...learnAttrs()} lang={lang}
                      aria-label={t('dictInputLabel')}
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done"
                      onChange={onChange} onKeyDown={onKeyDown} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd}
                      onSelect={(e) => setSel([e.target.selectionStart, e.target.selectionEnd])}
                      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
                  )}
                </div>
              </>
            )}
            {note && <p className={`sort-note dict-note${noteWarn ? ' is-warn' : ''}`} role={noteWarn ? 'status' : undefined}>{note}</p>}
          </>
        )}
      </div>
      {zl != null && <div className="sort-foot"><div className="sort-zh">{zhNode}</div></div>}
    </section>
  );
}
