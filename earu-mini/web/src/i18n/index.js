import zhCN from './zh-CN.js';
import zhTW from './zh-TW.js';
import en from './en.js';
import { renderLang, registerPackLoader } from './lang.js';
import { LANG_NATIVE, RTL_LANGS, LANGS, learnOf } from '../../../shared/langs.js';
import { translationTarget } from '../core/ai/index.js';

// 跟读、每日小测的文案各在自己的文件里（第二阶段第二轮分线施工，几条线不用同时改 zh-CN.js）。
// 键名各用 speak / vocab 开头，不许和 zh-CN.js 重名（重名时后面的盖前面的，查起来费劲）
const BASE = { ...zhCN };

// 界面语言：简体是底本（上面三个文件合起来）；别的语言各一个文件（zh-TW.js、en.js、de.js……），键和底本一一对应。
// 某个键在当前语言里没有就退回简体（保底；每份语言包都应齐全，平时走不到）。
// 简体、繁體、English 跟着主包；另外 9 种每份 50 KB 上下，按需加载（用到哪种拉哪种，main.jsx 画之前、
// 设置里换语言时，lang.js setUiLang 先等它拉下来），播放器的包不跟着变大
const PACKS = { 'zh-CN': BASE, 'zh-TW': zhTW, en };
const LAZY = {
  de: () => import('./de.js'), fr: () => import('./fr.js'), ja: () => import('./ja.js'), ko: () => import('./ko.js'), tr: () => import('./tr.js'),
  ru: () => import('./ru.js'), es: () => import('./es.js'), pt: () => import('./pt.js'), ar: () => import('./ar.js'), hi: () => import('./hi.js'),
  vi: () => import('./vi.js'),
};
export async function loadUiPack(lang) {
  if (!PACKS[lang] && LAZY[lang]) PACKS[lang] = (await LAZY[lang]()).default;
  return PACKS[lang] || null;
}
registerPackLoader((lang) => (PACKS[lang] ? null : loadUiPack(lang)));

// 首页这一组（首页、使用说明、关于耳如）专用的键：不跟播放器的界面语言走，跟网站这一页的语言走（
// 12 种语言各一个目录，文案在 i18n/site/<目录>.js；简体就是这里的底本）。zh-TW.js、en.js 里不放。放到桌面（InstallButton，只在首页上）的说明也算这一组
export const SITE_ONLY_KEY = /^(home|guide|about|pricing|install|menuInstall)(?![a-z])/;
// 网站页上用到的、不是这一组的键：产品名（中文网站写「耳如」，日文和别的写 Earu）、两份政策的链接名。各语言的网站文案里也有
const SITE_SHARED = new Set(['appName', 'termsLink', 'privacyLink']);

// 网站这一页的语言（App、预渲染画这几页时设，setSiteLang）：{loc: 目录名, pack: 那种语言的网站文案}；简体的 pack 是 null（用底本）。
// 别的时候（播放器）是 null
let site = null;
export function setSiteLang(loc, pack = null) { site = loc ? { loc, pack } : null; }

// t('cues', { n: 3 }) → '整句 3'
// {appName}：产品名，自动换成当前语言的 appName（英文名还没定，英文那份写 {appName}，以后改名只改 en.js 的 appName 一处）
// ---- 她的母语：字幕译成这种语言。App 每次画的时候设（setNative，shared/langs.js nativeOf 算好的） ----
// 界面上说译文的那几句（「正在获取中文翻译…」「中英」「中文字幕」……）写成 {tr}（语言名）、{Tr}（首字母大写，单独当按钮名用）、
// {trShort}（简繁界面的单字简称：中、日、韩……，「中英」这种两字按钮用），t() 按她的母语、照这一刻的界面语言填。
// 母语是中文时显示得和以前一字不差（简体、繁體都叫「中文」）。还没读到设置时按简体
let nativeCur = 'zh-CN';
let nativeOn = false;
export function setNative(code) { nativeCur = code || 'zh-CN'; nativeOn = !!code; }
// 有没有译文：学英语、母语也是英语时没有（显示方式、字幕开关、答题区「翻译」这些按钮不出）。
// 学中文时一律有（学中文第一期设计 D2、D14：母语是中文的人学中文，译文用英语——setNative 那时按译文的语种设，可能正好是 en）。
// 12 种学习线：统一问 shared trLangFor（译成哪种，null = 不翻）——学德语、母语英语也有译文，母语＝在学的语言时给英语译文
// 本机版：开发者没填 AI 接口（core/ai）就没有译文；填了，母语和在学的语言不是同一门才有
export const hasTranslation = () => nativeOn && translationTarget(nativeCur, learnCur) != null;

