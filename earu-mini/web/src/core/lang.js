// 语言代码归一：容器里可能是 ISO 639-2/B（fre）、639-2/T（fra）、639-1（fr）或 BCP47（fr-CA），
// 统一成两字母基码，便于按「学习语种」挑字幕轨。以后加语种只改这里。

import { langOfTag, nameMentions } from './langTags.js';

// 各种写法都在 langTags.js 那一张表里（「spanish」「pob」「jp」「Español (Latinoamérica)」以前原样返回、被当成「明确是别的语言」）。
// 认不准的回 'und'（当没标语言），一个标记里写了两种语言回 'mul'
export function normalizeLang(code) {
  return langOfTag(code);
}

// 中文字幕轨的简繁，只看标记和轨道名：'Hans' | 'Hant' | null（看不出来）。
// 选轨时按目标语言偏好简体还是繁體（shared/langs.js learnScriptOf）；有字幕内容时先按字判（shared/zhText.js detectHanScript，
// worker 写在 t.zh.script），判不出来才用这个。normalizeLang 把 zh-Hans、zh-TW 都归成 zh，简繁只能从原始标记里找。
//   - 标记（BCP47）：先看文字子标签 Hans / Hant（chs / cht 也认），再看地区：CN SG MY → 简，TW HK MO → 繁；
//   - 轨道名：简体、簡體、CHS、GB、Simplified → 简，繁、CHT、BIG5、Traditional → 繁；两边都写了（「简繁双语」）→ 看不出来。
// 字表写成正则：i18n-test ⑧ 不扫正则，字符串里写中文会被当成没翻译的界面文字。
// 缩写前后不能紧挨字母（「Dachshund」里的 chs 不算）；前面用 (?:^|[^a-z]) 不用后行断言 (?<!…)：Safari 16.4 以前不认，模块一加载就语法错误、整页白屏
const SCRIPT_SUB = { hans: 'Hans', chs: 'Hans', hant: 'Hant', cht: 'Hant' };
const REGION_SCRIPT = { cn: 'Hans', sg: 'Hans', my: 'Hans', tw: 'Hant', hk: 'Hant', mo: 'Hant' };
const HANS_NAME = /简|簡[体體]|(?:^|[^a-z])(?:chs|gb|gbk|gb2312|hans)(?![a-z])|simplified/i;
const HANT_NAME = /繁|(?:^|[^a-z])(?:cht|big5|hant)(?![a-z])|traditional/i;
export function scriptOfTag(langRaw, name) {
  const subs = String(langRaw || '').trim().toLowerCase().split(/[-_]/);
  const script = subs.map((s) => SCRIPT_SUB[s]).find(Boolean) || subs.slice(1).map((s) => REGION_SCRIPT[s]).find(Boolean);
  if (script) return script;
  const n = String(name || '');
  const hans = HANS_NAME.test(n);
  const hant = HANT_NAME.test(n);
  return hans === hant ? null : hans ? 'Hans' : 'Hant';
}

