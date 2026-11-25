// 日文切词：词（点词查词卡、生词本）、词块（排序题）、词卡查询用的原形候选。
// 纯 ESM、无依赖；Node 和新版浏览器都有 Intl.Segmenter('ja')，没有时退回「按文字种类连成一串」。
//
// 先评估过：Intl.Segmenter('ja', word) 切名词、汉字词还行（映画 / 友達 / 一緒），但对活用和假名连写切得很碎：
//   食|べた|く|なか|っ|た、おい|しか|っ|た、行|っ|ちゃ|っ|た、そう|なんで|すか。不够直接用，所以在它的结果上做两层合并，规则全在这个文件里：
//
// 第一层「词」（点词用）：自立的一段 + 紧跟的活用碎片合成一个词。
//   · 碎片：紧跟在汉字结尾的词后面、全是平假名的短段（食|べた、行|き、飲|んで），或 INFL 表里的活用尾巴（ま し た ない なかっ て れ られ せ ず …）；
//   · 助词（は が を に へ と も の で から まで …，P 表）、判断助动词（だ です でし …，F 表）各自成词；
//   · 「数字 + 量词」（3 人、三人、2 時）合成一个词；
//   · 助词有时其实是活用的一部分（行|か|なか|っ|た 的「か」、おい|しか|っ|た 的「しか」）：它后面紧跟 NEXT_INFL 里的碎片（なか ない っ た て れ せ ず …）就按碎片算。
// 第二层「词块」（排序题用，不要太碎）：一个词块 = [お / ご / この 这类前缀] + 自立词 + 后面所有助词、助动词（P、F 连着粘），
//   到下一个自立词、标点、空格为止：「私は」「昨日」「友達と」「一緒に」「映画を」「見に」「行きました」「綺麗な」「人ですね」。
//   助词后面再来的假名词（とても、もう）是新词块；句首的助词自己一块；标点不进词块（留在原文里当固定文字）；
//   中点「・」连着的片假名（ジョン・スミス）、全角半角数字连着的算一块。
// 词块是照原文切的：每一块都是原文里连续的一段，拼起来盖住原文所有的字母数字。
//
// 词卡词典（ja.db）只有原形，没有活用形：词卡查询前用 jaLemmaCandidates 由活用形推原形候选（行かなかった → 行く）再逐个查，查到哪个用哪个。
// 切错一块不会坏题（判对逐位比文字），只是词块粗细不同；词块数由同一份代码现算。
//
// 【版本号】改了这里影响「切出哪些块、几块」的规则，把 SEG_VER_JA 加一。
import { sortTextZhMap, alignWords } from '../zhSort.js';
import { keyOf } from '../zhText.js';
export const SEG_VER_JA = 'js1';

const KANJI = /[㐀-鿿々〆ヵヶ]/u;
const KANA_H = /^[ぁ-ゟ]+$/u;
const LETTER = /[\p{L}\p{N}]/u;
const LAST_KANJI = /[㐀-鿿々〆]$/u;
const DIGITS = /^[0-9０-９]+(?:[.,．，][0-9０-９]+)*$/;
const KANJI_NUM = /^[〇一二三四五六七八九十百千万億兆両]+$/u;
const COUNTERS = new Set([...'人個回本枚台年月日時分秒歳匹冊杯階番円度倍件秒名組']);

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));
// 助词（格助词、提示、并列、语气）：粘在前面的词后面
const P = set('は が を に へ と も の や で から まで より だけ しか ばかり ほど くらい ぐらい など なんて って とか けど けれど けれども ので のに し ば ながら こそ さえ すら には では とは へは からは までは にも でも とも のは のが のを と が よ ね ぞ ぜ わ さ な か かな かしら もん もの っけ すか よね かね だよ');
// 判断助动词、敬体：是名词 / 形容动词后面的尾巴，粘在前面的词块上，词典里单独有条目（です、だ），所以单独成词
const F = set('だ です でし でした だっ だった でしょう でしょ だろう だろ じゃ じゃない ではない ません でしたら');
// 活用碎片：粘在前面的词上合成一个词
const INFL = set('ま ませ まし ました ます ましょ ましょう ない なかっ なかった なく なけ なけれ なき なきゃ たい たかっ たく たら たり た て ん ず ぬ れ れる られ られる せ せる させ させる っ ちゃ ちゃっ ちゃう ちゃい ちゃった じゃっ う よう こう した して しょう せん す てる てい ている でる てた なか く かっ けれ');
// 助词后面紧跟这些碎片时，那个「助词」其实是活用的一部分
const NEXT_INFL = set('なか ない なく なけ なき なきゃ せ せる れ れる られ ず ぬ ん っ た て ちゃ ま さ');
// 助词的开头后面紧跟 NEXT_INFL 才改判，这些单字助词不改判（「と」「の」「も」「は」「を」「へ」「や」「ね」「よ」后面接别的不会是活用）
const FLIPPABLE = set('か が さ た な ば ま ら わ し しか に で ぬ');
// て 形后面的补助动词（見ている、食べてしまった）：粘在 て/で 后面的词上
const TE_AUX = set('い いる いた いて います いません いない いれ おり おる しまっ しまう しまい しまった ちゃっ いく いっ いった くる き きた こ みる み みて みた おく おい おけ あげ あげる あげた もらっ もらう くれ くれる くれた ください ほしい');
// 连体词、前缀：粘在后面的词上
const REN = set('この その あの どの こんな そんな あんな どんな おかしな 大きな 小さな お ご 御');
// 假名自立词：紧跟汉字词也不当碎片
const KANA_WORDS = set('とても ちょっと もう まだ ここ そこ あそこ どこ だれ なに なん いつ どう こう そう ああ はい いいえ ええ うん ねえ ねぇ あの この その どの みんな たくさん いろいろ ずっと きっと やっと すぐ また でも だから しかし それ これ あれ どれ ただ たぶん もし まず さあ ほら おい ねえ あっ えっ');

