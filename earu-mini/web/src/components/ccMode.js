// 控制区「原生字幕 / 翻译字幕」三态：显示 show / 隐藏 hide / 起雾 fog。三态的判断都收在这里，组件只问结果。
//   · 原生字幕 = 在学的语言（以前的「原文」），翻译字幕 = 母语（以前的「母语」）。
//   · 隐藏只管画面上那一行：字幕列表、答题区里被隐藏的那种照起雾处理（列表不会空、答题区不跳）——这两处只读下面说的老布尔，自然就是这样。
//   · 存本机偏好（usePlayerPrefs，键 earu.playerPrefs.v1）两份：新键存三态（ccSrc 原生 / 学中文时 ccSrcZh / 翻译 ccTr），
//     老布尔（subEn / subSrcZh / subZh，true = 照常出、false = 打码）同时跟着写：显示 = true，隐藏、起雾 = false。
//     只认布尔的老地方（底下控制条的字幕菜单）照旧能用：在那里隐藏就当起雾；它们改了布尔（setCcOn），新键清掉，三态退回按布尔算。
//   · 没存过新键（老数据、新数据）：按布尔算——以前点亮打码的是起雾、没点亮的是显示；新数据布尔的默认值就是原生起雾、翻译显示。
//     【新键不进 DEFAULTS】（loadPrefs({}) 要和以前一样）
//   · 练习时（practiceMode.js forceMask）「原生字幕」一行锁在遮盖（带锁），「翻译字幕」一行放开三态，
//     练习时翻译字幕的选择单独记一份（ccTrPrac，pracTrModeOf / setPracTrMode），不和观影时的 ccTr 共用，
//     没存过 = 遮盖（fog，与旧行为一致）。【新键同样不进 DEFAULTS】。三态怎么落到画面、答题区、列表在 practiceMode.js forcedLayers。
export const CC_MODES = ['show', 'hide', 'fog'];
const KEYS = { src: ['ccSrc', 'subEn'], srcZh: ['ccSrcZh', 'subSrcZh'], tr: ['ccTr', 'subZh'] };
const valid = (m) => CC_MODES.includes(m);

// 原生字幕存在哪一份：学中文另起一份（学中文第一期 B8 的 subSrcZh），切回学英语时英文那份不动
export const srcWhich = (learnZh) => (learnZh ? 'srcZh' : 'src');

// 本机偏好里这一行现在是哪一态。which：'src' | 'srcZh' | 'tr'
export function ccModeOf(p, which) {
  const [m, b] = KEYS[which];
  if (valid(p?.[m])) return p[m];
  const on = which === 'tr' ? p?.[b] !== false : p?.[b] === true;
  return on ? 'show' : 'fog';
}

// 控制区点了三格里的一格
export function setCcMode(setPref, which, mode) {
  if (!valid(mode)) return;
  const [m, b] = KEYS[which];
  setPref(m, mode);
  setPref(b, mode === 'show');
}

// 练习时（forceMask）翻译字幕那一行的三态：单独一份偏好 ccTrPrac，没存过、存坏了都是 'fog'（遮盖）
export const PRAC_TR_KEY = 'ccTrPrac';
export const pracTrModeOf = (p) => (valid(p?.[PRAC_TR_KEY]) ? p[PRAC_TR_KEY] : 'fog');
export function setPracTrMode(setPref, mode) {
  if (valid(mode)) setPref(PRAC_TR_KEY, mode);
}

// 只有开 / 关的老地方（控制条字幕菜单）：写布尔、清掉三态
export function setCcOn(setPref, which, on) {
  const [m, b] = KEYS[which];
  setPref(m, undefined);
  setPref(b, !!on);
}

// 三态或老布尔都收（true = 显示、false / 没给 = 起雾）
export const ccModeFrom = (v) => (valid(v) ? v : v ? 'show' : 'fog');

// 画面上这一层画成什么：显示 'text'、起雾 'mosaic'、隐藏 null（不出）
export const ccLayer = (mode) => (mode === 'show' ? 'text' : mode === 'hide' ? null : 'mosaic');

// 只有原文一行（originalOnly：手动选了不翻译的轨）时两行合成一行：取看得最清楚的那个（显示 > 起雾 > 隐藏）
export const ccBest = (a, b) => (a === 'show' || b === 'show' ? 'show' : a === 'fog' || b === 'fog' ? 'fog' : 'hide');
