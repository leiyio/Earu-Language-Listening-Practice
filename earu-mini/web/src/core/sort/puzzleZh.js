// 中文排序题：出题、重新打乱、换字。只管「词块从哪来」，
// 预摆、打乱、摆放、判对、提示全部复用英文那套（puzzle.js；判对逐位比文字，两个一样的词块谁前谁后都算对）。
// puzzle.js 的 buildPuzzle / reshuffle / retext 开头各一行分派到这里，英文题一行都不经过这个文件。
//
// 词块从哪来：
//   - 有 AI 标注（core/translate.js 收到的 tr.anno[i] = {w, p, src}，已校验过）：用标注的词和拼音；
//   - 还没标到：本机 segmentLocal 临时出题（不画拼音）。计分不看这里怎么切——词块数另算。
//   切好的词交给 shared/zhSort.js zhPuzzleParts：剥行首分隔号、说话人标签 → 粘小词（看拼音的轻声）→ 模板。
// 按哪段文字切：这句的原文（orig，标注就是对着它标的），没给原文才用显示的文字。
// 中文没有恢复大小写，两者本来就是同一句。
//
// 题目对象和英文的字段一样（puzzle.js 文件头），只多一个 zh：
//   zh: { segSig, segSrc }
//     segSig  词块签名：按顺序的词块文字用 | 连起来（词块里不会有 |：它不是字母数字、也不是词中间能夹的连接符）。
//             标注晚到时比它，知道题要不要换；
//     segSrc  词从哪来：标注的 src（'ai' / 'icu' / 'triv'），本机临时切的是 'local'。
// 英文题不带 zh 字段（英语基线 en-golden 记的是整个题目对象的哈希）。
import { keyOf } from '../../../../shared/zhText.js';
import { segmentLocal, alignWords, sortTextZh, zhPuzzleParts } from '../../../../shared/zhSort.js';
import { segmentZh } from '../../../../shared/segment/zh.js';
import { jaPuzzleParts, SEG_VER_JA } from '../../../../shared/segment/ja.js';
import { shuffleTokens } from './puzzle.js';
import { pickPresets } from '../dictation/prefill.js';

// 标注的词对不对得上这句原文：按 join、span 两条检查——词拼起来就是原文的全部字母数字，
// 每个词按顺序对得回原文的一段（alignWords 只管后一条，词只盖住开头几个字它也认，所以两条都要）。
// w 是数组，或者存盘那种单空格连的串（zhSort.js 两种都收）
function fits(source, w) {
  const list = typeof w === 'string' ? (w.trim() ? w.trim().split(/\s+/) : []) : w;
  return Array.isArray(list) && keyOf(list.join('')) === keyOf(source) && !!alignWords(source, list);
}

// 这句用哪份词：标注对得上原文（fits）就用它的词和拼音；没有标注、或对不上（不该发生：标注已校验过；
// 真对不上就是标注和这句不是一回事）就本机切。拼音音节数不对 zhTiles 自己不用（当没有拼音）
function wordsOf(source, anno) {
  if (anno?.w != null && fits(source, anno.w)) return { words: anno.w, py: anno.p ?? null, src: anno.src || 'ai' };
  // 本机切：走 shared/segment/zh.js（繁体先转简体再切，「看電影」才切开）；它切不出来的才退回 segmentLocal
  const words = segmentZh(source).filter((x) => x.w).map((x) => x.text);
  return { words: words.length ? words : segmentLocal(source), py: null, src: 'local' };
}

const sigOf = (tiles) => tiles.join('|');

// → { clean, parts, tiles, zh } | null（一个词块都没有：不出题，同英文剥完没词）
function segOf(source, anno, lang) {
  if (lang === 'ja') {
    // 日语：有 AI 词块（对得上原文）用 AI 的，segSrc 同标注的 src；
    // 还没标到用 shared/segment/ja.js 本机切，segSrc 'js'
    const ai = anno?.w != null && fits(source, anno.w);
    const r = jaPuzzleParts(source, ai ? anno.w : null);
    return r && { clean: r.clean, parts: r.parts, tiles: r.tiles, zh: { segSig: sigOf(r.tiles), segSrc: ai ? anno.src || 'ai' : 'js', lang: 'ja', ver: SEG_VER_JA } };
  }
  const { words, py, src } = wordsOf(source, anno);
  const res = zhPuzzleParts(source, words, py);
  return res && { clean: res.clean, parts: res.parts, tiles: res.tiles, zh: { segSig: sigOf(res.tiles), segSrc: src } };
}

