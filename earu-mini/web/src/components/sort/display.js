// 排序模式的「显示规则」：纯函数，不碰 DOM，Node 里能直接测。
// 什么时候摆出题、什么时候清面板、画面上和答题区里显示哪句英文 / 中文、提示行和按钮写什么、计分结果怎么说成人话。
import { t } from '../../i18n/index.js';
import { noLearnText } from '../../core/noLearn.js';
import { renderLang } from '../../i18n/lang.js';
import { forcedLayers, answerGate, zhHiddenAt } from '../../core/practiceMode.js';
import { ccModeFrom, ccLayer, ccBest } from '../ccMode.js';

// ---- 出不出题 ----

// 词块是不是真的摆在她眼前（提示 10 秒冷却从这一刻起算；useSortSession 拿它调 session.setVisible）：
// 排序模式、题摆出来了（循环或暂停，留白不算）、标签页在前台、不在画中画小窗里看（画中画不是练习用的；
// 冷却不起算）。返回 {visible, why}：why = 'pip' 是别的都齐了、只因为画中画开着才不算——
// 提示按钮换一句话说（她暂停着、词块就摆在主页面右栏，再说「暂停、或者开循环」是假话）
// idle：浮动模式下答题区闲置着（指针离开 3 秒，只剩一行中文，词块是黑的），加上醒来那 260ms——不算看得见。
// 不看闲置的话：她手离开鼠标 → 3 秒后闲置 → 按空格暂停，10 秒冷却会在黑着的词块上白白跑完
// forceMask（桌面版练习）：答题区一直摆着，但循环关着答不了题（answerGate.open），也不算看得见——提示、偷看都关上、冷却不走，
// why = 'loop'，灰着的提示钮、打码的字点了都说「开循环才能答题」；
// 这句字幕还没整理翻译好、循环开不了（player.canLoop）why = 'tr'，说「这句还在整理翻译」。player 是 SentencePlayer
export function practiceVisible({ enabled, state, docVisible, pip, puzzle, idle = false, forceMask = false, player = null }) {
  const gate = answerGate({ forceMask, state, player, index: puzzleIndexOf(puzzle) });
  if (!(enabled && gate.shown && docVisible && puzzle) || idle) return { visible: false, why: null };
  if (pip) return { visible: false, why: 'pip' };
  return gate.open ? { visible: true, why: null } : { visible: false, why: gate.why };
}

// 提示、偷看此刻用不了时（hint.state === 'hidden'）说为什么：why 是 practiceVisible 给的原因
export const hiddenWhyText = (why) => t(why === 'pip' ? 'sortHintPip' : why === 'loop' ? 'practiceNeedLoop'
  : why === 'tr' ? 'practiceNeedTr' : 'sortHintHidden');

// 浮动模式答题区闲置期间冻结收起 / 展开：只透明不塌缩，不然中文那行会上下跳。
// freeze 为真沿用上一次的展开状态，为假取现在的。prev 为 null（面板刚挂上，比如排序、听写切换后新出来的面板）没有上次状态，
// 取现在的：不然新面板一出来就冻在「收起」，鼠标进答题区才展开
export function frozenExpanded(prev, now, freeze) {
  return freeze && prev != null ? !!prev : !!now;
}

