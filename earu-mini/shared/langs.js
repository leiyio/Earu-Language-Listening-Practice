// 越南语 vi 先只当界面语言、母语（字幕译成越南语、词卡出越南语释义），
// 还不能选成学习语言（见下面 UI_ONLY_LANGS）。
// 14 种语言：播放器的界面语言、设置里的「母语」「目标语言」都从这里选。
// 代码照播放器界面语言原来的写法：简体 zh-CN、繁體 zh-TW（不是网站目录的 zh-hans / zh-hant，见 SITE_OF）。
// 次序和语言菜单一样：英、德、法、日、韩；土耳其、俄、西、中；葡萄牙；阿拉伯。
//
// 母语、目标语言：字幕翻译、词卡释义、学别的语言都按它们来做。
import { PROFILE_LANGS, profileOf } from './langProfile.js';
export const LANGS = Object.freeze(['en', 'de', 'fr', 'ja', 'ko', 'tr', 'ru', 'es', 'zh-CN', 'zh-TW', 'pt', 'ar', 'hi', 'vi']);
// 语言自己的名字（菜单里不翻译：看不懂当前界面的人也认得出自己的语言）
export const LANG_NATIVE = Object.freeze({
  en: 'English', de: 'Deutsch', fr: 'Français', ja: '日本語', ko: '한국어', tr: 'Türkçe', ru: 'Русский', es: 'Español',
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', pt: 'Português', ar: 'العربية', hi: 'हिन्दी', vi: 'Tiếng Việt',
});
// 只做界面语言、母语，还不能选成学习语言的：没有越南语词典、练习规则。
// 以后开「学越南语」：从这里拿掉，再补语言档案（langProfile）、学习线功能表（LEARN_FEATURES）
export const UI_ONLY_LANGS = Object.freeze(['vi']);
// 从右往左写的
// 书写方向只在语言档案（shared/langProfile.js 的 dir 列）里定一次，这里按档案列出来，别再写死语言代码
export const RTL_LANGS = Object.freeze(PROFILE_LANGS.filter((l) => profileOf(l).dir === 'rtl'));
// 对应的网站目录（shared/siteLocale.js）
export const SITE_OF = Object.freeze({ 'zh-CN': 'zh-hans', 'zh-TW': 'zh-hant' });
// 目标语言没选过时当英语（学中文第一期起选简体 / 繁體中文是学中文，见下面 learnOf）
export const DEFAULT_TARGET = 'en';
export const isLang = (x) => LANGS.includes(x);
// 目标语言能选的：12 种全开。
// 只做界面的（UI_ONLY_LANGS，越南语）不在里面
export const TARGET_LANGS = Object.freeze(LANGS.filter((l) => !UI_ONLY_LANGS.includes(l)));

// ---- 母语：字幕译文、单词释义、句子解析都按母语出 ----
// 没选过母语：跟界面语言走。
// 界面语言本来就是浏览器语言认得出的那种、认不出是英语，所以说中文的人默认中文、说日语的默认日语、别的人默认英语。
// 母语就是在学的语言（英语）时不翻字幕，单词、句子用简单英文解释。
export const nativeOf = ({ nativeLang, uiLang } = {}) => (isLang(nativeLang) ? nativeLang : isLang(uiLang) ? uiLang : 'en');
// 要不要翻字幕：母语和在学的语言一样就不翻
export const needsTranslation = (native, target = DEFAULT_TARGET) => isLang(native) && native !== target;
// 母语 → 译文语种代码：简体沿用老代码 zh，
// 繁體单独翻成 zh-TW，别的照母语代码
export const trCodeOf = (native) => (native === 'zh-CN' ? 'zh' : isLang(native) ? native : null);

// ---- 学中文 ----
// 学习语种只看「目标语言」：zh-CN、zh-TW 是学中文，其余（含没选过的 null、es / ja 等）一律当学英语。
// 选轨、出题、显示都用同一个函数，不会算得不一样。
// 不看母语：母语没选过时跟界面语言走，可能和实际对不上。
// 学习线（learn）的取值：'en' 英语、'zh' 中文（简繁共用）、其余就是那门语言自己的代码（de fr ja ko tr ru es pt ar）。
// 没选过（null）、不认得的值一律当英语。'en'、'zh' 两条线的返回值和以前一字不差。
// 只做界面的语言（越南语）不是学习线：万一存进了目标语言，也当学英语
export const learnOf = (target) => (target === 'zh-CN' || target === 'zh-TW' ? 'zh' : TARGET_LANGS.includes(target) ? target : 'en');
// ---- 每条学习线开了哪些功能 ----
// 本机练习版：12 门学习语言都只有排序（sort）和听写（dictate）。界面只问 learnShows / learnHas，别到处写 learn === 'xx'。
const PRACTICE = Object.freeze(['sort', 'dictate']);
export const LEARN_FEATURES = Object.freeze(Object.fromEntries(
  ['en', 'zh', 'es', 'de', 'fr', 'pt', 'tr', 'ru', 'hi', 'ar', 'ko', 'ja'].map((l) => [l, PRACTICE]),
));
// 这门语言的这项功能全在本机算、不交给 AI。
const AI_FREE = Object.freeze(Object.fromEntries(['es', 'de', 'fr', 'pt', 'tr', 'ru', 'ja', 'ko', 'ar', 'hi'].map((l) => [l, Object.freeze(['level'])])));
export const learnAiFree = (lang, feature) => !!AI_FREE[lang]?.includes(feature);
export function learnHas(learn, feature) {
  const fs = LEARN_FEATURES[learn];
  return !!fs && fs.includes(feature);
}
// 界面上出不出这项功能只问它。
export const learnShows = (learn, feature) => learnHas(learn, feature);
// 只能看片：一个练的功能都没有。能看片、选原声字幕、看母语译文、起雾
export const isWatchOnly = (learn) => !(LEARN_FEATURES[learn] || []).some((f) => learnHas(learn, f));
// 能不能做听写
export const canDictate = (learn) => learnHas(learn, 'dictate');
// 选原声字幕轨时找哪种语言的轨：英语 'en'、中文 'zh'（简繁另看 learnScriptOf），其余就是学习线本身
export const trackLangOf = (learn) => learn || 'en';
// 学中文时偏好的字形（选轨时简繁两条轨挑哪条）：目标选繁體就是 Hant，其余 Hans
export const learnScriptOf = (target) => (target === 'zh-TW' ? 'Hant' : 'Hans');
// 字幕原文是不是中文：简繁都记 'zh'，'zh-TW' 给以后留口
export const isZhSrc = (s) => s === 'zh' || s === 'zh-TW';
// 母语是不是中文（简繁都算）
export const isZhNative = (n) => n === 'zh-CN' || n === 'zh-TW';
// 字幕译成哪种（译文语种代码，同 trCodeOf）；null = 不翻。
// 学英语：needsTranslation(native) ? trCodeOf(native) : null。
// 学中文：母语是中文也给英语译文——不翻就不建条目，没拼音、不能计分，人就被锁死；
// 母语是中文的人不用改母语也能看到英语译文。母语不是中文就照常译成母语。
// 其他学习线：母语和在学的不一样就译成母语；
// 一样（比如母语日语学日语）照学中文的先例给英语译文。
export const trLangFor = (native, learn) => (learn === 'zh'
  ? (isZhNative(native) ? 'en' : trCodeOf(native))
  : learn === 'en' || !learn
    ? (needsTranslation(native) ? trCodeOf(native) : null)
    : (native === learn ? 'en' : trCodeOf(native)));