const seg = (() => {
  let cached;
  return () => {
    if (cached === undefined) {
      try {
        cached = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
      } catch { cached = null; }
    }
    return cached;
  };
})();

// 没有 Intl.Segmenter：按文字种类连成一串（汉字串、平假名串、片假名串、拉丁字母串、数字串），标点和空白各自一段
function runs(text) {
  const out = [];
  const kind = (c) => (KANJI.test(c) ? 'k' : /[ぁ-ゟ]/.test(c) ? 'h' : /[゠-ヿー]/.test(c) ? 'c' : /\p{N}/u.test(c) ? 'n' : /\p{L}/u.test(c) ? 'l' : 'x');
  let a = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || kind(text[i]) !== kind(text[a]) || kind(text[a]) === 'x') {
      out.push({ t: text.slice(a, i), s: a, e: i, w: kind(text[a]) !== 'x' });
      a = i;
    }
  }
  return out;
}

// 原文 → [{t, s, e, w}]（Intl 的原始段，w = 是不是词）
function rawTokens(text) {
  const sg = seg();
  if (!sg) return runs(text);
  try {
    const out = [];
    for (const x of sg.segment(text)) out.push({ t: x.segment, s: x.index, e: x.index + x.segment.length, w: !!x.isWordLike && LETTER.test(x.segment) });
    return out;
  } catch { return runs(text); }
}

const isKanaOnly = (t) => KANA_H.test(t);
const lastIsKanji = (t) => LAST_KANJI.test(t);

// ---- 第一层：词 ----
// → [{t, s, e, w, cls}]，盖住原文每个字；cls：'c' 自立词 'p' 助词 'f' 助动词（判断）'x' 标点空白 'r' 前缀 / 连体词
function wordsOf(text) {
  const toks = rawTokens(text);
  const out = [];
  const push = (t, cls) => out.push({ t: t.t, s: t.s, e: t.e, w: cls !== 'x', cls });
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    const prev = out[out.length - 1];
    if (!t.w) { push(t, 'x'); continue; }
    const glueOk = prev && prev.e === t.s && (prev.cls === 'c' || prev.cls === 'frag');
    const next = toks[i + 1];
    // 数字 + 量词
    if (prev && prev.e === t.s && prev.cls === 'c' && (DIGITS.test(prev.t) || KANJI_NUM.test(prev.t)) && t.t.length === 1 && COUNTERS.has(t.t)) {
      prev.t += t.t; prev.e = t.e; continue;
    }
    // 助词改判成活用碎片：行|か|なか|っ|た
    const flips = FLIPPABLE.has(t.t) && next && next.s === t.e && next.w && NEXT_INFL.has(next.t);
    if (glueOk && ((t.t === 'で' && /ん$/.test(prev.t)) || INFL.has(t.t) || (P.has(t.t) && flips))) {
      prev.t += t.t; prev.e = t.e; prev.cls = 'frag'; continue;
    }
    if (P.has(t.t)) { push(t, 'p'); continue; }
    if (F.has(t.t)) { push(t, 'f'); continue; }
    // 汉字结尾的词后面紧跟的平假名短段：送り仮名（食|べた、行|き、飲|んで）
    if (glueOk && prev.cls !== 'frag' && lastIsKanji(prev.t) && isKanaOnly(t.t) && t.t.length <= 4 && !KANA_WORDS.has(t.t) && !REN.has(t.t)) {
      prev.t += t.t; prev.e = t.e; prev.cls = 'frag'; continue;
    }
    // て 形后面的补助动词（見|て|いる、食べ|て|しまっ|た）
    if (glueOk && /[てで]$/.test(prev.t) && TE_AUX.has(t.t)) { prev.t += t.t; prev.e = t.e; prev.cls = 'frag'; continue; }
    push(t, REN.has(t.t) ? 'r' : 'c');
  }
  // frag 就是自立词
  for (const w of out) if (w.cls === 'frag') w.cls = 'c';
  return out;
}

