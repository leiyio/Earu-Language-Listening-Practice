// 语言标记 → 两字母基码，全站只认这一处（lang.js normalizeLang、noLearn.js 外挂字幕 都走这里）。
// 要求：音轨和字幕轨的语言都要判得出来，不能因为判错而出问题。
// 判法的底线：宁可「看不出来」（'und'，当可能是，不提示缺），不能把在学的语言认成别的语言（会误报缺、挑错轨）。所以：
//   - 认得的写法（ISO 639-1 / 639-2/B / 639-2/T / 639-3、BCP47、字幕站和字幕组的习惯写法、各语言的全称和本族语名）→ 基码；
//   - 两个意思都说得通的（uk 乌克兰语 / 英国，ch 查莫罗语 / 中文，br 布列塔尼语 / 巴西 / 蓝光，hi 在文件名里是听障……）→ 'und'；
//   - 不是语言的词（sdh、forced、web、1080p……）→ 'und'；
//   - 别的真实语言码（希腊语 el、希伯来语 he……）→ 原样两字母码（明确是别的语言，学这 12 门时算「不是」）；
//   - 什么都对不上 → 'und'（不原样返回：「spanish」「pob」「jp」这类会被误当成「明确是别的语言」）。
// 名字写成数组里的字符串：i18n-test ⑧ 只扫界面文字的写法，这里的本族语名不算界面文字（有测试兜底时再改）

const NAMES = {
  en: 'en eng english enu engl ingl usa anglais inglés ingles inglês englisch inglese engels ingilizce английский अंग्रेज़ी अंग्रेजी الإنجليزية 영어 英语 英文 英語 美式英语 英式英语',
  zh: 'zh zho chi cmn chs cht zhs zht zhcn zhtw chn prc sch tch zt gbk gb2312 big5 chi_sim chi_tra zh_hans zh_hant hans hant simpchinese tradchinese simplified traditional ' +
    'wuu nan hak gan hsn cdo cjy cpx lzh yue ' +   // 方言、文言：字幕当中文（写出来是汉字）；声音另判（lang.js audioDialectOf，学普通话时不算）
    'chinese mandarin putonghua cantonese chinois chino chinesisch chinês chines çince cince китайский चीनी الصينية 중국어 中国語 ' +
    '中文 汉语 漢語 国语 國語 普通话 普通話 华语 華語 中字 简体 簡體 简体中文 簡體中文 简中 繁中 繁体 繁體 繁体中文 繁體中文 简繁 簡繁 粤语 粵語 广东话 廣東話',
  es: 'es spa sp esp esl cas cast lat latino latam latinamerica castellano castilian spanish español espanol spanisch espagnol espanhol ispanyolca испанский स्पेनिश الإسبانية 스페인어 スペイン語 西班牙语 西班牙文 西语 西班牙語 西語',
  de: 'de ger deu gsw ge deut german deutsch deutsche alemán aleman alemão alemao allemand almanca немецкий जर्मन الألمانية 독일어 ドイツ語 德语 德文 德語 schweizerdeutsch',
  fr: 'fr fre fra frc vf vff vfq vfi vfb truefrench vostfr french français francais francés frances francês französisch franzosisch fransızca fransizca французский फ़्रेंच फ्रेंच الفرنسية 프랑스어 フランス語 法语 法文 法語 québécois quebecois',
  pt: 'pt por pob ptb ptbr ptpt pb portuguese brazilian brasileiro português portugues portugués portuguesa portugiesisch portugais portekizce португальский पुर्तगाली البرتغالية 포르투갈어 ポルトガル語 葡萄牙语 葡萄牙文 葡语 葡萄牙語',
  tr: 'tr tur turkish türkçe turkce turkçe türk turk türkisch turc turco турецкий तुर्की التركية 튀르키예어 터키어 トルコ語 土耳其语 土耳其文 土耳其語',
  ru: 'ru rus russian русский russe ruso russo rusça rusca russisch रूसी الروسية 러시아어 ロシア語 俄语 俄文 俄語',
  hi: 'hi hin hindi हिन्दी हिंदी hindī hinglish hindustani الهندية 힌디어 ヒンディー語 印地语 印地文 印地語',
  ar: 'ar ara arb arz apc ajp acm ary apd afb ayl ars acw aeb arq ayp ayn acx acq abv adf aao auz avl shu ssh aju aec acy arab ' +
    'arabic العربية عربي عربى arabe árabe arabisch arapça arapca арабский अरबी 아랍어 アラビア語 阿拉伯语 阿拉伯文 阿语 阿拉伯語',
  ko: 'ko kor kr korean hangul 한국어 한국말 조선어 한글 coréen coreen coreano koreanisch korece корейский कोरियाई الكورية 韩语 韩文 韓語 韓文 朝鲜语 韩国语 韓國語',
  ja: 'ja jpn jp jap jpa japanese nihongo にほんご japonais japonés japones japonês japanisch japonca японский जापानी اليابانية 일본어 日本語 日本语 日语 日文 日語',
  // 不是学习语言、但别处（选轨面板、旧学习线）用到的
  it: 'it ita italian italiano italienisch italien',
  nl: 'nl dut nld dutch nederlands',
  th: 'th tha thai',
  vi: 'vi vie vietnamese',
  pl: 'pl pol polish polski',
  sv: 'sv swe swedish svenska',
};