// ---- 她在学的语言（学中文第一期 B6，设计 D1、D14、§3.2）：App 每次画的时候设（setLearn，B10 接线；之前一律英语，下面这些都走不到） ----
// learn：12 条学习线之一（en zh de fr ja ko tr ru es pt ar；shared/langs.js learnOf 算好的）；tag：学习内容的语言标记，中文是 'zh-CN' | 'zh-TW'（选中那条轨的实际简繁，App 按 t.zh.script 定），其余线就是 learn 本身。
// 学中文时 t() 把写死「英文」的 15 个键换成带 {learn} 的新键（LEARN_ALT；外加一个说「难度」的 accountSettingsSub）；【学英语时一个键都不经过这张表】，每个键的原文一字不差
// （scripts/i18n-test.mjs 逐份逐键比、en-golden 的文案基线钉着）。
// {learn}（语言名）、{Learn}（首字母大写，单独当按钮名用）、{learnShort}（简繁界面的单字简称：中）照 {tr} 那一套，t() 按这一刻的界面语言自动填。
// 有词形变化的语言（德、俄、阿……）不硬套名字：各语言包按语法挑用哪个，或者写「你在学的语言」（同 {tr}）
// 12 种学习线：learn 是 shared learnOf 的结果（en zh de fr ja ko tr ru es pt ar）；除中文外 tag 就是 learn 本身
let learnCur = 'en';
let learnTag = 'en';
const LEARN_CODES = new Set(LANGS.map(learnOf));
export function setLearn(learn, tag) {
  learnCur = LEARN_CODES.has(learn) ? learn : 'en';
  learnTag = learnCur === 'zh' ? (tag === 'zh-TW' ? 'zh-TW' : 'zh-CN') : learnCur;
}
export const learnNow = () => learnCur;
// 学中文时换成的键（原键 → 新键，设计 §四 B6 的表）。新键 12 份语言包都有，都带 learn 占位（简体、English 那两份 i18n-test 钉着）
export const LEARN_ALT = Object.freeze({
  notLearnLangTrack: 'notLearnLangTrackL',
  subEn: 'subLearn',
  sortNoSubs: 'sortNoSubsL',
  sortPickEnglish: 'sortPickLearn',
  sortNoteNoLines: 'sortNoteNoLinesL', sortNoteNoWords: 'sortNoteNoWordsL',
});
// 学习内容（画面和列表里的原文、排序词块）的属性：学英语时就是 enAttrs()（只在从右往左的界面里给，别的界面 null——DOM 一个字节不差）；
// 学中文时一律给 lang（zh-CN / zh-TW：日文界面里不标会画成日文字形，繁體轨在简体界面里也要按繁體的字形画），从右往左的界面再加 dir:'ltr'。
// 给出去的是冻结的同一个对象（memo 的组件比得上）
const LEARN_ATTRS = new Map();
export function learnAttrs(tag = learnTag) {
  if (learnCur === 'en') return enAttrs();
  const lang = learnCur === 'zh' && (tag === 'zh-TW' || tag === 'zh-CN') ? tag : learnTag;
  const rtl = isRtlUi();
  const k = `${lang}|${rtl}`;
  // 学阿拉伯语：学习内容本身从右往左，任何界面里都标 dir:'rtl'（别的线只在从右往左的界面里标 ltr）
  if (!LEARN_ATTRS.has(k)) LEARN_ATTRS.set(k, Object.freeze(RTL_LANGS.includes(lang) ? { lang, dir: 'rtl' } : rtl ? { lang, dir: 'ltr' } : { lang }));
  return LEARN_ATTRS.get(k);
}
// 任意一段「内容语言」（词卡的释义、跟读识别出来的字、小测的例句……）的属性：这门语言从右往左就标 dir:'rtl'（任何界面里都标）；
// 其余只在从右往左的界面里标 dir:'ltr'（不让它跟着界面倒过来），从左往右的界面里只给 lang。冻结的同一个对象。
const CONTENT_ATTRS = new Map();
// 显示母语释义的那几处（每日小测「选意思」的选项、判定卡、小结、生词本列表）标的语言：lang 是她的母语，阿拉伯语从右往左。
// 界面从右往左（阿拉伯语界面）、母语却是从左往右写的：标 ltr，不跟着界面倒过来（从左往右的界面里照旧不标）
export const nativeAttrs = () => ({ lang: nativeCur, dir: RTL_LANGS.includes(nativeCur) ? 'rtl' : isRtlUi() ? 'ltr' : undefined });
// 母语从右往左、界面却不是：这时译文那一行要单独标方向（界面语言＝母语时用不到，只在这种组合下才给属性）
export const nativeNeedsAttrs = () => RTL_LANGS.includes(nativeCur) && !isRtlUi();