// 面板该对当前句做什么（selectCueAtCurrentTime）：
//   'show'  出这句的题（同一句不重出，session.show 自己保留她的排法）
//   'keep'  手上这道题留着不动
//   'clear' 面板清空（「此刻无字幕」）
// 输入：state = 播放器状态；line = state.index 那句；time = 播放头；currentId = 面板上这道题的 id；targetId = state.index 那句的 id；
//       inProgress = 她正在排（puzzle.js isInProgress：自己放了词、还没排对，预摆的不算）。
// 规则：
//   · 循环中、重播一次中、停下来钉着这句（暂停且画面认它）：一律出这句的题，不按播放头清；
//   · 播放头在这句里（或者刚 ←/→ 跳过来、还在它的前缓冲里）：出这句的题；
//   · 播放头已经越过句尾、在空档里（此刻无字幕）：不新出题；手上是这句的题时，暂停着、或者她正在排就留着
//     （三条例外：在排 / 排对且暂停 / 视频暂停），否则清掉。
//     清掉以后她在空档里暂停，面板也不再把刚才那句捡回来：这时按 R，播放器循环的是下一句（toggleLoop 在空档里等着咬住），
//     面板要和它一致（清了就是「此刻无字幕」）。
// 「越过句尾」按 time >= line.end 判，不加容差：播放器的画面句 active 正是在 t >= end 那一刻变成 -1（sentencePlayer tick），
// 那是播进空档以后最后一次状态变化，这一刻不清就要一直等到下一句开始才清（空档里面板一直挂着上一题）。
export function panelAction({ state, line, time, currentId, targetId, inProgress }) {
  const i = state?.index ?? -1;
  if (i < 0 || !line) return inProgress ? 'keep' : 'clear';
  const pinned = state.loopIndex >= 0 || state.once >= 0 || (state.paused && state.active === i);
  const inGap = !pinned && Number.isFinite(time) && time >= line.end;
  if (!inGap) return 'show';
  if (currentId && currentId === targetId && (state.paused || inProgress)) return 'keep';
  return 'clear';
}

