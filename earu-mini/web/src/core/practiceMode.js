// 「这会儿练习界面长什么样」的唯一出处（开关、权限这类判断收在一处，组件只问结果）。
// 两层判断：语言层在 shared/langs.js（canDictate：能不能做听写），这里是界面层——叠上「在不在练习」「宿主开不开听写」「选了哪种题型」。
// TaskBar、FloatControl、MobileDeck、ControlBar 字幕菜单、DictPanel 只读 resolvePractice 的结果，不再自己判语言、宿主、模式。
//
// 入参：
//   mode      useStudySession 里已有的 mode：'listen' | 'sort'（内部只有这两个值，题型是另一个维度，不是第三种 mode）
//   learn     学习语言
//   watchOnly 只看不练（isWatchOnly(learn)）
//   kindPref  设置里的题型偏好 'sort' | 'dictate'（settings.values.sort.kind；缺失、不认识的都当 'sort'）
//   dictHost  这个宿主开不开听写：由宿主传入；为 false 时不出听写
// 返回：
//   dictOk       这个人在这个宿主能不能听写
//   kind         偏好折算后的题型；点了马上生效，useStudySession 直接用（换题型不用等到下一句）
//   practicing   在练习（= mode === 'sort'）
//   forceMask    练习时原文、母语两层都强制打码、不可更改（母语那层可在控制区切 显示 / 隐藏 / 遮盖，见 forcedLayers 的 zhMode；原文锁死）：
//                控制区「字幕打码」两颗照出、点亮、变灰、点不动（点了 toast 说原因），
//                每一句两层都走 forcedLayers——只有答对的那一句亮，点「继续播放」或离开这一句才又打上。只在 dictHost 为真时才有：
//                dictHost 为假时两层照旧读用户自己的打码开关
//   playModeLocked 播放方式菜单里只许选「单句循环」：练习（forceMask）答题要循环开着（answerGate），
//                控制区菜单另两项（连续播放、每句停）灰着，Q 键不理；dictHost 为假时不强制打码，这个菜单也不画，所以一样是 false
//   showKindSeg  才出「排序｜听写」分段
//   listOk       字幕列表（左边抽屉、控制区「字幕列表」那颗、l 键）给不给：不练习时都给；练习时只有 dictHost 为真时给——原文强制打码（forceMask），
//                列表里只有答对那句亮、手上这题和其余都糊着雾，摆出来不再等于给答案；
//                dictHost 为假时原文不强制打码，照旧不给
// dictHost 为 false时 dictOk、showKindSeg、forceMask、playModeLocked 全是 false，kind 恒为 'sort'，listOk 只在不练习时为真。
import { canDictate } from '../../../shared/langs.js';

export function resolvePractice({ mode, learn, watchOnly, kindPref, dictHost } = {}) {
  const dictOk = !watchOnly && !!dictHost && canDictate(learn);
  const practicing = mode === 'sort';
  return {
    dictOk,
    kind: dictOk && kindPref === 'dictate' ? 'dictate' : 'sort',
    practicing,
    forceMask: practicing && !!dictHost,
    playModeLocked: practicing && !!dictHost,
    showKindSeg: practicing && dictOk,
    listOk: !practicing || !!dictHost,
  };
}

