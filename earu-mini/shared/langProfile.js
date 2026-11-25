// 12 门学习语言的「语言档案」。每门一行，所有「按语言不同」的规则收在这一处：
// 切词字母、书写方向、大小写、跟读识别码、发音码、注音类型……界面和各模块都只问这里，别在组件里写 learn === 'xx'。
// 纯 ESM、无依赖，Node 和浏览器都能跑。每一列由对应模块填写。
//
// 键 = 学习线（shared/langs.js learnOf：en、zh（简繁共用）、其余是语言自己的代码）。
// 【列的分类】
//   基础列（本文件已填好，只读）：name script letters wordSegment dir caseRule caseLocale stop wordApostrophe nameByCase asr tts speech phonetic
//   预留列（结构留好、值先是 null / 默认）：dictate（听写）quiz（小测）speak（跟读）segment（日、中切词）
//   这几列在文档里写了「谁来填」，不要往地基列里塞自己的规则，也不要新开别的规则表。
//
// letters：字母字符类的【内部】（不含方括号），用来拼 [..] / [^..]。只列这门语言能出现在词里的字母（含附标、重音、变音），不含数字、标点。
//   阿拉伯语的短元音符号、天城文的元音附标、俄语重音符（U+0301）都当字母的一部分，不能把词劈开。
// wordSegment：'space' = 按空格、标点切（拉丁、西里尔、天城文、阿拉伯、韩文）；'dict' = 没有空格，要靠分词（ja、zh；先留接口，见 segment 列）。
// caseRule：'default' 有大小写（用 toLowerCase / toUpperCase）、'tr' 土耳其语（I↔ı、İ↔i，要用 caseLocale 转）、'none' 没有大小写。
// nameByCase：句中大写开头能不能当「这是人名」的线索。德语名词都大写，所以 false；没有大小写的文字也是 false。
// asr：跟读识别（whisper-1）的语言码；tts：AI 朗读的语言 / 口音（给提示词用）；speech：浏览器朗读（speechSynthesis）的语言标记。
// phonetic.on：默认开不开——true 开、false/缺省关；数组 = 只在这几档学习难度（grade）默认开（日语：初级、中级开，高级关）。
// phonetic：注音类型。type ∈ ipa（国际音标）| pinyin | kana（假名）| stress（俄语重音）| harakat（阿语元音符号）| std（韩语标准发音）| iast（印地拉丁转写）| null；
//   where：'sub' 字幕上注、'card' 只在词卡上注；ready：已经有实现了（en 音标、es IPA、zh 拼音）。