// 一个标记里写了两种以上语言（中英双语、chs.eng）：当「多语言」，两边都算可能是
const BILINGUAL = 'ze 中英 简英 繁英 中英双语 中英雙語 双语 雙語 bilingual dual multi multisub';

// 两个意思都说得通、或者根本不是语言的：一律看不出来
const VAGUE = '- und unknown unk mul zxx qaa mis none null n/a orig original vo vost ' +
  'uk ch gr br la sc tc gb trk nds dv new fan pal ' +   // 含糊码
  // 既是语言码又是常见的国家 / 地区缩写：Movie.tw.srt 是台湾繁体不是契维语，sg 新加坡、sa/ae 沙特阿联酋、co 哥伦比亚、
  // ca 加拿大……当「看不出来」。后半截不是语言码、只是地区缩写，写在这里免得以后有人当成别的语言加进去
  'tw sg sa ae co ve cu cr bo li lu ie ca za be us au nz mx mo cn hk eg ma at ' +
  'sdh cc hoh forced force default full sign signs song songs commentary comment director dub dubbed dubs sub subs subtitle subtitles ' +
  'srt ass ssa vtt sup idx smi sami lrc txt hdr hdr10 dovi sdr web dl webdl webrip bluray bdrip brrip bd dvdrip dvd hdtv hdrip remux ' +
  'x264 x265 h264 h265 hevc avc av1 aac dts dtshd ac3 eac3 ddp dd truehd flac opus atmos mp3 2ch 6ch 1080p 720p 2160p 480p 4k uhd ' +
  'amzn nf dsnp hmax atvp pcok ext embedded ad sync synced fixed fix retimed edited clean proper repack extended remastered sample ' +
  'track audio stereo mono surround intl int uncut imax hybrid tv ntsc hc hardsub hardcoded softsub ocr cc1 cc2 pgs vobsub fansub ' +
  'web-dl blu-ray dual-audio multi-subs sign&songs signs&songs signsandsongs part1 part2 cd1 cd2 v2 v3 r1 all';

// 别的真实语言（ISO 639-1 全表去掉上面含糊的、去掉学习语言）：明确是别的语言
const OTHER_639_1 = ('aa ab ae af ak am an as av ay az ba be bg bh bi bm bn bo bs ca ce co cr cs cu cv cy da ee el eo et eu fa ff fi fj fo fy ' +
  'ga gd gl gn gu gv ha he ho hr ht hu hy hz ia id ie ig ii ik io is iu jv ka kg ki kj kk kl km kn ks ku kv kw ky lb lg li ln lo lt lu lv ' +
  'mg mh mi mk ml mn mr ms mt my na nb nd ne ng nn no nr nv ny oc oj om or os pa pi ps qu rm rn ro rw sa sd se sg si sk sl sm sn so sq sr ss st ' +
  'su sw ta te tg ti tk tl tn to ts tt tw ty ug ur uz ve vo wa wo xh yi yo za zu').split(' ');