// ---- 界面方向：界面语言是阿拉伯语时播放器整个界面从右往左 ----
// 镜像以后照旧从左往右的几块，属性在画的时候按这一刻的语言给。【只在从右往左的界面里给】，别的 11 种界面语言什么都不加——
// 画出来的 DOM 和以前一个字节不差（lang="en" 会让 system-ui 这类字体换一种，不能顺手给中文界面也加）：
//   ltrAttrs()：视频控制条、进度条 / 时间轴、播放控制（‹ 循环 播放 ›）、音标、手机号框这类（谷歌设计规范：媒体控制和时间轴不镜像）
//   enAttrs()：英文学习内容（画面和列表里的英文字幕、排序词块、句子解析的原句和词块、例句）：从左往右，顺手标 lang="en"
//   uiDirAttrs()：套在从左往右那一块里、本身又是界面文字的（控制条上「画面字幕」那个小菜单）：回到界面的方向
//   ltrText(s)：夹在一句界面文字里的打码手机号、播放时间：前后包 Unicode 的「从左往右隔离」（U+2066 … U+2069），
//     不然阿拉伯语句子里 +1 202****0142 会被双向算法拆开、数字跑到加号前面
export const isRtlUi = () => RTL_LANGS.includes(renderLang());
const LTR_ATTRS = Object.freeze({ dir: 'ltr' });
const EN_ATTRS = Object.freeze({ dir: 'ltr', lang: 'en' });
const RTL_ATTRS = Object.freeze({ dir: 'rtl' });
export const ltrAttrs = () => (isRtlUi() ? LTR_ATTRS : null);
export const enAttrs = () => (isRtlUi() ? EN_ATTRS : null);
export const uiDirAttrs = () => (isRtlUi() ? RTL_ATTRS : null);
export const ltrText = (s) => (isRtlUi() && s ? `⁦${s}⁩` : s);
const SHORT_ZH = { zh: '中', en: '英', ja: '日', ko: '韩', de: '德', fr: '法', es: '西', pt: '葡', ru: '俄', tr: '土', ar: '阿', hi: '印' };
const trNameCache = new Map();
function trNames(ui) {
  const ck = `${ui}|${nativeCur}`;
  if (trNameCache.has(ck)) return trNameCache.get(ck);
  const code = /^zh-/.test(nativeCur) ? 'zh' : nativeCur;
  let n = null;
  try { n = new Intl.DisplayNames([ui], { type: 'language' }).of(code); } catch { n = null; }
  if (!n || n === code) n = LANG_NATIVE[nativeCur] || code;
  const Tr = n.charAt(0).toLocaleUpperCase(ui) + n.slice(1);
  const short = /^zh-/.test(ui) ? (ui === 'zh-TW' && code === 'ko' ? '韓' : SHORT_ZH[code]) || n : Tr;
  const r = { tr: n, Tr, trShort: short };
  trNameCache.set(ck, r);
  return r;
}
// {learn} {Learn} {learnShort}：她在学的语言，写法同 trNames（简繁界面里学中文就是「中文」「中」）。
// 俄语界面的 {learnShort}：字幕列表「Оба｜Англ.｜Перев.」那组按钮本来就是缩写，换成整词「Китайский」手机上放不下（截掉一截），给缩写；
// 别的界面（以及俄语界面里没写缩写的语言）同 {Learn}
const SHORT_UI = { ru: { zh: 'Кит.' } };
const learnNameCache = new Map();
function learnNames(ui) {
  const ck = `${ui}|${learnCur}|${learnTag}`;
  if (learnNameCache.has(ck)) return learnNameCache.get(ck);
  let n = null;
  try { n = new Intl.DisplayNames([ui], { type: 'language' }).of(learnCur); } catch { n = null; }
  if (!n || n === learnCur) n = LANG_NATIVE[learnTag] || learnCur;
  const Learn = n.charAt(0).toLocaleUpperCase(ui) + n.slice(1);
  const short = /^zh-/.test(ui) ? SHORT_ZH[learnCur] || n : SHORT_UI[ui]?.[learnCur] || Learn;
  const r = { learn: n, Learn, learnShort: short };
  learnNameCache.set(ck, r);
  return r;
}

export function t(key, params) {
  // 学中文时换键（LEARN_ALT）；学英语时这一行什么都不做
  if (learnCur !== 'en' && Object.hasOwn(LEARN_ALT, key)) key = LEARN_ALT[key];
  // 网站页上的这一组键按这一页的语言取（setSiteLang）；别的键照界面语言（网站页上 App 把它设成和这一页最近的那种，lang.js setPageLang）
  // 那种语言的文案还没拉下来（按需加载的 9 种，正在拉）：先用 English，不出简体
  const pack = (site?.pack && (SITE_ONLY_KEY.test(key) || SITE_SHARED.has(key)) && site.pack) || PACKS[renderLang()] || PACKS.en;
  let s = pack[key] ?? BASE[key] ?? key;
  if (s.includes('{appName}') && !(params && 'appName' in params)) s = s.split('{appName}').join(pack.appName ?? BASE.appName);
  if (/\{(tr|Tr|trShort)\}/.test(s)) params = { ...trNames(renderLang()), ...(params || {}) };
  if (/\{(learn|Learn|learnShort)\}/.test(s)) params = { ...learnNames(renderLang()), ...(params || {}) };
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m)) : s;
}