// ---- 画面字幕 ----
// 返回 {index, en, zh, note}：画面上显示第 index 句（-1 什么都不显示）；en（原文）/ zh（译文）这一层怎么出：
//   'text' 照常显示；'mask' 打码（真字 + 雾，看得出「这里有字」，点开就是提示）；
//   'mosaic' 字幕打码（控制区「字幕打码」点亮了这种语言 = 开关关着：原字照样排、糊成雾，点不开）；
//   null 不出（没有这一层：手动选到非英文轨时的译文）。note：顶部注释出不出（注释是从译文里分出来的，译文打着码时注释也不出；
//   「字幕打码」不管注释）。
//   mode：'listen' 精听 / 'sort' 排序
//   listen：{en, zh} 精听的原生字幕、翻译字幕（控制区三态 'show' | 'hide' | 'fog'，或老布尔；本机记住，ccMode.js）；sort：{en, zh} 排序的两个开关（「排序时底部原文」「翻译」，学习设置）
//   noteOn：顶部注释开关（不传 = 一直出）；originalOnly：手动选到了非英文轨（只显示原文、不翻译）
//   solvedIndex：答题区里刚排对、还是当前句的那一句（没有 = -1）；puzzleIndex：答题区里这道题是第几句（没有 = -1）
//   peek：{en, zh} 手上这道题偷看着哪一层（en = 提示那 2 秒里，zh = 点开了译文，到这一句结束；session.js）
//   firstZh：新用户第一道题的译文先亮着（先亮后收，免得一开始就隐藏起来摸不着头脑）；由调用方给
//   maskOn：学习设置「练习时遮住字幕和翻译」（sort.mask），不传 = 开，只有 false 算关。关着时手上这一题不打码，两层照开关照常出
//   forceMask：两层强制打码、不可更改（practiceMode.js forceMask）：原文、译文都不再看 sort.en / sort.zh / maskOn / maskEn，
//     一律走 forcedLayers（规则写在那里）；remask：答对以后点了「继续播放」、重新盖上（useStudySession 记）。注释条练习时不出：屏幕上只留原文一行，母语在答题区底栏。
//     zhMode：练习时翻译字幕那一行的三态（'show' | 'hide' | 'fog'，默认 'fog'，只在 forceMask 时看）：show 译文一直明文，hide 画面和答题区 zh 都为 null（practiceMode.js zhHiddenAt；列表不隐藏），fog 照 forcedLayers
//     不传 = 假（精听等其他场景不受影响）
// 规则：
//   · 排序模式：
//     手上还没排对的这一题，原文、译文都打码（mask）——不藏起来，打码告诉用户「这里有字」；偷看着的那一层（peek）、新用户第一题的译文（firstZh）照常出。
//     「练习时遮住字幕和翻译」关着（maskOn === false）：手上这一题和别的句子一样照开关出，不打码（这一句选哪一句的规则不变）。
//     排对了两层都亮（不算提示）。
//     开关关着的那一层打码（mosaic），排对了也照样盖着，
//     盖过打码（点一下才恢复）。画面上是别的句子（不是手上这道题）照开关。
//     哪一句：这句此刻真在屏幕上（state.active，留白里不显示，暂停时照常）；暂停在两句之间（非循环、播进空档后停下，
//     面板上这道题还留着）给她正在做的那一句（答题区中文走同一个判断）。播放中的空档一律不给。
//   · 精听模式：这句此刻真在屏幕上才出；两行各管一层：显示照常、起雾打码（mosaic）、隐藏不出；
//     非英文轨中文开着时显示这条轨的原文，这时那层算原文；字幕列表照同一个规则（useStudySession 传 cc 时换算）。
export function overlayView({ mode = 'listen', state, listen = {}, sort = {}, noteOn = true, originalOnly = false, solvedIndex = -1, puzzleIndex = -1,
  peek = null, firstZh = false, maskOn = true, maskEn = maskOn, forceMask = false, remask = false, zhMode = 'fog' }) {
  const none = { index: -1, en: null, zh: null, note: false };
  const onScreen = state && state.active >= 0 && !state.waiting;
  if (mode === 'sort') {
    // state.paused 已经排除了留白；puzzleIndex === state.index：面板上还是这一句的题（清掉了就是「此刻无字幕」，不捡回来）
    let i = onScreen ? state.active : state?.paused && puzzleIndex >= 0 && puzzleIndex === state.index ? puzzleIndex : -1;
    if (i < 0) return none;
    const solved = i === solvedIndex;
    if (forceMask) {
      const ly = forcedLayers({ mine: i === puzzleIndex, solved, remask, peekZh: !!peek?.zh, firstZh, zhMode });
      // zhMode 'hide'：画面和答题区这一行都不出译文（zh 为 null；答题区拿到 null 走 zhLine 的 ghost / blank 隐形占位，高度不跳，
      // 不出遮盖块、答对也不亮、点不开偷看）；字幕列表照遮盖（listLayers，不走这里）。三处各是什么结果，只由 practiceMode.js zhHiddenAt 说了算
      return { index: i, en: ly.en, zh: zhHiddenAt(zhMode, 'screen') ? null : ly.zh, note: false };
    }
    // 手上还没排对的这一题。两层各有各的打码开关：maskOn 管译文层（「练习时遮住字幕和翻译」，关着时不算），
    // maskEn 管原文层（不传 = 跟 maskOn；桌面版练习时 useStudySession 传 true，把原文层钉成打码；maskOn 传 false，译文层只听控制区的母语那颗）
    const mine = i === puzzleIndex && !solved;
    const enOpen = solved || !mine || maskEn === false || !!peek?.en;
    const zhOpen = solved || !mine || maskOn === false || !!peek?.zh || !!firstZh;
    const layer = (on, open) => (!on ? 'mosaic' : open ? 'text' : 'mask');
    return {
      index: i,
      en: layer(!!sort.en, enOpen),
      zh: layer(!!sort.zh, zhOpen),
      note: !!noteOn && zhOpen,
    };
  }
  if (!onScreen) return none;
  // listen.en / listen.zh：控制区「原生字幕 / 翻译字幕」三态（ccMode.js；老布尔也收：true = 显示、false = 起雾）。隐藏 = 这一层 null、画面上不出
  const enM = ccModeFrom(listen.en);
  const zhM = ccModeFrom(listen.zh);
  return {
    index: state.active,
    en: ccLayer(originalOnly ? ccBest(enM, zhM) : enM),
    zh: originalOnly ? null : ccLayer(zhM),
    note: !!noteOn,
  };
}

// 画中画：小窗里不打码，CC 一颗开关管两行。
// 只改画哪几行、画成什么，哪一句照 overlayView 定（留白、暂停的规矩不变）。
// originalOnly：只有原文一行的轨没有译文那行；别的时候译文行照出——控制区把翻译字幕「隐藏」了（v.zh 是 null）小窗里也照出，和以前一样
export function pipView(v, on, originalOnly = false) {
  if (v.index < 0) return v;
  return on ? { ...v, en: 'text', zh: originalOnly ? null : 'text', note: true } : { ...v, en: null, zh: null, note: false };
}

