// 界面语言：界面文字有多种语言可选；字幕、中文翻译、句子解析、词卡里的中文释义
// 照旧是简体，不跟着换。这里只管「现在用哪种」：判浏览器语言、本机记的谁说了算，换了通知界面重画。
// 纯 JS、不碰 React（core 里的文件和 Node 里跑的测试都 import 它）；React 那一头的订阅在 useUiLang.js。
//
// 谁说了算：
//   本机记的（localStorage earu.uiLang）→ 再没有就按浏览器语言（browserLang）。
//
// 没调 initUiLang 之前一律简体：Node 里的测试（navigator.language 可能是 en-US）、打包时预渲染首页都照旧出简体。

import { LANGS, LANG_NATIVE, RTL_LANGS } from '../../../shared/langs.js';

// 12 种界面语言：简体、繁體、English 以外的 9 种是翻译出来的。
// 次序见 shared/langs.js
export const UI_LANGS = LANGS;
// 设置里下拉框上的字：语言名用它自己的文字写，不翻译（看不懂当前界面的人也认得出自己的语言）
export const UI_LANG_NAMES = LANG_NATIVE;
export const UI_LANG_KEY = 'earu.uiLang';
// 本机刚选、还没存进外部设置的那一次（存失败）：{lang, owner}。有它的时候外部的旧值不许把刚选的盖回去，
// 下次读到外部设置时再存一次。owner 是使用者标识：几个人轮流用一台电脑，别把一个人选的存给另一个人
const UNSYNCED_KEY = 'earu.uiLang.unsynced';

export const normLang = (x) => (UI_LANGS.includes(x) ? x : null);