// 常见的别的语言三字码 → 两字码（容器里多半写三字码）
const OTHER_639_2 = {
  heb: 'he', gre: 'el', ell: 'el', ukr: 'uk', bul: 'bg', srp: 'sr', scc: 'sr', hrv: 'hr', scr: 'hr', bos: 'bs', slv: 'sl', slo: 'sk', slk: 'sk',
  cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', fin: 'fi', est: 'et', lav: 'lv', lit: 'lt', dan: 'da', nor: 'no', nob: 'nb', nno: 'nn',
  ice: 'is', isl: 'is', per: 'fa', fas: 'fa', urd: 'ur', ben: 'bn', tam: 'ta', tel: 'te', mar: 'mr', guj: 'gu', kan: 'kn', mal: 'ml', pan: 'pa',
  nep: 'ne', sin: 'si', ind: 'id', may: 'ms', msa: 'ms', fil: 'tl', tgl: 'tl', khm: 'km', lao: 'lo', bur: 'my', mya: 'my', mon: 'mn',
  geo: 'ka', kat: 'ka', arm: 'hy', hye: 'hy', aze: 'az', kaz: 'kk', uzb: 'uz', tuk: 'tk', kir: 'ky', tat: 'tt', bel: 'be', mac: 'mk', mkd: 'mk',
  alb: 'sq', sqi: 'sq', cat: 'ca', glg: 'gl', baq: 'eu', eus: 'eu', wel: 'cy', cym: 'cy', gle: 'ga', gla: 'gd', bre: 'br', ltz: 'lb',
  afr: 'af', swa: 'sw', amh: 'am', som: 'so', yor: 'yo', ibo: 'ig', hau: 'ha', zul: 'zu', xho: 'xh', mlt: 'mt', epo: 'eo', lat: null,
  pus: 'ps', kur: 'ku', ckb: 'ku', uig: 'ug', snd: 'sd', bho: 'bh', mai: 'mai', san: 'sa', tib: 'bo', bod: 'bo', yid: 'yi', haw: 'haw',
  ota: 'ota', ang: 'ang', enm: 'enm', frm: 'frm', fro: 'fro', gmh: 'gmh', goh: 'goh', grc: 'grc',
};

// 可能指学习语言的地区 / 字形缩写：文件名里出现了它，同一个名字里认出的别的语言就不算数（Movie.GB.ENG.srt 的 GB 是简体，
// Movie.HK.ENG.srt 的 HK 是粤语 / 繁体），整个名字当「写了但认不准」
const REGIONISH = new Set('uk gb us au nz ie ca ch br la mx co ve cu cr bo sc tc tw sg cn hk mo sa ae eg ma at be li lu za'.split(' '));
// 中日韩写法的双语简称（简英、日英双语、韩英、英中……）：两字的组合，单字不是语言名，只能整对列出来
const CJK_PAIR_A = '中简繁日韩韓俄西法德葡阿土印英';
const CJK_PAIR_B = '英中日韩韓';

const ALIAS = new Map();
for (const [base, list] of Object.entries(NAMES)) for (const w of list.split(/\s+/)) if (w) ALIAS.set(w, base);
for (const w of BILINGUAL.split(/\s+/)) ALIAS.set(w, 'mul');
for (const a of CJK_PAIR_A) for (const b of CJK_PAIR_B) if (a !== b && !ALIAS.has(a + b)) ALIAS.set(a + b, 'mul');   // 简中、繁中是中文，不动
for (const w of VAGUE.split(/\s+/)) ALIAS.set(w === '-' ? '' : w, 'und');
for (const c of OTHER_639_1) if (!ALIAS.has(c)) ALIAS.set(c, c);
for (const [k, v] of Object.entries(OTHER_639_2)) if (!ALIAS.has(k)) ALIAS.set(k, v || 'und');