// 打码按哪一句算「手上这一题」（overlayView / listLayers 的 puzzleIndex）：一般就是面板上这道题（puzzleIndex）。
// 正常播到下一句那一刻（两句之间没有空档），播放器先换了当前句、排序会话要等画完以后的 effect 才出新题——中间那一下面板上还是上一题，
// 新句子不算「手上的」，原文整句先进了 DOM 再换成打码。所以：排序模式、排序会话开着（enabled：这条轨能出题）、
// 这句真在屏幕上（state.active === state.index、不在留白里）、有词能出题（practicable）、面板上的题还不是它（puzzleId !== curId）
// ——就当它已经是手上这一题（还没排对），先打码
export function maskIndexOf({ mode, enabled, curId, puzzleId: pid, state, practicable, puzzleIndex }) {
  if (mode !== 'sort' || !enabled || !curId || pid === curId || !state || state.waiting) return puzzleIndex;
  const i = state.index;
  return i >= 0 && state.active === i && practicable?.[i] ? i : puzzleIndex;
}

// 字幕列表（精听；LineList）第 i 句的两层：{en, zh}，'text' | 'mask' | 'mosaic'。
// cc：{en, zh} 控制区「字幕打码」那两颗（和画面同一份开关，true = 显示）：关着的那层每一句都打码（mosaic），盖过下面别的规则
// （打码必须是在原有字幕的大小上打码）；不传 = 不管。
// 排序模式（以后列表出现在排序旁边时）手上还没排对的那一题打码、偷看着的那层照常，刚排对的那一句照常。
// maskOn：「练习时遮住字幕和翻译」（不传 = 开）；关着时手上那一题不打码
// forceMask / remask：overlayView 的同名参数：排序模式下每一句两层都走 forcedLayers（整个列表只有刚答对、还没重新盖上的那一行亮），
//   控制区那两颗（cc）不管——观影时点灭过也不能把答对的那一行盖住。精听模式不受影响
export function listLayers({ mode = 'listen', solvedIndex = -1, puzzleIndex = -1, peek = null, firstZh = false, maskOn = true, forceMask = false, remask = false, cc = null, zhMode = 'fog' } = {}) {
  const TEXT = { en: 'text', zh: 'text' };
  if (forceMask && mode === 'sort') {
    return (i) => forcedLayers({ mine: i === puzzleIndex, solved: i === solvedIndex && solvedIndex >= 0, remask, peekZh: !!peek?.zh, firstZh, zhMode });
  }
  const masking = mode === 'sort' && puzzleIndex >= 0 && maskOn !== false;
  const mosaicEn = !!cc && !cc.en;
  const mosaicZh = !!cc && !cc.zh;
  if (!masking && !mosaicEn && !mosaicZh) return () => TEXT;
  const both = (i) => {
    const solved = i === solvedIndex && solvedIndex >= 0;
    if (solved) return TEXT;
    // 手上那一题只在排序、开着「练习时遮住」时打码（masking）：精听里只关了一层（起雾 / 隐藏）时，另一层不能因为残留的题号被盖
    const mine = masking && i === puzzleIndex;
    return {
      en: mine && !peek?.en ? 'mask' : 'text',
      zh: mine && !peek?.zh && !firstZh ? 'mask' : 'text',
    };
  };
  if (!mosaicEn && !mosaicZh) return both;
  return (i) => {
    const ly = both(i);
    return { en: mosaicEn ? 'mosaic' : ly.en, zh: mosaicZh ? 'mosaic' : ly.zh };
  };
}