// 一个浏览器语言标记 → 界面语言；认不出（不是那 12 种）回 null。
// zh-TW / zh-HK / zh-MO / zh-Hant 开头的 → 繁體；别的 zh（zh、zh-CN、zh-SG、zh-Hans-HK……）→ 简体；别的看前面那段（pt-BR → pt、ja-JP → ja）
export function langFromTag(tag) {
  const s = String(tag ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (s === 'zh' || s.startsWith('zh-')) return /^zh-(tw|hk|mo|hant)(-|$)/.test(s) ? 'zh-TW' : 'zh-CN';
  const base = s.split('-')[0];
  return base && UI_LANGS.includes(base) ? base : null;
}

// 浏览器的语言列表（navigator.languages，按喜好排）里第一个认得出的；一个都认不出（荷兰语、泰语……）→ English。
// 认得越南语（vi、vi-VN → vi）
export function browserLang(languages) {
  for (const tag of Array.isArray(languages) ? languages : []) {
    const l = langFromTag(tag);
    if (l) return l;
  }
  return 'en';
}

// 定用哪种：外部设置的 > 本机记的 > 浏览器的（见文件头）
export function pickLang({ account = null, local = null, browser = [] } = {}) {
  return normLang(account) || normLang(local) || browserLang(browser);
}

const navLangs = (nav) => {
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages;
  return nav.language ? [nav.language] : [];
};
// 无痕模式、禁了网站存储时 localStorage 一碰就抛：读不到当没记过，写不进就算了
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const readLocal = (s = store()) => { try { return normLang(s?.getItem(UI_LANG_KEY)); } catch { return null; } };
const writeLocal = (v, s = store()) => { try { s?.setItem(UI_LANG_KEY, v); } catch { /* 存不了就只在这一页有效 */ } };
const readUnsynced = (s = store()) => {
  try {
    const u = JSON.parse(s?.getItem(UNSYNCED_KEY) || 'null');
    return u && normLang(u.lang) && typeof u.owner === 'string' && u.owner ? { lang: u.lang, owner: u.owner } : null;
  } catch { return null; }
};
const writeUnsynced = (u, s = store()) => { try { if (u) s?.setItem(UNSYNCED_KEY, JSON.stringify(u)); else s?.removeItem(UNSYNCED_KEY); } catch { /* 同上 */ } };

let uiLang = 'zh-CN';     // 她选的 / 定下来的界面语言
let pageLang = null;      // 网站页画的时候是和这一页最近的界面语言（App 设），别的时候 null
const listeners = new Set();

// 她的界面语言（设置里亮着的那一颗、请求头 x-ui-lang 带的）
export const getUiLang = () => uiLang;
// 播放器的 <html dir>：界面语言是从右往左写的（阿拉伯语，shared/langs.js RTL_LANGS）就整个界面镜像，
// 别的照旧从左往右。main.jsx 画之前、App 换了界面语言时都按它设，两处一个规矩
export const uiDir = (lang = uiLang) => (RTL_LANGS.includes(lang) ? 'rtl' : 'ltr');
// t() 现在按哪种取：首页这一组一律简体，别的照她的界面语言
export const renderLang = () => pageLang || uiLang;

export function onUiLang(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 简体、繁體、English 以外的 9 种文案按需加载（i18n/index.js 注册）：要换过去的那种还没拉下来，先拉、拉好再换（拉的这一会儿照旧是原来的语言，
// 不闪一下半中半外）。回 null = 已经有了（照旧当场换）
let packLoader = null;
export function registerPackLoader(fn) { packLoader = fn; }

// 换界面语言：记到本机（remember），变了才通知（界面重画）。不认识的值不理，回 false
export function setUiLang(lang, { remember = true } = {}) {
  const v = normLang(lang);
  if (!v) return false;
  if (remember) writeLocal(v);
  if (v === uiLang) return false;
  const apply = () => {
    if (uiLang === v) return;
    uiLang = v;
    for (const f of [...listeners]) { try { f(v); } catch { /* 一个订阅者出错不挡别的 */ } }
  };
  const p = packLoader?.(v);
  if (p && typeof p.then === 'function') p.then(apply, apply);   // 拉不下来也换（t() 缺的键退回简体），不卡在原来的语言
  else apply();
  return true;
}

// 网站页（App 渲染时按 showHome 设）：和这一页最近的界面语言或 null。只改 t() 取哪种，不改她选的、不通知
export function setPageLang(lang) { pageLang = normLang(lang); }

// 网页打开时（main.jsx，画之前）定一次：本机记的 > 浏览器语言。storage / nav 给测试换假的
export function initUiLang({ storage = store(), nav = globalThis.navigator } = {}) {
  uiLang = pickLang({ local: readLocal(storage), browser: navLangs(nav) });
  return uiLang;
}

// 外部设置读到了（里面的 uiLang 变了也再来一次）该做什么：
//   {act: 'apply', lang}  设置里选过：照它换（setUiLang 顺手记到本机）
//   {act: 'push', lang}   这个使用者在本机刚选过、还没存进设置：本机的为准，再存一次（chooseUiLang）；
//                         设置里没选过（null）：把本机此刻的界面语言（current，本机记的 / 浏览器猜的）存进去，固定下来
//                         。存不上的处理和上一条一样：chooseUiLang 留「没存上」记号，下次再存
//   {act: 'none'}         不用动：设置里已经是本机记的那一种（清掉记号）
// owner：使用者标识。别人留下的「没存上」记号作废（不替别人存）
export function accountLangStep(account, owner, { storage = store(), current = uiLang } = {}) {
  const u = readUnsynced(storage);
  if (u && u.owner === owner) {
    if (normLang(account) === u.lang) { writeUnsynced(null, storage); return { act: 'none' }; }
    return { act: 'push', lang: u.lang };
  }
  if (u) writeUnsynced(null, storage);
  const l = normLang(account);
  if (l) return { act: 'apply', lang: l };
  const c = normLang(current);
  return c ? { act: 'push', lang: c } : { act: 'none' };
}

// 设置里点了一种语言：马上换、记到本机；owner、save 都给了就再存一份：save(lang) → Promise。
// 回 'local'（只记本机）/ 'saved'；存不上时把错误抛给调用方，本机照样换好了：
//   连不上（status 0）、对端出错（5xx）：留着「没存上」记号，下次读到设置时再存（accountLangStep 的 push）；
//   对端明说不收（4xx）：不再重试，只记在本机
// 连点几种：只有最后一次的回话算数（前面的成败不动记号）
let saveSeq = 0;
export async function chooseUiLang(lang, { owner = null, save = null, storage = store() } = {}) {
  const v = normLang(lang);
  if (!v) return 'none';
  setUiLang(v);
  if (!owner || !save) return 'local';
  writeUnsynced({ lang: v, owner }, storage);
  const my = ++saveSeq;
  try {
    await save(v);
    if (my === saveSeq) writeUnsynced(null, storage);
    return 'saved';
  } catch (e) {
    const st = Number(e?.status) || 0;
    if (my === saveSeq && st >= 400 && st < 500) writeUnsynced(null, storage);
    throw e;
  }
}