const LATIN = 'A-Za-z';
export const LANG_PROFILE = Object.freeze({
  en: {
    name: 'English', script: 'Latin', letters: LATIN, wordSegment: 'space', dir: 'ltr', caseRule: 'default', caseLocale: 'en-US',
    stop: '.!?…\\n', wordApostrophe: true, nameByCase: true,
    asr: 'en', tts: { lang: 'en', accent: 'American' }, speech: 'en-US',
    phonetic: { type: 'ipa', where: 'card', ready: true },
  },
  es: {
    name: 'Spanish', script: 'Latin', letters: `${LATIN}ÁÉÍÓÚÜÑáéíóúüñ`, wordSegment: 'space', dir: 'ltr', caseRule: 'default', caseLocale: 'es',
    stop: '.!?…\\n¿¡', wordApostrophe: true, nameByCase: true,
    asr: 'es', tts: { lang: 'es', accent: 'neutral Latin American' }, speech: 'es-MX',
    phonetic: { type: 'ipa', where: 'card', ready: true },
  },
  de: {
    name: 'German', script: 'Latin', letters: `${LATIN}ÄÖÜẞäöüß`, wordSegment: 'space', dir: 'ltr', caseRule: 'default', caseLocale: 'de',
    stop: '.!?…\\n', wordApostrophe: true, nameByCase: false,   // 德语名词一律大写
    asr: 'de', tts: { lang: 'de', accent: 'standard High German' }, speech: 'de-DE',
    phonetic: { type: 'ipa', where: 'card', ready: false },
  },
  fr: {
    name: 'French', script: 'Latin', letters: `${LATIN}ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸàâæçéèêëîïôœùûüÿ`, wordSegment: 'space', dir: 'ltr', caseRule: 'default', caseLocale: 'fr',
    stop: '.!?…\\n', wordApostrophe: true, nameByCase: true,   // l'homme、j'ai 撇号连着算一个词块，点词时按词标注拆开
    asr: 'fr', tts: { lang: 'fr', accent: 'standard Metropolitan French' }, speech: 'fr-FR',
    phonetic: { type: 'ipa', where: 'card', ready: false },
  },
  pt: {
    name: 'Portuguese', script: 'Latin', letters: `${LATIN}ÁÀÂÃÇÉÊÍÓÔÕÚÜáàâãçéêíóôõúü`, wordSegment: 'space', dir: 'ltr', caseRule: 'default', caseLocale: 'pt',
    stop: '.!?…\\n', wordApostrophe: true, nameByCase: true,
    asr: 'pt', tts: { lang: 'pt', accent: 'neutral Brazilian' }, speech: 'pt-BR',
    phonetic: { type: 'ipa', where: 'card', ready: false },
  },
  tr: {
    name: 'Turkish', script: 'Latin', letters: `${LATIN}ÇĞİÖŞÜÂÎÛçğıöşüâîû`, wordSegment: 'space', dir: 'ltr', caseRule: 'tr', caseLocale: 'tr',
    stop: '.!?…\\n', wordApostrophe: true, nameByCase: true,   // 土耳其语撇号隔开专名和词尾（Ankara'da）
    asr: 'tr', tts: { lang: 'tr', accent: 'standard Istanbul' }, speech: 'tr-TR',
    phonetic: { type: null, where: null, ready: false },
  },
  ru: {
    name: 'Russian', script: 'Cyrillic', letters: 'А-ЯЁа-яё́', wordSegment: 'space', dir: 'ltr', caseRule: 'default', caseLocale: 'ru',
    stop: '.!?…\\n', wordApostrophe: false, nameByCase: true,
    asr: 'ru', tts: { lang: 'ru', accent: 'standard Moscow' }, speech: 'ru-RU',
    phonetic: { type: 'stress', where: 'sub', ready: true, on: true },
  },
  hi: {
    name: 'Hindi', script: 'Devanagari', letters: 'ऀ-ॣॱ-ॿ', wordSegment: 'space', dir: 'ltr', caseRule: 'none', caseLocale: null,
    stop: '.!?…\\n।॥', wordApostrophe: false, nameByCase: false,
    asr: 'hi', tts: { lang: 'hi', accent: 'standard Hindi' }, speech: 'hi-IN',
    phonetic: { type: 'iast', where: 'card', ready: true, on: true },
  },
  ar: {
    name: 'Arabic', script: 'Arabic', letters: 'ء-ٰٟ-ۓە', wordSegment: 'space', dir: 'rtl', caseRule: 'none', caseLocale: null,
    stop: '.!?…\\n؟۔', wordApostrophe: false, nameByCase: false,   // 冠词 ال、连词 و 粘在词前，点词查词典时剥掉
    asr: 'ar', tts: { lang: 'ar', accent: 'Modern Standard Arabic' }, speech: 'ar-SA',
    phonetic: { type: 'harakat', where: 'sub', ready: true, on: true },
  },
  ko: {
    name: 'Korean', script: 'Hangul', letters: '가-힣ᄀ-ᇿ㄰-㆏', wordSegment: 'space', dir: 'ltr', caseRule: 'none', caseLocale: null,
    stop: '.!?…\\n', wordApostrophe: false, nameByCase: false,   // 一个空格段是一个「语节」，助词粘在后面
    asr: 'ko', tts: { lang: 'ko', accent: 'standard Seoul' }, speech: 'ko-KR',
    phonetic: { type: 'std', where: 'sub', ready: true, on: true },
  },
  ja: {
    name: 'Japanese', script: 'Kana+Han', letters: 'ぁ-ゟ゠-ヿㇰ-ㇿ一-鿿々ー', wordSegment: 'dict', dir: 'ltr', caseRule: 'none', caseLocale: null,
    stop: '.!?…\\n。！？', wordApostrophe: false, nameByCase: false,
    asr: 'ja', tts: { lang: 'ja', accent: 'standard Tokyo' }, speech: 'ja-JP',
    phonetic: { type: 'kana', where: 'sub', ready: true, on: ['primary', 'middle'] },
  },
  zh: {
    name: 'Chinese', script: 'Han', letters: '一-鿿㐀-䶿々', wordSegment: 'dict', dir: 'ltr', caseRule: 'none', caseLocale: null,
    stop: '.!?…\\n。！？', wordApostrophe: false, nameByCase: false,
    asr: 'zh', tts: { lang: 'zh', accent: 'standard Mandarin' }, speech: 'zh-CN',
    phonetic: { type: 'pinyin', where: 'sub', ready: true },
  },
});
// ---- 预留列（后面再填；现在都是 null，读的人要容忍 null）----
// dictate：听写。{ kbd: 屏幕字母键（俄、阿、印地要；字符串数组）、judge: 判对规则名、fold: 判对时要抹平的差别 }
// quiz：每日小测。{ freq: 词频来源、pool: 题库名、distract: 干扰项规则 }
// speak：跟读。{ unit, charsPerWord, fold, junk, minRatio, prompt, score }（已填，各项含义见下面 SPEAK 表）
// segment：切词（wordSegment === 'dict' 的 ja、zh）。{ id: 'ai' | 'local' | 'zhSort'、…}，值是函数的话放进 SEGMENTER 注册（下面 registerSegmenter）
const RESERVED = Object.freeze({ dictate: null, quiz: null, speak: null, segment: null });
// ---- 跟读列----
// unit：「听清了没有」和打分比对的单位：'word' 按词（拉丁、西里尔、天城文、阿拉伯、韩文都有空格）、'char' 按字（中、日没有空格）；
// charsPerWord：按字比的语言里，几个字抵一个「词」（题库按词数分难度档、挡长短句，字数换成词数用它）；
// fold：比对前的规范化（speak/fold.js 认这些名字）；lower 用 lowerOf（土耳其语 I/ı）；
// junk：识别服务在没声音时常编出来的套话（字幕署名、求关注、谢谢观看），原句里没有这些话就当没听清（regex 源，flag iu）；
// minRatio：识别结果和原句的相似度低于它判没听清（0 = 不查；幻听成别的话、别的文字）；
// prompt：识别器的中性提示（本语言、不含原句）；
// score：跟读出不出分。12 门都打分（按识别文字逐词 / 逐字比对，写法不同从宽），
//   真人样本校准改成上线后按事件表回查调规则（docs/全语言练习-跟读校准.md）。英语走 score.js 的老规则，别的语言走 speak/compare.js 的通用打分。
//   功能表 speakScore（shared/langs.js）是另一道紧急总开关，两道都开才出分。
// endMark：跟读题库要不要求句尾带句号 / 问号 / 叹号（不写 = 要求）。中日韩的视频字幕习惯不打句号（日语字幕 68 句只有 1 句、
//   中文 14 句只有 2 句带句尾标点），要求了题库就是 0、跟读会天天被跳过，这三门写 false；省略号结尾仍当半句挡掉。
const SPEAK = Object.freeze({
  en: { unit: 'word', charsPerWord: 1, fold: ['lower'], junk: [], minRatio: 0, prompt: 'An English movie line read aloud by a young learner.', score: true },
  es: { unit: 'word', charsPerWord: 1, fold: ['lower', 'accents'], junk: ['subt[ií]tulos|amara\\.org|gracias por (?:ver|vernos|su atenci[oó]n)|suscr[ií]b|no olvides|hasta la pr[oó]xima|dale like|m[uú]sica'], minRatio: 0,
    prompt: 'Una frase de una película leída en voz alta por un estudiante.', score: true },
  de: { unit: 'word', charsPerWord: 1, fold: ['lower', 'accents', 'de'], junk: ['untertitel|amara\\.org|vielen dank f[üu]r(?:s)? (?:das )?(?:zuschauen|ihre aufmerksamkeit)|abonnier'], minRatio: 0.2,
    prompt: 'Ein Filmsatz, von einem Lernenden laut vorgelesen.', score: true },
  fr: { unit: 'word', charsPerWord: 1, fold: ['lower', 'accents'], junk: ["sous-titr|amara\\.org|merci d'avoir regard|abonnez-vous"], minRatio: 0.2,
    prompt: 'Une phrase de film lue à voix haute par un apprenant.', score: true },
  pt: { unit: 'word', charsPerWord: 1, fold: ['lower', 'accents'], junk: ['legendas?|amara\\.org|obrigad[oa] por assistir|inscreva-se'], minRatio: 0.2,
    prompt: 'Uma frase de filme lida em voz alta por um estudante.', score: true },
  tr: { unit: 'word', charsPerWord: 1, fold: ['lower', 'tr'], junk: ['altyaz[ıi]|amara\\.org|izledi[ğg]iniz i[çc]in te[şs]ekk[üu]r|abone ol'], minRatio: 0.2,
    prompt: 'Bir öğrencinin yüksek sesle okuduğu bir film cümlesi.', score: true },
  ru: { unit: 'word', charsPerWord: 1, fold: ['lower', 'ru'], junk: ['субтитр|amara\\.org|спасибо за просмотр|подписывайтесь|редактор субтитров'], minRatio: 0.2,
    prompt: 'Фраза из фильма, прочитанная вслух учеником.', score: true },
  hi: { unit: 'word', charsPerWord: 1, fold: ['hi'], junk: ['सब्सक्राइब|उपशीर्षक|amara\\.org|देखने के लिए धन्यवाद'], minRatio: 0.2,
    prompt: 'एक फ़िल्म का संवाद, जिसे एक विद्यार्थी ने ज़ोर से पढ़ा।', score: true },
  ar: { unit: 'word', charsPerWord: 1, fold: ['ar'], junk: ['ترجمة|اشترك|شكرا (?:لك|لكم) على المشاهدة|amara\\.org'], minRatio: 0.2,
    prompt: 'جملة من فيلم يقرؤها متعلم بصوت عال.', score: true },
  ko: { unit: 'word', charsPerWord: 1, endMark: false, fold: ['ko'], junk: ['시청해 주셔서|구독|자막|amara\\.org'], minRatio: 0.2,
    prompt: '학습자가 소리 내어 읽은 영화 대사입니다.', score: true },
  ja: { unit: 'char', charsPerWord: 2, endMark: false, fold: ['ja'], junk: ['ご視聴ありがとう|チャンネル登録|字幕|amara\\.org'], minRatio: 0.2,
    prompt: '学習者が声に出して読んだ映画のセリフ。', score: true },
  zh: { unit: 'char', charsPerWord: 2, endMark: false, fold: ['zh'], junk: ['字幕|订阅|訂閱|谢谢观看|謝謝觀看|请不吝点赞|請不吝點贊|amara\\.org'], minRatio: 0.2,
    prompt: '一句电影台词，由学习者朗读。', score: true },
});
for (const k of Object.keys(LANG_PROFILE)) Object.assign(LANG_PROFILE[k], { learn: k, ...RESERVED, speak: SPEAK[k] || null });