// 答题区里那行译文。返回 null = 整行不出（开关关着）；{kind, text}：
//   kind 'text' 照常（text 是译文，或者「正在获取…」「暂时无法取得…」）；'mask' 打码（text 是译文，排在雾底下）；
//   'ghost' 这一刻不该给这一句的译文（字幕已经不在画面上：句间空档、提前量）：text 是这句译文，照样排、看不见（不出字、不打码），
//   答题区还是这句译文那么高，到下一句换题才变；
//   'blank' 同样不该给、可是手上没有这句译文（还没到、取不到、没有题）：占一个看不见的字（不断行空格）撑住一行高。
//   'mosaic' 字幕打码（text 是译文，原字照样排、糊成雾：和不打码时一样宽、一样几行，开关的时候答题区不跳）；
//   layer 本身是 'mosaic'（答对后点了「继续播放」，practiceMode.js forcedLayers 的 remask）也出 'mosaic'。
//   show：有没有译文这一行（母语就是在学的语言时没有）；layer：这句这一刻译文那一层（overlayView 的 zh 同一个判断：'text' | 'mask'，别的 = 这一刻不给）；
//   zh：整句翻译缓存里的干净译文（注释不在里面）；pending：还在翻。
//   on：「翻译」开着（控制区「字幕打码」母语那颗没点亮）；关着：这一刻该给这一句（layer 是 text / mask）就出 'mosaic'，原字照样排、糊成雾
//   打码的时候译文还没到：照实说「正在获取…」/「暂时无法取得…」（这两句不是答案，不用打码）
export function zhLine({ show, on = true, layer, zh, pending }) {
  if (!show) return null;
  const has = zh != null && zh !== '';
  if (!on && (layer === 'text' || layer === 'mask')) {
    if (has) return { kind: 'mosaic', text: zh };
  } else if (layer === 'mask' || layer === 'mosaic') {
    if (has) return { kind: layer, text: zh };
  } else if (layer !== 'text') return has ? { kind: 'ghost', text: zh } : { kind: 'blank', text: '\u00a0' };   // 不断行空格：普通空格在 div 里会被吃掉，撑不住行高
  if (has) return { kind: 'text', text: zh };
  // pending：译文还在路上，答题区画成和画面字幕一样的「声波竖条 + 正在获取…」（TrPending）
  return pending ? { kind: 'text', text: t('trFetching'), pending: true } : { kind: 'text', text: t('sortZhFailed') };
}

// ---- 文案 ----

// 答题区的提示行（按顺序第一条成立就用它）。
//   hasLines：这条字幕有没有能练的句子；puzzle：面板上这道题（null = 没有）；lineHasWords：当前句剥完还有没有词；
//   loopMode：循环模式开着
export function noteText({ hasLines, puzzle, hasLine, lineHasWords, loopMode }) {
  if (!hasLines) return t('sortNoteNoLines');
  if (!puzzle) return hasLine && lineHasWords === false ? t('sortNoteNoWords') : t('sortNoteGap');
  if (puzzle.solved) return loopMode ? t('sortNoteSolvedLoop') : t('sortNoteSolved');
  return t('sortNoteDefault');
}

// 点开打码：点不点得开、悬停 / 读屏说什么。
//   kind 'en' 原文 / 'zh' 译文；hint = session 快照的 {state, leftSec}（和「提示」按钮同一个闸门：词块 / 答案框真摆在她眼前 10 秒以后，core/hintGate.js）；
//   why：practiceVisible 给的不计时原因（'pip'）。
// 回 {avail, look, title}：look 'ready' 能点 / 'wait' 还不能点（冷却里、词块没摆出来、提示那 2 秒里）。
// 不能点的时候点了照样说一声为什么（触屏没有悬停，同「提示」按钮）
// dictate：听写变体（useStudySession 在听写时传 true）：闸门和排序同一套 10 秒读秒，没开时一样说 maskWait；
// 开了，原文那条说 dictPeekEnTitle（点开 = 看原文 2 秒，视同看了答案），译文那条照旧 maskPeekZh
export function maskInfo(kind, hint, { why = null, dictate = false } = {}) {
  const st = hint?.state || 'none';
  if (st === 'ready') return { avail: true, look: 'ready', title: t(kind === 'en' ? (dictate ? 'dictPeekEnTitle' : 'maskPeekEn') : 'maskPeekZh') };
  if (st === 'waiting') return { avail: false, look: 'wait', title: t('maskWait', { n: hint.leftSec }) };
  if (st === 'showing') return { avail: false, look: 'wait', title: t('sortHinting') };
  if (st === 'hidden' && (why === 'pip' || why === 'loop' || why === 'tr')) return { avail: false, look: 'wait', title: hiddenWhyText(why) };
  return { avail: false, look: 'wait', title: t('maskHidden') };
}