// 12 门学习语言（shared/langs.js 的学习线归到基码；NAMES 里另有意大利语、荷兰语这些不是学习语言的）
const LEARN_BASES = new Set('en zh es de fr pt tr ru hi ar ko ja'.split(' '));

// 含汉字、假名、谚文、天城文、阿拉伯文、西里尔字母的名字：不按空格分词，按「包含」找（「简体中文字幕」「日本語字幕」）
const NON_LATIN = /[^\u0000-\u024f]/;
const SUBSTR = [...ALIAS.entries()].filter(([w, b]) => NON_LATIN.test(w) && b !== 'und').sort((a, b) => b[0].length - a[0].length);

// 分成几个词以后各自认：回 { found: 认出的基码, multi: 写了双语 / 有认不准的地区缩写 }
//   - 汉字、假名这类按「包含」找；
//   - 拉丁字母的词：一般只认三个字母以上的（「Español de España」的 de 不是德语）；
//     整个名字全是两三个字母的缩写拼起来的（GB&ENG、ZH&ENG、KO+EN、es/en）才连两字母的一起认，这种写法里两字母的就是语言 / 地区码
function wordsOf(s) {
  const found = new Set();
  let multi = /双语|雙語|bilingual|dual|multi/.test(s);
  let rest = s;
  for (const [w, b] of SUBSTR) if (rest.includes(w)) { found.add(b); rest = rest.split(w).join(' '); }
  const words = rest.split(/[\s()[\]{},;:/|+&._"'-]+/).filter(Boolean);
  const codes = words.length > 1 && words.every((w) => /^[a-z]{2,3}$/.test(w));
  for (const w of words) {
    if (w.length < 3 && !codes) continue;
    if (codes && REGIONISH.has(w)) { multi = true; continue; }
    const b = ALIAS.get(w);
    if (b && b !== 'und') found.add(b);
  }
  if (found.delete('mul')) multi = true;
  return { found, multi };
}
function fromWords(s) {
  const { found, multi } = wordsOf(s);
  if (found.size > 1 || (multi && found.size)) return 'mul';
  return found.size ? [...found][0] : (multi ? 'mul' : null);
}

// 轨道名里提没提到 lang 这门语言（或者写了双语）：标记写成别的语言、名字写着「简英双语」「Japanese/English」的轨，lang 那半可能是有的
// （lang.js trackIsLang 用：这种轨不再一票否决，交给内容判）
export function nameMentions(name, lang) {
  const s = String(name || '').trim().toLowerCase().normalize('NFC').replace(/̇/g, '');
  if (!s) return false;
  if (ALIAS.get(s) === lang) return true;
  const { found, multi } = wordsOf(s);
  return multi || found.has(lang);
}

// 容器、媒体服务器给的语言标记（eng、es-419、pt_BR、Español (Latinoamérica)、Chinese (Simplified)、简体中文）→ 基码；
// 认不准的回 'und'，一个标记里写了两种语言回 'mul'
export function langOfTag(code) {
  // 土耳其语的大写 İ 转小写会多一个附加点（U+0307，「İngilizce」）：去掉
  const s = String(code ?? '').trim().toLowerCase().normalize('NFC').replace(/̇/g, '');
  if (ALIAS.has(s)) return ALIAS.get(s);
  // BCP47 / 下划线写法：看第一段（zh-Hant-TW、pt_BR、en-US），第一段认不出就看不出来
  if (/^[a-z]{2,3}(?:[-_][a-z0-9]{1,8})+$/.test(s)) {
    const [head, ...more] = s.split(/[-_]/);
    const base = ALIAS.get(head) ?? 'und';
    if (base === 'und' || base === 'mul') return base;
    // 双语连写（zh-en、chs-eng、CHS_ENG、es-en、eng-jpn）：后面一段也是语言就是双语。
    // 后面是两字母的：地区码（es-AR、fr-CA、zh-TW、en-IN）和语言码长得一样，只有前后都是学习语言才当双语（es-AR 是阿根廷西语，除外）；
    // 三字母的：BCP47 没有三字母地区码，是语言就是双语（zh-yue、ar-arz 这种同一门的不算）
    for (const m of more) {
      const mb = ALIAS.get(m);
      if (!mb || mb === 'und' || mb === 'mul' || mb === base) continue;
      if (m.length === 3 || (m.length === 2 && LEARN_BASES.has(base) && LEARN_BASES.has(mb) && !(base === 'es' && m === 'ar'))) return 'mul';
    }
    return base;
  }
  if (/^[a-z]{2,3}$/.test(s)) return 'und';   // 不在表里的两三字母：看不出来（以前原样回，被当成「明确是别的语言」）
  return fromWords(s) ?? 'und';
}

// ---- 外挂字幕的文件名（Bluey.S03E05.es.srt、Movie.chs.eng.srt、Movie.en.hi.srt、Movie [English].srt） ----
// 回在文件名里写到的语言（数组，双语字幕两个都在）；文件名没写语言回 null；写了但认不准（Movie.hi.srt 的 hi、Movie.uk.srt）回 []。
// videoName：片子的文件名，给了就先去掉片名那截（片名《It》《Hi, Mom》里的词不会被当成语言）
const SUB_EXT = /\.(srt|vtt|ass|ssa|sub|sup|idx|smi|sami|ttml|dfxp|lrc|txt)$/i;
const VIDEO_EXT = /\.[a-z0-9]{2,4}$/i;
// 片名去掉后再看：片子叫「Dan Da Dan S01E01.mkv」、字幕叫「Dan.Da.Dan.S01E01.srt」也要对得上——比的时候点、空格、
// 下划线、横线都当一样，大小写不管
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function stripVideo(stem, videoName) {
  const words = String(videoName || '').replace(VIDEO_EXT, '').split(/[.\s_-]+/).filter(Boolean);
  if (!words.length) return null;
  const m = stem.match(new RegExp('^' + words.map(escRe).join('[.\\s_-]+') + '(?=$|[.\\s_-])', 'i'));
  return m ? stem.slice(m[0].length).replace(/^[.\s_-]+/, '') : null;
}
// 年份、季集号：片名到这里为止，再往前（文件名里更靠前）都是片名（Tell.Me.Who.I.Am.2019.srt 的 Am、Dan.Da.Dan.S01E01.srt 的 Dan 不看）
const WORDLIKE3 = new Set('arm cat ice may nor pan per lit sin fin rum ben'.split(' '));
const TITLE_END = /^(19|20)\d\d$|^s\d+(e\d+)?$|^e\d+$|^\d+x\d+$/i;
export function langsOfSubName(name, videoName = '') {
  const stem = String(name || '').replace(SUB_EXT, '');
  const rest = stripVideo(stem, videoName);
  // 方括号、圆括号里写的（Movie [English].srt、Movie (chs).srt）当一段
  const bracket = [...stem.matchAll(/[[(]([^\])]{2,30})[\])]/g)].map((m) => m[1]);
  let segs;
  if (rest != null) segs = rest ? rest.split('.') : [];
  else {
    const parts = stem.split('.');
    // 没有片名可去：第一段是片名，不看（只有一段时只认写全了的语言名：English.srt、简体中文.srt，不认 It.srt 这种短码）
    segs = parts.length > 1 ? parts.slice(1) : [];
    if (parts.length === 1) {
      const tail = parts[0].split(/[\s_-]+/).pop().toLowerCase();   // YTS 那种「2_English.srt」
      const b = ALIAS.get(tail);
      if (tail.length > 3 && b && b !== 'und') segs = [tail];
      else if (NON_LATIN.test(parts[0])) segs = [parts[0]];
    }
  }
  const langs = new Set();
  let saw = false;     // 看到过像语言标记的段（含糊的也算）
  let amb = false;     // 有可能指学习语言、又认不准的段（GB、HK、TW 这种地区 / 字形缩写，首字母大写的短词）：整个名字算「认不准」
  let hi = false;
  // 从后往前看，碰到片名一样的词（不认识、不是语言）就停：片名夹在中间的「Movie.It.2017.en.srt」只看 en
  const tail = segs.slice(-5).reverse();
  for (const raw of [...bracket, ...tail]) {
    const r = raw.trim();
    const t = r.toLowerCase();
    if (!t) continue;
    if (t === 'hi') { hi = true; continue; }    // 听障标志还是印地语：后面统一定
    if (!bracket.includes(raw) && TITLE_END.test(t)) break;
    if (REGIONISH.has(t)) { amb = true; continue; }
    // 首字母大写的两三个字母（He、Is、Da、Dan、Cat、Es）：语言码一般全小写或全大写，这种多半是片名里的词。
    // 三个字母的学习语言码（Eng、Spa、Chi……）常这样写，照认；别的当认不准，接着往前看
    if (/^[A-Z][a-z]{1,2}$/.test(r) && !(r.length === 3 && LEARN_BASES.has(ALIAS.get(t)))) { if (ALIAS.has(t)) { amb = true; continue; } break; }
    const b = langOfTag(t);
    if (b === 'und') {
      // 不是语言的词（forced、sdh、web-dl、1080p、S01E05）跳过接着往前看；别的（片名里的词、认不出的短码）就停
      const noise = ALIAS.has(t) || ALIAS.get(t.split(/[-_]/)[0]) === 'und' || /^\d/.test(t);
      if (noise) { saw ||= /^[a-z]{2,3}$/.test(t) && !ALIAS.has(t); continue; }
      if (bracket.includes(raw)) continue;
      break;   // 片名里的词：到头了（不算写了语言）
    }
    saw = true;
    if (b === 'mul') { amb = true; continue; }   // 一段里写了两种（zh-en、GB&ENG、简英）
    // 不是学习语言的两字母码（he、is、it、no、my、to……）和撞上英文词的三字母码（cat、may、ice……）在文件名里
    // 多半是片名里的词：算认不准，不说它是哪种。ita、dut、ukr 这种三字母码、写全了的（Italian）照算
    if (!LEARN_BASES.has(b) && (t.length === 2 || WORDLIKE3.has(t))) { amb = true; continue; }
    langs.add(b);
  }
  // hi：听障字幕和印地语字幕都常见，看不出来。单独出现（Movie.hi.srt）回 []；前后另有语言（Movie.en.hi.srt）多半是听障标志，
  // 可也可能是「英语 + 印地语」双语，印地语也算上（学印地语的不会因此被说成没有字幕，读出来再按内容判）
  if (amb) return [];
  if (hi && langs.size) langs.add('hi');
  if (langs.size) return [...langs];
  return saw || hi ? [] : null;
}

// 外挂字幕名里随便哪一段提到了 lang：上面从后往前看会被片名、地区写法打断
// （Movie.Spanish.LatinAmerica.eng.srt 只看到 eng，Movie.zh-Hans&eng.ass 只认出 eng），只要名字里出现过学习语言就当「可能有」。
// 只用在「缺不缺」上：多认了最多是少问一句，不会把有的说成没有
export function subNameMentions(name, lang) {
  const s = String(name || '').replace(SUB_EXT, '').toLowerCase().normalize('NFC').replace(/̇/g, '');
  if (!s || !lang) return false;
  for (const [w, b] of SUBSTR) if (b === lang && s.includes(w)) return true;
  return s.split(/[^\p{L}\p{N}]+/u).some((w) => w && (ALIAS.get(w) === lang || langOfTag(w) === 'mul'));
}