// 练习时（forceMask 为真）第 i 句原文、母语两层怎么出：{en, zh}，'text' | 'mask' | 'mosaic'。
// overlayView（画面、答题区那行母语）、listLayers（字幕列表）都用它，不再看任何开关（控制区那两颗、设置里的「练习时遮住…」都不管）：
//   答对了（solved：排对 / 听写全对 / 听写看了答案），还没重新盖上（remask 为假）→ 两层都亮；
//     只要还在这一句上就一直亮：循环转回句首、暂停再播、重播、关掉循环都不盖，
//     不能把循环转回句首当成重新开始播放，否则刚答对就又盖上了；
//   答对以后点了「继续播放」（remask，useStudySession 记）→ 两层都 mosaic；离开这一句（播到 / 跳到别句）solved 自然就没了，回到这句是新题，照常打码；
//   手上这一题还没答对（mine）→ 原文 'mask'（真字 + 雾，能点；点开 = 「提示一下」，答案出在答题区，这里照旧打码——
//     只显示答案，不解除打码）；母语点开过（peekZh）或新手「先亮后收」先亮着（firstZh）→ 'text'，否则 'mask'；
//   其余每一句（别的句子、没有词不出题的句子、换句那一刻）→ 两层 'mosaic'：字照样排（宽度行数不变）盖上雾，选不中、读屏跳过（.sub-mosaic）。
// mine：这一句就是手上这道题（puzzleIndex 命中）；solved：这一句是答对的那题（solvedIndex 命中）
//   zhMode（翻译字幕那一行的三态；原文不受影响，三态下都照上面的规矩）：
//     'fog'（默认、不传）= 上面说的全部；'show' = 译文层任何时候都是 'text'（本来就亮着，看它不算提示、不用偷看，答对后「继续播放」也不盖回）；
//     'hide' = 画面和答题区都不出译文（zhHiddenAt 说了算，overlayView 照它出 null），字幕列表里的译文照 'fog' 算（遮盖）。所以这里 'hide' 和 'fog' 一样。
export function forcedLayers({ mine = false, solved = false, remask = false, peekZh = false, firstZh = false, zhMode = 'fog' } = {}) {
  const ly = solved ? (remask ? MOSAIC : TEXT) : mine ? { en: 'mask', zh: peekZh || firstZh ? 'text' : 'mask' } : MOSAIC;
  return zhMode === 'show' && ly.zh !== 'text' ? { en: ly.en, zh: 'text' } : ly;
}
// 练习时翻译字幕「隐藏」在三处各是什么结果的唯一出处：
//   where 'screen'（画面字幕）、'panel'（答题区那一行：排序面板、听写面板底部）→ 不出译文：内容不出、也不出遮盖块，
//     调用方拿 null 走 zhLine 的隐形占位（高度不跳）；因为那一层是 null，答对也不亮、点译文偷看的入口也没有（不计提示）；
//   where 'list'（字幕列表）→ 不隐藏，照 forcedLayers 遮盖（和观影时翻译字幕「隐藏」对列表的规矩一致）。
// 组件、overlayView 只问这个函数，不再自己写 zhMode === 'hide'。
export const zhHiddenAt = (zhMode, where) => zhMode === 'hide' && (where === 'screen' || where === 'panel');
const TEXT = Object.freeze({ en: 'text', zh: 'text' });
const MOSAIC = Object.freeze({ en: 'mosaic', zh: 'mosaic' });

// 答题区摆不摆出来、能不能动手答（SortPanel、DictPanel、display.js practiceVisible 只问它）：{shown, open}
//   shown 摆不摆出词块区 / 答案框；open 能不能答——摆词、拖词、打字、「提示」、「重新打乱 / 清空重写」、点开打码的原文母语都算答题。
//   forceMask 为真：答题区一直摆着、跟着播放器换句，循环开着才能答——只看循环，暂停不算（循环开着只是暂停照常答，循环关着暂停也答不了）
//     ；排到一半关了循环，已排的留着、动不了，再开循环接着排。
//   dictHost 为假：循环开着或暂停着才摆出来，摆出来就能答
//   why：答不了的原因（能答时是 null）：'loop' 循环关着；'tr' 这句还不能循环——字幕还没整理分句、这句译文还没到
//     （player.canLoop(index) 为假；分段翻译，到一句能循环一句），循环开不了，提示说「这句还在整理翻译」、不叫用户去点灰着的循环钮；
//     译文到了，之前想开循环的播放器自己开上（armWanted），没想开的原因变回 'loop'。不传 player（老调用）当作能循环
export function answerGate({ forceMask = false, state, player = null, index = -1 } = {}) {
  const loop = !!state?.loopMode;
  if (forceMask) {
    if (loop) return { shown: true, open: true, why: null };
    const tr = index >= 0 && typeof player?.canLoop === 'function' && !player.canLoop(index);
    return { shown: true, open: false, why: tr ? 'tr' : 'loop' };
  }
  const shown = loop || !!state?.paused;
  return { shown, open: shown, why: null };
}