// 词块区空着时。
// 排对了不写：下面提示行已经说「排列正确。」，词块区再写一遍就重了
export const bankPlaceholder = (puzzle) => (puzzle?.solved ? '' : t('sortBankUsed'));

// 答题区句子模板里的固定文字（词与词之间的标点、空格）去掉特殊符号：
// 去掉 ♪♫ 这类音符、表情、©®™°、• 和 # * _ ~ ^ ` | \ < > { } [ ]（Unicode 的「其他符号」So、「修饰符号」Sk、私用区 Co 全算）；
// 句号逗号问号叹号、引号撇号、连字符破折号、省略号、冒号分号、括号、% $ & / + = 照常。只改显示：题目、计分、句子解析里的原句都不动。
// 去掉以后多出来的空格不用管：.sort-template 是 white-space: normal，连着的空格并成一个、行首的不显示
const SPECIAL_RE = /[\p{So}\p{Sk}\p{Co}•#*_~^`|\\<>{}[\]]/gu;
export const literalText = (text) => String(text ?? '').replace(SPECIAL_RE, '');

// 「提示」按钮（renderHintButton）。hint = session 快照的 {state, leftSec}。
// 只有 ready 能点；倒计时那 10 秒字要看得清（waiting）；词块还没摆在她眼前时不写倒计时
// （一个不走字的「还有 10 秒」看着就是坏了）。why：practiceVisible 给的不计时原因（'pip' = 画中画开着）
export function hintButton(hint, { why = null } = {}) {
  const st = hint?.state || 'none';
  if (st === 'waiting') {
    return { text: t('sortHintWait', { n: hint.leftSec }), title: t('sortHintWaitTitle'), disabled: true, waiting: true };
  }
  const title = st === 'solved' ? t('sortHintSolved') : st === 'hidden' ? hiddenWhyText(why) : t('sortHintTitle');
  return { text: t('sortHint'), title, disabled: st !== 'ready', waiting: false };
}

// 排序开关灰掉时说为什么：「无字幕」和「未获取到字幕」分开写，
// 不能把「不知道」说成「没有」。按顺序第一条成立就用它：
//   loading    还在读字幕；failed 读字幕出错、一句都没读出来（有没有英文字幕不知道）；
//   otherTrack 片子里有英文字幕轨，只是现在选的是别的语言的轨（非英文轨只显示、不翻译、不能排）
// noLearn：缺学习语言的声音或字幕（core/noLearn.js noLearnGap），这部片不练：说缺了哪样
export function sortOffWhy({ loading = false, failed = false, otherTrack = false, noLearn = null } = {}) {
  if (noLearn) return noLearnText(noLearn);
  if (loading) return t('sortSubsLoading');
  if (failed) return t('sortSubsFailed');
  if (otherTrack) return t('sortPickEnglish');
  return t('sortNoSubs');
}

// 「第 N / M 句」：M = 能练的句数，N = 当前句在能练的句子里排第几；
// 没有当前句、当前句不能练时写「—」，绝不写「第 0 句」；一句能练的都没有就整个不写（返回 ''）。
//   eligible：每句能不能算进来（排序模式 = 剥完有词；精听模式全算）
export function cuePosition(eligible, index) {
  let m = 0;
  let n = 0;
  for (let k = 0; k < eligible.length; k++) {
    if (!eligible[k]) continue;
    m++;
    if (k === index) n = m;
  }
  if (!m) return '';
  return n ? t('cuePos', { n, m }) : t('cuePosNone', { m });
}

// 题目是第几句（题目 id = 字幕指纹:句号；排序、听写同一个格式）
export const puzzleIndexOf = (puzzle) => (puzzle?.id ? Number(puzzle.id.slice(puzzle.id.lastIndexOf(':') + 1)) : -1);