// 对外的「词」：{text, s, e, w}。拼起来就是原文（标点、空白也在，w:false）
export function segmentJa(text) {
  const s = typeof text === 'string' ? text : '';
  return wordsOf(s).map((x) => ({ text: x.t, s: x.s, e: x.e, w: x.w }));
}

// ---- 第二层：词块 ----
// → [{t, s, e}]：排序题的词块（原文连续的一段），不含标点
export function tilesJa(text) {
  const s = typeof text === 'string' ? text : '';
  const ws = wordsOf(s);
  const tiles = [];
  let open = null;       // 当前词块
  let closed = false;    // 已经收了助词：只再接助词、助动词
  let wantNext = false;  // 前缀 / 连体词：后面那个词并进来
  let dot = false;       // 刚过了一个中点（ジョン・スミス）：后面的词并进来
  const close = () => { if (open) tiles.push(open); open = null; closed = false; wantNext = false; dot = false; };
  for (const w of ws) {
    if (w.cls === 'x') {
      if (open && open.e === w.s && /^[・･·]$/.test(w.t)) { open.e = w.e; dot = true; continue; }
      close();
      continue;
    }
    const adj = open && open.e === w.s;
    if (adj && (wantNext || dot)) { open.e = w.e; wantNext = false; dot = false; continue; }
    if (adj && (w.cls === 'p' || w.cls === 'f')) { open.e = w.e; closed = true; continue; }
    close();
    open = { s: w.s, e: w.e };
    if (w.cls === 'r') wantNext = true;
    if (w.cls === 'p' || w.cls === 'f') closed = true;
  }
  close();
  return tiles.map((t) => ({ t: s.slice(t.s, t.e), s: t.s, e: t.e }));
}

// 词块：有 AI 词块（对得回原文）用它们，不然本机切。计分数块（server/src/practice.js）和出题都走这里，两边数出来一样
function tilesOf(s, words) {
  const spans = words == null ? null : alignWords(s, words);
  if (spans && spans.length && keyOf(spans.map((x) => s.slice(x.s, x.e)).join('')) === keyOf(s)) return spans.map((x) => ({ t: s.slice(x.s, x.e), s: x.s, e: x.e }));
  return tilesJa(s);
}

// 这句有几个词块（计分用，口径同以前：不剥说话人标签）；words 同 jaPuzzleParts
export const tileCountJa = (text, words = null) => tilesOf(typeof text === 'string' ? text : '', words).length;