// 词块签名的短指纹（FNV-1a 32 位，36 进制）：只用来让不同切法的词块 id 不一样，不当身份、不存盘
function sigTag(sig) {
  let h = 0x811c9dc5;
  for (let i = 0; i < sig.length; i += 1) {
    h ^= sig.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// 拼成题目对象：照 puzzle.js buildPuzzle 的后半段（字段、顺序一样，最后多一个 zh）。
// 预摆按词块数和洗过的文字定（同英文：同一句重做是同一道题）；词块 id 带题目 id，换句不撞上一句的 React key。
// 中文词块 id 还带切法（词块签名的指纹）：标注晚到、没动过的题会静默换题（session.show），这时她可能正按着一个词块在拖——
// 拖动按下时就记住了词块 id，id 只按序号编的话，松手时同一个 id 在新题里是另一个词（评审 B7-1：拖「说明」放进去的是「说」）。
// 切法变了 id 就全变，旧拖动松手时 locate 找不到这个 id，什么都不做。同一种切法（重新打乱、只换来源）id 不变
// 预摆哪几块：和英语同一个挑法 pickPresets（core/dictation/prefill.js：先句首句尾，再均匀撒；个数看难度档 grade），一个词块当一个词位
//   中文、日语没有词频表、不认人名，那两步自然跳过
function presetTiles(tiles, grade, lang) {
  const slots = tiles.map((w) => ({ text: w, norm: w, span: 1 }));
  return pickPresets({ slots, parts: [] }, grade, lang).slice().sort((a, b) => a - b);
}

function assemble({ id, shown, source, clean, parts, tiles, zh, random, grade }) {
  const slots = presetTiles(tiles, grade, zh.lang === 'ja' ? 'ja' : 'zh'); // clean 只用来出题文字
  const presetSet = new Set(slots);
  const tag = sigTag(zh.segSig);
  const original = tiles.map((w, i) => (presetSet.has(i)
    ? { id: `${id}#${tag}:${i}`, i, text: w, preset: true }
    : { id: `${id}#${tag}:${i}`, i, text: w }));
  const answer = Array(original.length).fill(null);
  for (const s of slots) answer[s] = original[s];
  return {
    id,
    text: clean,
    shown,
    orig: source,
    parts,
    original,
    bank: shuffleTokens(original.filter((t) => !t.preset), random),
    answer,
    preset: slots,
    solved: false,
    touched: false,
    hinted: false,
    hint: null,
    zh,
  };
}

// 出题。anno：这一句的标注 {w, p, src}（没标到是 null / 不传）
// grade：难度档（同英文 buildPuzzle，不传＝基础）
export function buildPuzzleZh({ id, text, orig, random = Math.random, anno = null, lang = 'zh', grade }) {
  const shown = String(text ?? '');
  const source = orig == null ? shown : String(orig);
  const seg = segOf(source, anno, lang);
  return seg ? assemble({ id, shown, source, ...seg, random, grade }) : null;
}

// 「重新打乱」：预摆不变，打乱顺序变。词块照这道题手上的（不重新切：本机切和标注可能不一样，重新打乱不能换题）——
// 只有一种例外：传进来的这句标注对得上原文（会话记着最近一次 show 带的标注），就按标注重出。
// 标注晚到时她已经动过题、题没换（见 retextZh），点「重新打乱」正是换成正式词块的时候；标注和手上的一样时出来的词块也一样。
export function reshuffleZh(p, random = Math.random, opts) {
  if (!p) return p;
  if (opts?.anno?.w != null && fits(p.orig, opts.anno.w)) {
    const next = buildPuzzleZh({ id: p.id, text: p.shown, orig: p.orig, random, anno: opts.anno, lang: p.zh?.lang === 'ja' ? 'ja' : 'zh', grade: opts.grade });
    if (next) return next;
  }
  return assemble({
    id: p.id, shown: p.shown, source: p.orig, clean: p.text, parts: p.parts,
    tiles: p.original.map((t) => t.text), zh: p.zh, random, grade: opts?.grade,
  });
}

// 同一题又来一次（播放器状态变了、标注到了）：洗过的文字和词块签名都没变就原样返回同一个对象（界面拿 === 判断不重画）；
// 只是词的来源变了（本机切和标注切得一样）：题不动，换一个只改了 zh.segSrc 的对象；
// 变了返回 null，由调用方（session.show）判断换不换：没动过的静默换题，动过的、排对的不换。
// 这回没带标注、手上的题是按标注出的：原样返回——标注只会晚到、不会撤回，
// 没带只是前端这会儿手上没有（换了译文语种，useTranslation 清空重拉那一下），不能因此退回本机切、把题换掉再换回来。
// 中英题对不上（手上是英文题、这回要中文题，或反过来）：返回 null 当新题（不会发生：指纹里带原文语种，id 不会撞）。
export function retextZh(p, text, orig, opts) {
  if (!p) return p;
  if (!p.zh || !opts?.zh) return null;
  const shown = String(text ?? '');
  const source = orig == null ? (p.orig ?? shown) : String(orig);
  const lang = p.zh.lang === 'ja' || opts.lang === 'ja' ? 'ja' : 'zh';
  if (lang === 'ja' && p.zh.lang !== 'ja') return null;
  const fresh = opts.anno?.w != null && fits(source, opts.anno.w);
  // 手上是本机临时切的（中文 'local'、日语 'js'）才按这回的重算；按标注出的题，这回没带标注就原样留着（标注不会撤回）
  const localSeg = p.zh.segSrc === 'local' || p.zh.segSrc === 'js';
  if (!fresh && !localSeg) return sortTextZh(source) === p.text ? p : null;
  const seg = segOf(source, fresh ? opts.anno : null, lang);
  if (!seg || seg.clean !== p.text || seg.zh.segSig !== p.zh.segSig) return null;
  if (seg.zh.segSrc === p.zh.segSrc && shown === p.shown && source === p.orig) return p;
  return { ...p, shown, orig: source, zh: seg.zh };
}