// ---- dictate 列（听写）----
// 听写判对、选词、输入辅助的「按语言不同」全收在这一列；core/dictation/langRules.js 读它生成判词规则，别在别处写 lang === 'xx'。
//   norm   比较前两边都做的整理（顺序：NFC → 撇号 → strip → equiv → 小写（按 caseRule，土耳其语 I→ı）→ 数字写法 → fold）：
//     strip  要抹掉的字符（字符类内部）：俄语重音符 U+0301、阿语元音符号和拉长符；
//     equiv  完全等同的字（不标黄）：俄语 ё = е；
//     digits 把阿拉伯-印度数字、天城文数字换成 0-9；
//     fold   'han' 繁简互换算对（逐字繁转简）｜'kana' 日语：全角半角、平假名片假名同一个（NFKC + 片转平）
//     thousands 千分位写法：不写＝点（欧洲 1.000 = 1000）｜','＝逗号（中日韩 5,000 = 5000，问题记录 DT-1，11-15）
//   slip   漏打 / 换写也算对，但那个词标黄、显示正确拼法（和西语少打重音一致）：{正确字: [可接受的打法…]}，空串 = 可以不打。
//          没写在表里的差别一律算错（西语 ñ、法语 ç、葡语 ã õ、土耳其语 ş ğ ç ö ü ı 是另一个字母，不是重音）
//   chars  美式键盘打不出的字母按钮（拉丁字母语言）；kbd 屏幕字母键，按行排（俄、阿、印地：电脑没装这门文字的输入法也能答）
//   ime    靠系统输入法拼写（韩、日、中）：拼写过程中（composition）不判、不吞字，上屏后才进格子
//   marks  词两端的组合记号（元音符号、天城文元音附标）是词的一部分，不当标点剥掉
//   names  人名线索（只对 nameByCase 的语言有用）：contractions 英语 I'm 一类不当人名；notNames 句中大写但不是人名的词（称呼、神）、abbr 后面的句号不算句末的缩写、quote 开引号字符（引号里的话开头也是句首）
const LATIN_QUOTE = '"“‘';
export const DICTATE = Object.freeze({
  en: { norm: {}, slip: {}, chars: [], kbd: null, ime: false, marks: false, names: { notNames: ['i', 'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'madam', 'mom', 'dad', 'mommy', 'daddy', 'mama', 'papa', 'grandma', 'grandpa', 'god', 'ok'], abbr: ['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'vs', 'mt', 'gen', 'sgt', 'capt', 'col', 'lt', 'rev', 'hon', 'inc', 'ltd', 'co', 'dept', 'etc', 'no'], quote: LATIN_QUOTE, contractions: true } },
  es: {
    norm: {}, slip: { 'á': ['a'], 'é': ['e'], 'í': ['i'], 'ó': ['o'], 'ú': ['u'], 'ü': ['u'] },
    chars: ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'], kbd: null, ime: false, marks: false,
    names: { notNames: ['señor', 'señora', 'señorita', 'sr', 'sra', 'srta', 'don', 'doña', 'dr', 'dra', 'prof', 'profesor', 'profesora', 'dios', 'mamá', 'papá', 'abuela', 'abuelo', 'ok'], abbr: ['sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'lic', 'ing', 'av', 'jr', 'vs', 'gral', 'cap', 'tte', 'etc', 'no', 'núm'], quote: `${LATIN_QUOTE}«¿¡` },
  },
  de: {
    // ä ö ü 漏点（a o u）或按键盘习惯写 ae oe ue、ß 写 ss：算对标黄；别的写错算错
    norm: {}, slip: { 'ä': ['a', 'ae'], 'ö': ['o', 'oe'], 'ü': ['u', 'ue'], 'ß': ['ss'] },
    chars: ['ä', 'ö', 'ü', 'ß'], kbd: null, ime: false, marks: false,
    names: { quote: `${LATIN_QUOTE}„»«` },   // 德语名词一律大写，nameByCase 为 false，不按大写认人名；这里只留给引号判断
  },
  fr: {
    // 重音漏打算对标黄、打错（é 打成 è）算错；ç 是另一个字母、漏打算错；œ æ 允许写成 oe ae
    norm: {}, slip: { 'é': ['e'], 'è': ['e'], 'ê': ['e'], 'ë': ['e'], 'à': ['a'], 'â': ['a'], 'î': ['i'], 'ï': ['i'], 'ô': ['o'], 'û': ['u'], 'ù': ['u'], 'ü': ['u'], 'ÿ': ['y'], 'œ': ['oe'], 'æ': ['ae'] },
    chars: ['é', 'è', 'ê', 'à', 'â', 'î', 'ô', 'û', 'ù', 'ç', 'ë', 'ï', 'œ'], kbd: null, ime: false, marks: false,
    names: { notNames: ['monsieur', 'madame', 'mademoiselle', 'docteur', 'professeur', 'maître', 'dieu', 'maman', 'papa', 'mamie', 'papi', 'm', 'mme', 'mlle', 'dr', 'pr', 'ok'], abbr: ['m', 'mme', 'mlle', 'dr', 'pr', 'mgr', 'st', 'ste', 'etc', 'cf', 'vs', 'av', 'bd'], quote: `${LATIN_QUOTE}«` },
  },
  pt: {
    // 重音漏打算对标黄；ã õ（鼻音）和 ç 是另一个字母，漏打算错（同西语 ñ）
    norm: {}, slip: { 'á': ['a'], 'à': ['a'], 'â': ['a'], 'é': ['e'], 'ê': ['e'], 'í': ['i'], 'ó': ['o'], 'ô': ['o'], 'ú': ['u'], 'ü': ['u'] },
    chars: ['á', 'à', 'â', 'ã', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú', 'ç'], kbd: null, ime: false, marks: false,
    names: { notNames: ['senhor', 'senhora', 'senhorita', 'dona', 'doutor', 'doutora', 'professor', 'professora', 'deus', 'mamãe', 'papai', 'vovó', 'vovô', 'sr', 'sra', 'dr', 'dra', 'ok'], abbr: ['sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'av', 'etc', 'vs', 'ltda', 'núm'], quote: `${LATIN_QUOTE}«` },
  },
  tr: {
    // ı / i / İ、ş ğ ç ö ü 都是不同的字母，漏打算错；只有长音符 â î û（外来词）漏打算对标黄。大小写按土耳其语（I→ı、İ→i）
    norm: {}, slip: { 'â': ['a'], 'î': ['i'], 'û': ['u'] },
    chars: ['ı', 'İ', 'ş', 'ğ', 'ö', 'ü', 'ç'], kbd: null, ime: false, marks: false,
    names: { notNames: ['bey', 'hanım', 'hanim', 'efendi', 'abi', 'abla', 'anne', 'baba', 'tanrı', 'allah', 'dr', 'prof', 'sayın', 'ok'], abbr: ['dr', 'prof', 'doç', 'sn', 'bkz', 'vb', 'vs', 'no', 'st'], quote: `${LATIN_QUOTE}»«` },
  },
  ru: {
    // ё 和 е 视为相同（俄语平时不写两点）；重音符 U+0301 不判；й 是单独字母不动
    norm: { strip: '́', equiv: { 'ё': 'е' } }, slip: {},
    chars: [], kbd: [[...'йцукенгшщзхъ'], [...'фывапролджэ'], [...'ячсмитьбюё']], ime: false, marks: true,
    names: { notNames: ['господин', 'госпожа', 'доктор', 'профессор', 'мама', 'папа', 'бабушка', 'дедушка', 'бог', 'ок'], abbr: ['г', 'гг', 'ул', 'тов', 'проф', 'им', 'т', 'д'], quote: `${LATIN_QUOTE}«„` },
  },
  ar: {
    // 不写元音符号：短元音附标（U+064B–U+0652、U+0670）和拉长符 ـ（U+0640）两边都抹掉；阿拉伯-印度数字当 0-9
    norm: { strip: 'ً-ٰٟـ', digits: true }, slip: {},
    chars: [], kbd: [[...'ضصثقفغعهخحجد'], [...'شسيبلاتنمكط'], [...'ئءؤرىةوزظذ'], [...'أإآ']], ime: false, marks: true,
    names: {},
  },
  hi: {
    // 天城文：NFC 后比；漏打 nukta（़，ज़ → ज）算对标黄；数字 ०-९ 当 0-9；元音附标留在词尾
    norm: { digits: true }, slip: { '़': [''] },
    chars: [], kbd: [
      [...'अआइईउऊऋएऐओऔ'],
      [...'ािीुूृेैोौंँः़्'],
      [...'कखगघङचछजझञ'],
      [...'टठडढणतथदधन'],
      [...'पफबभमयरलवशषसह'],
      ['ळ', 'क्ष', 'त्र', 'ज्ञ', 'ड़', 'ढ़', 'ज़', 'फ़'],
    ], ime: false, marks: true,
    names: {},
  },
  ko: { norm: { thousands: ',' }, slip: {}, chars: [], kbd: null, ime: true, marks: true, names: {} },   // 韩文输入法；空格位置不判（一格一个语节）
  ja: {
    // 汉字写法和读音的假名写法都算对（读音由切词器给；平假名、片假名同一个）
    norm: { fold: 'kana', thousands: ',' }, slip: {}, chars: [], kbd: null, ime: true, marks: true, names: {},
  },
  zh: {
    // 听写打汉字：繁简互换算对；同音字（别的汉字）判错
    norm: { fold: 'han', thousands: ',' }, slip: {}, chars: [], kbd: null, ime: true, marks: true, names: {},
  },
});
for (const k of Object.keys(LANG_PROFILE)) LANG_PROFILE[k].dictate = DICTATE[k] ?? null;

// ---- 小测列（难度分级）----
// quiz = { pos: 能当「单词」考的词性（词典 kaikki 词性名；专名 name 不在内 = 地名、人名不出题，也不进干扰项）
//          fold: 干扰项比拼写前的折叠：'latin' 小写后去音符、'lower' 只小写（俄语：й / ё 不能抹）、'none' 原样（天城文、谚文、假名、汉字：抹了会改词）
//          phon: 听音选词比读音用什么：'ipa' 词典的读音（西语词典没有时再按拼写算）、'none' 词典没有读音（中、日：退回字形相近，注音接好后挂 registerQuizPhonetic）
//          swear: 手写的粗口表（只有西语留着旧表，其他门词典不管脏话，小测 AI 出题时再处理）
//          lexMax: 干扰项词表只取名次前多少（词典有 9 万词的门不全拿来比；0 = 不限）
//          level: 难度尺子（以语速为主）{ unit: 'word' 每分钟词数 | 'char' 每分钟字数, mw / sw: 这种语速的均值和标准差, maxps: 字幕条每秒超过多少个单位当时间写短了跳过（默认 6） }
//                 由 server/src/levelRate.js 读；数值出处见 docs/全语言练习-小测与难度.md }
const QUIZ_POS = Object.freeze(['noun', 'verb', 'adj', 'adv']);
const mkQuiz = (o) => Object.freeze({ pos: QUIZ_POS, fold: 'latin', phon: 'ipa', swear: Object.freeze([]), lexMax: 40000, ...o, level: Object.freeze(o.level) });
const QUIZ = {
  en: mkQuiz({ lexMax: 0, level: { unit: 'word', mw: 173.65, sw: 28.45 } }),
  es: mkQuiz({
    lexMax: 0, level: { unit: 'word', mw: 155.4, sw: 29.6 },
    swear: ['mierda', 'joder', 'jodido', 'coño', 'puta', 'puto', 'putada', 'cabrón', 'cabron', 'carajo', 'pendejo', 'pendeja', 'gilipollas',
      'hostia', 'polla', 'verga', 'chingar', 'chingada', 'chingado', 'maricón', 'marica', 'follar', 'cojones', 'capullo', 'zorra', 'culo', 'pinche',
      'mamón', 'mamada', 'huevón', 'boludo', 'pajero', 'cagar', 'cagada', 'coñazo'],
  }),
  de: mkQuiz({ level: { unit: 'word', mw: 150.5, sw: 32.5 } }),
  fr: mkQuiz({ level: { unit: 'word', mw: 169.7, sw: 40.1 } }),
  pt: mkQuiz({ level: { unit: 'word', mw: 155, sw: 32.1 } }),
  tr: mkQuiz({ level: { unit: 'word', mw: 120.2, sw: 21.7 } }),
  ru: mkQuiz({ fold: 'lower', level: { unit: 'word', mw: 119.9, sw: 27, maxps: 5 } }),
  ar: mkQuiz({ level: { unit: 'word', mw: 118, sw: 28 } }),
  hi: mkQuiz({ fold: 'none', level: { unit: 'word', mw: 130, sw: 30, estimated: true } }),   // 印地语还没有语速数据：先按估计值，有了数据再校
  ko: mkQuiz({ fold: 'none', level: { unit: 'char', mw: 267.4, sw: 56.3, maxps: 12 } }),
  ja: mkQuiz({ fold: 'none', phon: 'none', level: { unit: 'char', mw: 295, sw: 71.3, maxps: 15 } }),
  zh: mkQuiz({ fold: 'none', phon: 'none', level: { unit: 'char', mw: 250, sw: 55, maxps: 12 } }),   // 简体 243 / 58、繁体 278 / 45，合起来取整
};
for (const k of Object.keys(QUIZ)) if (LANG_PROFILE[k]) LANG_PROFILE[k].quiz = QUIZ[k];

export const PROFILE_LANGS = Object.freeze(Object.keys(LANG_PROFILE));
export const hasProfile = (learn) => Object.hasOwn(LANG_PROFILE, learn);
// 这条学习线的档案；不认得的（null、没选过）当英语，和 learnOf 一致
export const profileOf = (learn) => (hasProfile(learn) ? LANG_PROFILE[learn] : LANG_PROFILE.en);

export const isRtlLearn = (learn) => profileOf(learn).dir === 'rtl';

// ---- 大小写：用语言自己的规则（土耳其语 I → ı、İ → i）----
export const lowerOf = (learn, s) => {
  const p = profileOf(learn);
  const str = String(s ?? '');
  return p.caseRule === 'none' ? str : p.caseRule === 'tr' ? str.toLocaleLowerCase('tr') : str.toLowerCase();
};
export const upperOf = (learn, s) => {
  const p = profileOf(learn);
  const str = String(s ?? '');
  return p.caseRule === 'none' ? str : p.caseRule === 'tr' ? str.toLocaleUpperCase('tr') : str.toUpperCase();
};

// ---- 字母正则：每次新建，带 g 的没有 lastIndex 串用的问题 ----
const WORD_APOS = (L) => `[${L}]+(?:['’][${L}]+)*`;

// ---- 共用的排序切词（shared/sortText.js）----
// 排序题把一句台词切成词块：拉丁、西里尔、天城文、阿拉伯、韩文这几种按空格分词的文字都认；日文假名汉字、中文不认（它们没有空格，
// 由 segment 列的接口另切，现在的中文排序走 shared/zhSort.js，日语等另行接入）。
// 拉丁字母沿用原来的 \p{Script=Latin}（原正则一个字不改，英语、西语、中文台词里夹的拉丁词切法不变）；
// 其余文字带上 \p{M}（组合附标：元音符号、天城文附标、俄语重音）、用 Script 判断，不依赖具体字母表。
// 孤立的组合附标不开新词：Arabic / Devanagari 要字母开头，后面才跟附标
export const SORT_WORD_SOURCES = Object.freeze({
  Latin: String.raw`\p{Script=Latin}+(?:['’]\p{Script=Latin}+)?`,
  Cyrillic: String.raw`(?:\p{Script=Cyrillic}\p{M}*)+(?:['’](?:\p{Script=Cyrillic}\p{M}*)+)?`,
  Devanagari: String.raw`\p{Script=Devanagari}(?:\p{Script=Devanagari}|\p{M})*`,
  Arabic: String.raw`\p{Script=Arabic}(?:\p{Script=Arabic}|\p{M})*`,
  Hangul: String.raw`\p{Script=Hangul}+`,
});
export const SORT_WORD_SOURCE = Object.values(SORT_WORD_SOURCES).join('|');

// ---- 日语、中文切词的接口（现在没有实现）----
// 日语注册：registerSegmenter('ja', (text) => [{ text, w: true, … }, …])；
// segmenterOf 没注册回 null，调用方遇到 null 就按「这句不出题」处理（切不出词不硬凑）。
const SEGMENTERS = new Map();
export const registerSegmenter = (learn, fn) => { if (typeof fn === 'function') SEGMENTERS.set(learn, fn); else SEGMENTERS.delete(learn); };
export const segmenterOf = (learn) => SEGMENTERS.get(learn) || null;