// ---- 词卡用：活用形 → 原形候选 ----
// 词典只有原形（ja.db 的 k）。这里按常见活用规则往回推，返回【可能的原形】，第一个是原词本身；调用方逐个去词典里查、查到就用。
// 多推几个没关系（查不到的丢掉）。覆盖：ます形 / ない形 / て・た形 / 辞書形的 う段 / 可能 · 受身 · 使役 / 意向 / い形容词的 く · かった · くない · ければ / 一段动词 · サ変 · カ変。
const GODAN_I = { い: 'う', き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', び: 'ぶ', み: 'む', り: 'る' };
const GODAN_A = { わ: 'う', か: 'く', が: 'ぐ', さ: 'す', た: 'つ', な: 'ぬ', ば: 'ぶ', ま: 'む', ら: 'る' };
const GODAN_E = { え: 'う', け: 'く', げ: 'ぐ', せ: 'す', て: 'つ', ね: 'ぬ', べ: 'ぶ', め: 'む', れ: 'る' };
const GODAN_O = { お: 'う', こ: 'く', ご: 'ぐ', そ: 'す', と: 'つ', の: 'ぬ', ぼ: 'ぶ', も: 'む', ろ: 'る' };

export function jaLemmaCandidates(word) {
  const w = String(word ?? '').normalize('NFC');
  const out = [];
  const add = (x) => { if (x && x !== w && !out.includes(x)) out.push(x); };
  // 把词尾 suffix 换成别的：「行かなかった」→ 去掉「なかった」得到「行か」
  const strip = (suf) => (w.length > suf.length && w.endsWith(suf) ? w.slice(0, -suf.length) : null);
  const fromStem = (stem, map) => {   // 词干的最后一个假名按行换回う段
    if (!stem) return;
    const last = stem.slice(-1);
    if (map[last]) add(stem.slice(0, -1) + map[last]);
  };
  const ichidan = (stem) => { if (stem) add(`${stem}る`); };
  // 一般：不管哪种形，先试把尾巴拆掉得到的词干
  const stems = [];
  const TAILS = [
    // [尾巴, 词干类型]：i = い段（ます形、连用）a = あ段（ない形）e = え段（可能、命令、ば）o = お段（意向）
    ['ませんでした', 'i'], ['ませんでし', 'i'], ['ました', 'i'], ['ません', 'i'], ['ましょう', 'i'], ['まして', 'i'], ['ます', 'i'], ['たくなかった', 'i'], ['たくなかっ', 'i'], ['たかった', 'i'], ['たくない', 'i'], ['たくて', 'i'], ['たい', 'i'], ['ながら', 'i'], ['そう', 'i'],
    ['なかったら', 'a'], ['なかった', 'a'], ['なくて', 'a'], ['なければ', 'a'], ['なきゃ', 'a'], ['ないで', 'a'], ['ない', 'a'], ['なく', 'a'], ['せられ', 'a'], ['させられ', 'a'], ['られる', 'a'], ['れる', 'a'], ['せる', 'a'], ['ず', 'a'], ['ぬ', 'a'], ['ん', 'a'],
    ['れば', 'e'], ['れ', 'e'], ['よう', 'o'], ['う', 'o'],
  ];
  for (const [suf, t] of TAILS) { const st = strip(suf); if (st) stems.push([st, t]); }
  for (const [st, t] of stems) {
    if (t === 'i') { fromStem(st, GODAN_I); ichidan(st); }
    if (t === 'a') { fromStem(st, GODAN_A); ichidan(st); if (/^.*(し|さ)$/.test(st)) add(`${st.slice(0, -1)}する`); if (/来|こ$/.test(st)) add(`${st.slice(0, -1)}来る`); }
    if (t === 'e') { fromStem(st, GODAN_E); ichidan(st); }
    if (t === 'o') { fromStem(st, GODAN_O); ichidan(st); }
  }
  // サ変、カ変
  for (const [suf, base] of [['します', 'する'], ['しました', 'する'], ['しません', 'する'], ['した', 'する'], ['して', 'する'], ['しない', 'する'], ['しなかった', 'する'], ['してる', 'する'], ['している', 'する'], ['している', 'する'], ['できる', 'する'], ['しよう', 'する'],
    ['来ます', '来る'], ['来た', '来る'], ['来て', '来る'], ['来ない', '来る'], ['来なかった', '来る'], ['きます', 'くる'], ['きた', 'くる'], ['きて', 'くる'], ['こない', 'くる'], ['こなかった', 'くる']]) {
    const st = strip(suf);
    if (st !== null) { add(st + base); if (base === "する") add(st); }
    else if (w === suf) add(base);
  }
  // する 的进行体（11-13）：单独的「しています」先推到 する，别让后面的规则先推出「しう」这类错词。
  // 前面带词干的（勉強しています / 話しています / 表してます）只在候选最后补「〜する」：先让「話す」「表す」查，查不到才轮到「勉強する」
  // こう / そう / ああ / どう＋して…（そうしてます）直接推到「そうする」：不然「そう」＋す 推出词典里的「そうす（奏す）」抢在前面
  let suruLate = null;
  for (const suf of ['しています', 'していました', 'していません', 'していた', 'していない', 'してた', 'してます', 'してました', 'してません']) {
    if (w === suf) add('する');
    else {
      const st = strip(suf);
      if (st && /^(?:こう|そう|ああ|どう)$/u.test(st)) add(`${st}する`);
      else if (st && !suruLate) suruLate = `${st}する`;
    }
  }
  // て・た形
  const te = [['って', ['う', 'つ', 'る']], ['った', ['う', 'つ', 'る']], ['んで', ['む', 'ぶ', 'ぬ']], ['んだ', ['む', 'ぶ', 'ぬ']], ['いて', ['く']], ['いた', ['く']], ['いで', ['ぐ']], ['いだ', ['ぐ']], ['して', ['す']], ['した', ['す']]];
  for (const [suf, ends] of te) {
    const st = strip(suf);
    if (st) { for (const e of ends) add(st + e); if (suf === 'って' || suf === 'った') { if (st.endsWith('行')) add('行く'); } }
  }
  // 一段 て・た 形（食べた → 食べる）；いる / てる 的缩约（見てる → 見る）
  for (const suf of ['てる', 'ている', 'ていた', 'てた', 'ていない', 'ています', 'ていました', 'ていません', 'てます', 'てました', 'てません', 'でる', 'でいる']) {
    const st = strip(suf);
    if (st) { add(`${st}る`); fromStem(st, GODAN_I); add(`${st}う`); add(`${st}く`); add(`${st}す`); add(`${st}む`); add(`${st}ぶ`); }
  }
  for (const suf of ['て', 'た', 'ちゃった', 'ちゃう', 'ちゃって']) { const st = strip(suf); if (st) ichidan(st); }
  // 过去、连用的「～ちゃう」：行っちゃった → 行っ + ちゃった
  const chat = w.match(/^(.+?)(?:っ|ん|い)?ちゃ(?:う|った|って|った)$/u);
  if (chat) { ichidan(chat[1]); add(`${chat[1]}く`); add(`${chat[1]}う`); }
  // い形容词
  for (const [suf, rep] of [['かったです', 'い'], ['くなかった', 'い'], ['くないです', 'い'], ['くない', 'い'], ['くなくて', 'い'], ['かった', 'い'], ['くて', 'い'], ['ければ', 'い'], ['く', 'い'], ['さ', 'い'], ['そう', 'い'], ['すぎる', 'い'], ['かろう', 'い']]) {
    const st = strip(suf);
    if (st) add(st + rep);
  }
  // 敬体、判断
  for (const suf of ['でした', 'です', 'だった', 'だ', 'じゃない', 'ではない', 'でしょう', 'だろう', 'な', 'に', 'で']) { const st = strip(suf); if (st) add(st); }
  // 带「お / ご」的敬语前缀
  if (/^[おご]./u.test(w) && w.length > 2) add(w.slice(1));
  add(suruLate);
  return [w, ...out];
}

// ---- 排序题（日语）：和 zhPuzzleParts 同形状 ----
// → { clean, tiles, parts } | null。清洗沿用 zhSort 的 sortTextZhMap（剥行首分隔号、说话人标签；中日通用），
// 词块只留整块都还在清洗后文字里的，其余同 zhPuzzleParts：parts 的 text 接起来 === clean，tiles[k] === 第 k 个 slot 的 text。
// words（可选）：AI 标注的词块（shared/jaAnno.js 的 w，数组或单空格连的串）。给了、而且对得回原文就用它们当词块，
// 对不回（不该发生）退回本机切
export function jaPuzzleParts(text, words = null) {
  const s = typeof text === 'string' ? text : '';
  const { clean, keep } = sortTextZhMap(s);
  const tiles = tilesOf(s, words).filter((t) => { for (let k = t.s; k < t.e; k += 1) if (!keep[k]) return false; return true; });
  if (!tiles.length) return null;
  const pos = new Array(s.length + 1);
  let n = 0;
  for (let k = 0; k < s.length; k += 1) { pos[k] = n; if (keep[k]) n += 1; }
  pos[s.length] = n;
  const parts = [];
  let cursor = 0;
  tiles.forEach((t, slotIndex) => {
    const a = pos[t.s];
    if (a > cursor) parts.push({ type: 'literal', text: clean.slice(cursor, a) });
    parts.push({ type: 'slot', text: t.t, slotIndex });
    cursor = pos[t.e];
  });
  if (cursor < clean.length) parts.push({ type: 'literal', text: clean.slice(cursor) });
  return { clean, tiles: tiles.map((t) => t.t), parts };
}