// 不是「某种具体语言」的标记，不能据此断定是或不是英文（把 und 当非英文禁掉会死锁）
const VAGUE_LANGS = new Set(['', 'und', 'unknown', 'unk', 'mul', 'zxx', 'qaa', 'mis', 'none', 'null']);
// 用拉丁字母写的语种。按内容只分得出「拉丁字母为主」，分不出英法西
const LATIN_SCRIPT = new Set(['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'sv', 'vi']);
// 轨道名明说不是英文（标签判断）；只在没有内容可看时用
const NOT_EN_NAME = /中文|简体|繁体|chinese|\bchs\b|\bcht\b|\bzh\b|japanese|日文|korean|韩文/i;
// 学中文时（只在没有内容可看、标记又含糊时用）：轨道名说了是中文的放行（「中英双语」也放行：名字里有「英」，可中文那半能用）；
// 说了是别的语言的不放行；名字什么都没说的先放行（同英文「判不出一律放行」）
const ZH_NAME = /中|chs|cht|chinese|双语|雙語/i;
const NOT_ZH_NAME = /english|\beng\b|英文|英语|英語|japanese|日文|日语|日語|korean|韩文|韓文/i;

// 按内容判语种：输入一条轨解出的句子列表 [{text}]，返回 'en' / 'zh' / 'ja' / 'ko' / 'und'。
// 前 240 条里拉丁字母 >= 20 个、且 >= 中日韩字符的 0.8 倍 → 英语
// （含「英中混合」双语轨，它也能当练习源）；中日韩字符 >= 10 个 → 非英语；都不够 → 判不出（und）。
// 非英语再按假名、谚文、汉字的多少分成 ja / ko / zh（要按语种显示和翻译）。
// 再按西里尔字母、阿拉伯字母认出 ru / ar（trackIsLang 对俄语、阿语轨要求内容判出来恰好是这个码，
// 不认就会把对的轨判掉）。一种文字对应多种语言的（西里尔：乌克兰语、保加利亚语……；阿拉伯字母：波斯语、乌尔都语……）按内容分不出，
// 同拉丁字母的法西德一样靠轨道标记兜底（trackIsLang 标记明确且不是学习语言就先否决）。
// 注意 'en' 的意思其实是「拉丁字母为主」：法语、西语字幕也会判成 'en'，同样分不出。
// 双语字幕（日英、韩英、俄英……）：拉丁字母多，detectTextLang 判成 'en'，可学习语言那半是实打实的。
// 非拉丁文字的学习语言，自己那种文字占得够（至少 20 个、不少于拉丁字母的四分之一）就算有。日语看假名、韩语看谚文，
// 不看汉字（中文另走一支）。标记明说是别的语言的轨在这之前已经否决了
const OWN_SCRIPT = { ja: /[぀-ヿ]/g, ko: /[가-힯]/g, ru: /[Ѐ-ԯ]/g, ar: /[ؠ-يٮ-ۓۺ-ۿ]/g, hi: /[ऀ-ॿ]/g };
// 拉丁字母的学习语言（英西法德葡土）同理：中英、中西双语里汉字比字母多时 detectTextLang 判成 'zh'，字母够多也算有
function hasOwnScript(lines, lang, byRow = false) {
  const latinLang = LATIN_SCRIPT.has(lang);
  const re = OWN_SCRIPT[lang];
  if (!re && !latinLang) return false;
  const head = (lines || []).slice(0, 240).map((l) => l.text || '');
  const sample = head.join(' ');
  const count = (s, r) => (s.match(r) || []).length;
  const OTHER = /[぀-ヿ㐀-鿿가-힯Ѐ-ԯؠ-ۿऀ-ॿ]/g;
  const latin = count(sample, /[A-Za-z]/g);
  if (re) { const own = count(sample, re); if (own >= 20 && own * 4 >= latin) return true; }
  // 拉丁字母的语言：和非拉丁文字（汉字、假名、谚文、西里尔、阿拉伯、天城文）比
  else if (latin >= 20 && latin * 4 >= count(sample, OTHER)) return true;
  if (!byRow) return false;
  // 整体比例不够时再按行看（只用于「有没有」：挑练习用的轨不按行算，双语轨的另一半会混进练习）：双语字幕里学习语言那行短（日文一行十来个字、英文一行四五十个字母），
  // 整体算不到四分之一，可每句都有。够多的行是这门文字为主就算有
  const rows = head.flatMap((x) => x.split(/\n|\\N/)).filter((x) => x.trim());
  let hit = 0;
  for (const r of rows) {
    const lat = count(r, /[A-Za-z]/g);
    if (re) { const own = count(r, re); if (own >= 2 && own >= lat) hit++; }
    else if (lat >= 8 && lat >= 2 * count(r, OTHER)) hit++;
  }
  return hit >= Math.max(5, rows.length * (re ? 0.15 : 0.2));
}
export function detectTextLang(lines) {
  const sample = (lines || []).slice(0, 240).map((l) => l.text || '').join(' ');
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const kana = (sample.match(/[぀-ヿ]/g) || []).length;
  const hangul = (sample.match(/[가-힯]/g) || []).length;
  const han = (sample.match(/[㐀-鿿]/g) || []).length;
  // 西里尔字母（基本区 + 补充区）；阿拉伯字母只数字母（不数阿拉伯数字、标点：「؟」「،」这类各语言字幕里都可能出现）
  const cyrillic = (sample.match(/[Ѐ-ԯ]/g) || []).length;
  const arabic = (sample.match(/[ؠ-يٮ-ۓۺ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g) || []).length;
  // 天城文：整个天城文区 U+0900–097F；马拉地语、尼泊尔语也用它，按内容分不出，靠轨道标记兜底（同阿拉伯字母）
  const deva = (sample.match(/[ऀ-ॿ]/g) || []).length;
  const cjk = kana + hangul + han;
  // 拉丁字母和「最多的那种非拉丁文字」比（只有一种非拉丁文字时，和原来拉丁对中日韩的判法一字不差）
  const other = Math.max(cjk, cyrillic, arabic, deva);
  if (latin >= 20 && latin >= other * 0.8) return 'en';
  if (other >= 10) {
    if (deva >= cjk && deva >= cyrillic && deva >= arabic) return 'hi';
    if (cyrillic >= cjk && cyrillic >= arabic) return 'ru';
    if (arabic >= cjk) return 'ar';
    if (hangul >= kana && hangul >= han) return 'ko';
    if (kana >= cjk * 0.1) return 'ja'; // 日文句子里假名一般占三成以上，中文一个都没有
    return 'zh';
  }
  return 'und';
}

const tagOf = (t) => (t.lang != null ? t.lang : normalizeLang(t.langRaw));
// 语言标记含糊：und / 空 / mul 之类，或者容器里根本没写（MKV 规范默认记成 eng，见 container/mkv.js；要 mkv.js 标上 langImplicit 才分得出）
const isVague = (t) => VAGUE_LANGS.has(tagOf(t)) || !!t.langImplicit;

// 这条轨能不能当 lang 语种的字幕用（自动选轨、发翻译都看它）。lines 是这条轨解出的句子，没有就传 undefined。
// - 语言标记明确是别的语言 → 不能（唯一一条法语轨被当英文翻会白花钱；宁可判「没有英文字幕」）；
// - 有内容 → 按内容判（对每个练习源都查，标着 eng 也查）；
// - 没内容可看 → 标记对得上就算；含糊的看轨道名，名字没说是别的语言就先放行（判不出一律放行）。
//
// 其余学习线（de fr ja ko tr ru es pt ar，lang 取 shared/langs.js trackLangOf）走下面这一支，
// 判法同英语：有内容就要求 detectTextLang 恰好是这个语种（ja ko ru ar 靠文字认出来），拉丁字母的 de fr es pt tr 由 'en' 代表「拉丁字母为主」。
//
// 学中文（lang === 'zh'，）另走一支，英文的判断一字不改：
// - lines 要传这条轨的「中文视图」（worker 的 zhSubs；没有中文视图的轨传原来的 subs）：双语轨原来的整句按内容判是 en；
// - 有内容就只按内容判，内容压过标记：认汉字很可靠，标成 eng / und 的中文轨、标成 eng 的双语轨都能选上；
// - 没内容：标记明确就看标记；含糊的看轨道名（ZH_NAME 放行，NOT_ZH_NAME 不放行，什么都没说的放行）。
// 轨道名里明说带着这门（「简英双语」「Japanese/English」「Chinese&English」）：内嵌双语轨的标记常只写一种（chi、jpn），
// 这时标记不算否决、名字里的「中文」也不算否决，当标记含糊处理——有内容按内容，没内容放行（宁可漏说，不能错说没有）
// loose：只问「这条轨里有没有这门」（轨道面板说「没有X字幕」前用），双语轨里这门的行短也算有
export function trackIsLang(t, lines, lang = 'en', loose = false) {
  const name = t.name || '';
  // 名字放行只用在「有没有」（loose）和没内容时：挑练习轨（有内容、不 loose）照旧按标记否决，免得双语轨的另一半混进练习
  const named = (loose || !lines) && nameMentions(name, lang);
  // 问「有没有」（loose）时：标记就写着这门、内容又测不出来（太短、全是符号）的照算有；内容明摆着是别的语言照旧算没有
  if (loose && !isVague(t) && tagOf(t) === lang && (!lines || detectTextLang(lines) === 'und')) return true;
  if (lang === 'zh') {
    if (lines) return detectTextLang(lines) === 'zh';
    if (!isVague(t) && !named) return tagOf(t) === 'zh';
    return named || ZH_NAME.test(name) || !NOT_ZH_NAME.test(name);
  }
  const tag = tagOf(t);
  // 问「有没有」、又读到了内容、学的是非拉丁字母的语言：标记写错（俄语字幕标成 eng）以内容为准
  const byContent = loose && lines && !LATIN_SCRIPT.has(lang);
  if (!isVague(t) && tag !== lang && !named && !byContent) return false;
  if (lines) {
    const v = detectTextLang(lines);
    return v === lang || (v === 'en' && LATIN_SCRIPT.has(lang)) || hasOwnScript(lines, lang, loose);
  }
  if (!isVague(t) || named) return true;
  return !(lang === 'en' && NOT_EN_NAME.test(name));
}

// 从字幕轨里挑默认那条：语种对、能读的文本轨，避开「强制字幕」（只翻外语片段的那种）。
// tracks 里每条带 cueCount（已提取的句数），没有就当未知。
// subs 是 { [trackId]: 句子列表 }（openMedia 的 onSubs 给的那份）：传了就按内容复核语种，
// und 和「容器里没写语言」的轨也能被选上（拿无标记轨兜底）；不传就只看标记。
//
// 学中文（lang === 'zh'）另走 rankZh，英文的打分一字不改。opts.script：偏好的字形（'Hans' | 'Hant'，shared/langs.js learnScriptOf）。
//
// 远程片（desktop/remoteMedia.js）只读一部分轨：没读的轨标 unread（句数不知道），这里不选它们
export function pickSubtitleTrack(tracks, lang = 'en', subs = null, opts = {}) {
  return rankSubtitleTracks(tracks.filter((t) => !t.unread), lang, subs, opts)[0] || null;
}

// 候选按挑字幕的先后排好（打分同上：pickSubtitleTrack 取第一条）。远程片按这个顺序一条条读，读到够用的就停（remoteMedia.js）；
// 没读过的轨（unread）也排进来：句数当未知，语种只看标记和轨道名（trackIsLang 没内容那一支）
export function rankSubtitleTracks(tracks, lang = 'en', subs = null, opts = {}) {
  if (lang === 'zh') return rankZh(tracks, subs, opts);
  const text = tracks.filter((t) => t.type === 'subtitle' && t.kind === 'text' &&
    trackIsLang(t, subs ? subs[t.id] : undefined, lang));
  if (!text.length) return [];
  const maxCues = Math.max(...text.map((t) => t.cueCount || 0));
  const score = (t) => {
    let s = 0;
    const forcedLike = t.isForced || /forced|强制/i.test(t.name || '') ||
      (maxCues > 50 && (t.cueCount || 0) < maxCues * 0.3);
    if (!forcedLike) s += 100;
    if ((t.cueCount ?? 1) > 0) s += 50;
    if (!(t.isHearingImpaired || /\bsdh\b|\bcc\b|hearing/i.test(t.name || ''))) s += 10;
    if (t.isDefault) s += 5;
    // 标记明确的排在含糊的前面；含糊又没内容核对过的只当最后的兜底，
    // 排在强制字幕后面
    if (!isVague(t)) s += 20;
    else if (!(subs && subs[t.id])) s -= 200;
    return s;
  };
  return text.slice().sort((a, b) => score(b) - score(a) || a.order - b.order);
}

// 学中文的选轨：英文那套打分照搬（不是强制字幕 +100、有台词 +50、不是 SDH +10、默认轨 +5、标记明确 +20、
// 含糊又没内容核对 −200），句数用中文视图的（t.zh.cueCount：双语轨拆完、按 zm2 合完的句数）；再加两项：
//   - 字形对得上偏好 +30：按字判的 t.zh.script 优先，判不出来（没内容、特征字不到 5 个）才看标记和名字（scriptOfTag）；
//     简繁混排（'mixed'）不加分。只有繁體轨、偏好简体时照样选它（不做简繁转换）；
//   - 不是双语轨 +6：一条双语、一条纯简体，选纯简体（双语轨的英文那半不用）。比默认轨 +5 大：字幕组常见的封装是
//     「简英双语」设成默认轨、再加一条「简体」，ffmpeg 也默认把第一条字幕设成默认轨，+3 会被默认轨压过、选成双语轨；
//     又比别的项都小：字形偏好、标记明确、强制、SDH 照样压过它。
// subs 要传「中文视图」那份（{ ...subs, ...zhSubs }），trackIsLang 按它判是不是中文。
function rankZh(tracks, subs, opts) {
  const text = tracks.filter((t) => t.type === 'subtitle' && t.kind === 'text' &&
    trackIsLang(t, subs ? subs[t.id] : undefined, 'zh'));
  if (!text.length) return [];
  const cues = (t) => t.zh?.cueCount ?? t.cueCount;
  const maxCues = Math.max(...text.map((t) => cues(t) || 0));
  const score = (t) => {
    let s = 0;
    const forcedLike = t.isForced || /forced|强制/i.test(t.name || '') ||
      (maxCues > 50 && (cues(t) || 0) < maxCues * 0.3);
    if (!forcedLike) s += 100;
    if ((cues(t) ?? 1) > 0) s += 50;
    if (!(t.isHearingImpaired || /\bsdh\b|\bcc\b|hearing/i.test(t.name || ''))) s += 10;
    if (t.isDefault) s += 5;
    if (!isVague(t)) s += 20;
    else if (!(subs && subs[t.id])) s -= 200;
    if (opts?.script && (t.zh?.script ?? scriptOfTag(t.langRaw, t.name)) === opts.script) s += 30;
    if (!t.zh?.bilingual) s += 6;
    return s;
  };
  return text.slice().sort((a, b) => score(b) - score(a) || a.order - b.order);
}

// 一条声音说的是什么（audioOffLearn 用）：
//   'yue'：粤语——标记是 yue（zh-yue、yue-Hant 也算），或者轨道名写了粤语 / 粵語 / Cantonese（标记写成 chi 的粤语配音常见）；
//   'zh'：标记是别的中文（chi、zho、cmn、zh-CN……）；
//   别的两字母码（'en'、'ja'……）：标记明确是别的语言（英语配音配中文字幕）；
//   null：标记含糊（und、没写、MKV 默认记成的 eng），看不出来——不提示。
// 名字写成正则：i18n-test ⑧ 不扫正则
const YUE_NAME = /粤|粵|广东话|廣東話|cantonese/i;
// 别的汉语方言：闽南语（台语）、客家话、吴语……学普通话时同粤语，不算中文声音；字幕写出来是汉字，照算中文
const ZH_DIALECTS = new Set(['yue', 'nan', 'hak', 'wuu', 'gan', 'hsn', 'cdo', 'cjy', 'cpx']);
const DIALECT_NAME = [[/闽南|閩南|台语|台語|hokkien/i, 'nan'], [/客家|hakka/i, 'hak'], [/吴语|吳語|上海话|上海話|shanghainese/i, 'wuu']];
// 名字里还写了普通话（「国粤双语」「Mandarin/Cantonese」）：两样都可能有，看不出来
const MANDARIN_NAME = /国语|國語|国粤|國粵|普通话|普通話|mandarin|华语|華語|双语|雙語|dual|bilingual/i;
export function audioDialectOf(a) {
  if (!a) return null;
  const subs = String(a.langRaw || '').trim().toLowerCase().split(/[-_]/);
  if (subs.includes('yue')) return 'yue';
  const d = subs.find((x) => ZH_DIALECTS.has(x));
  if (d) return d;
  // 名字里的方言只在标记含糊、或者标记是中文时才算：标着 eng 的「English (Cantonese)」、
  // 标着 jpn 的「日语（粤语字幕）」照标记算
  const name = a.name || '';
  if (isVague(a) || tagOf(a) === 'zh') {
    const byName = YUE_NAME.test(name) ? 'yue' : DIALECT_NAME.find(([re]) => re.test(name))?.[1];
    if (byName) return MANDARIN_NAME.test(name) ? null : byName;
  }
  if (isVague(a)) return null;
  return tagOf(a);
}

// 在放的那条声音：换了盒子的片标了 playing（按在学的语言挑的，remuxSource.js markPlaying）；没标就是默认那条（没标默认的就是第一条）。
// 默认那条浏览器放不了、别的有放得了的：浏览器直接放文件时跳过放不了的轨，放的是第一条放得了的（例如：默认杜比 E-AC3 普通话、
// 第三条 AAC 普通话，控制区原先说「默认音轨放不出声音」，其实放的是 AAC 那条）
export function playingAudio(tracks) {
  const a = (tracks || []).filter((x) => x?.type === 'audio');
  const mark = a.find((x) => x.playing);
  if (mark) return mark;
  const def = a.find((x) => x.isDefault) || a[0] || null;
  if (def?.play === 'no') return a.find((x) => x.play !== 'no') || def;
  return def;
}
// 在放的声音明说不是在学的语言：
// 标记含糊的（und、没写、MKV 默认的 eng）看不出来、不算；学中文时粤语也算对不上；放不出声音的不算（另有一句说放不出）。
// learn 是学习线（learn：'en' | 'zh' | 'de' ……）。播放中不给换声音，只提示
export function audioOffLearn(tracks, learn) {
  const a = playingAudio(tracks);
  if (!a || a.play === 'no' || !learn) return false;
  const d = audioDialectOf(a);
  return !!d && d !== learn;
}
