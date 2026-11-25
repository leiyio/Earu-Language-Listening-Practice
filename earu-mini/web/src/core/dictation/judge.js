// 听写的词位表与判词：纯函数，不碰 DOM、不碰 i18n，Node 里能直接测。
//
// 词位（slot）= 答案框里要她听出来的一个词。取词和排序题、计分数词是同一套（shared/sortText.js 的 sortText / parseTemplate），
// 所以 slots.length 恒 <= wordCount(原文)（提交的 slots 总能过校验）。比排序多一条：相邻的英文基数词合成一个「数字词位」
// （twenty five / twenty-five / one hundred and five），她写数字或写英文都认。
//
// 界面是「一词一格」：每个词位一个格子，她在格子里各打各的，最后一起判。界面只用 judgeCell / spaceInside：
// 一格就是 judge([这个词位], 这一格的字)。judge 本身仍按整串判（多格连着判、测试用）：
// 每个词位的状态：ok 对 ｜ bad 错 ｜ blank 留空 ｜ part 数字打到一半（中性）｜ typing 正在打的最后一个词（中性）｜ empty 还没到。
// 输入里多出来的词（没有词位可对）整句就不算对。
//
// 按语言（西语听写）：layoutOf / judge / judgeCell 多一个 lang 参数（不传＝英语，行为一字不差），按语言不同的规则在 langRules.js：
// 西语不合并英文基数词、千位点 1.000 = 1000、少打重音符号（á→a）算对但带 fix（正确拼法，界面标黄）、重音打错 / ñ 漏打算错。
import { sortText, parseTemplate, tokenize } from '../../../../shared/sortText.js';
import { sortTextZh } from '../../../../shared/zhSort.js';
import { segmenterOf } from '../../../../shared/langProfile.js';
import { judgeRulesOf } from './langRules.js';

// ---- 英文基数词（0～999,999）----
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_W = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const UNIT = new Map(ONES.map((w, n) => [w, n]));
const TENS = new Map(TENS_W.map((w, n) => [w, n * 10]).filter(([w]) => w));

const always = () => true;

// 以下几个函数读 ws[i..]（全小写的词），ok(k) = 第 k 个词能不能和前一个词连成一个数（起头的词不用问；字幕里的间隔只许空格 / 一个连字符，见 slotsOf）。
// 返回 {len, value} 或 null。每个函数都取最长的合法读法；个位数不和后面的个位数合并（one two three 是数数），
// 十几后面不接数（thirteen fifty 不合并，不认年份读法），单独的 hundred / thousand 不算数字（a hundred 里的 hundred 当普通词）。
function below100(ws, i, ok) {
  const w = ws[i];
  if (w === undefined) return null;
  const t = TENS.get(w);
  if (t !== undefined) {
    const u = UNIT.get(ws[i + 1]);
    if (u >= 1 && u <= 9 && ok(i + 1)) return { len: 2, value: t + u };
    return { len: 1, value: t };
  }
  const u = UNIT.get(w);
  return u === undefined ? null : { len: 1, value: u };
}

function below1000(ws, i, ok) {
  const h = UNIT.get(ws[i]);
  if (h >= 1 && h <= 9 && ws[i + 1] === 'hundred' && ok(i + 1)) {
    let len = 2;
    let value = h * 100;
    const j = i + 2;
    const start = ws[j] === 'and' && ok(j) ? j + 1 : j;
    const r = ok(start) ? below100(ws, start, ok) : null;
    if (r && r.value > 0) { len += (start - j) + r.len; value += r.value; }
    return { len, value };
  }
  return below100(ws, i, ok);
}

function cardinal(ws, i, ok) {
  const g = below1000(ws, i, ok);
  if (!g) return null;
  let { len, value } = g;
  if (value > 0 && ws[i + len] === 'thousand' && ok(i + len)) {
    len += 1;
    value *= 1000;
    const j = i + len;
    const start = ws[j] === 'and' && ok(j) ? j + 1 : j;
    const r = ok(start) ? below1000(ws, start, ok) : null;
    if (r && r.value > 0) { len += (start - j) + r.len; value += r.value; }
  }
  return { len, value };
}

// 一个数的所有英文读法（词数组的数组）：and 可有可无。只用来判「打到一半」
function under1000(n) {
  if (n < 100) return [n < 20 ? [ONES[n]] : n % 10 ? [TENS_W[Math.floor(n / 10)], ONES[n % 10]] : [TENS_W[Math.floor(n / 10)]]];
  const head = [ONES[Math.floor(n / 100)], 'hundred'];
  const r = n % 100;
  if (!r) return [head];
  const [tail] = under1000(r);
  return [[...head, ...tail], [...head, 'and', ...tail]];
}
function readingsOf(n) {
  if (!(n >= 0 && n <= 999999)) return [];
  if (n === 0) return [['zero']];
  if (n < 1000) return under1000(n);
  const heads = under1000(Math.floor(n / 1000)).map((w) => [...w, 'thousand']);
  const r = n % 1000;
  if (!r) return heads;
  const out = [];
  for (const h of heads) for (const t of under1000(r)) out.push([...h, ...t], [...h, 'and', ...t]);
  return out;
}

// ---- 阿拉伯数字 ----
// 整数，或千分位逗号写法（5,000）。2nd、1990s、3.5 不在其内（它们是普通词位）。值 = 去掉逗号、去掉前导 0 的数字串
const DIGITS_RE = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;
const trimZeros = (d) => d.replace(/^0+(?=\d)/, '');
const digitsValue = (s) => (DIGITS_RE.test(s) ? trimZeros(s.replace(/,/g, '')) : null);

const APOS = /[’‘ʼ]/g;                       // 弯撇号、单引号、修饰撇号，都当直撇号
const lower = (s) => s.replace(APOS, "'").toLowerCase();
// 字幕里两个数词之间的间隔只许是空格 / 制表符，至多夹一个连字符（twenty-five、twenty - five）；逗号、句号、换行都不合并
const JOIN_GAP = /^[ \t\u00a0]+$|^[ \t\u00a0]*[-\u2010\u2011][ \t\u00a0]*$/;

// ---- 词位表 ----
// layoutOf(text, orig)：{slots, parts}。取词和排序题、计分数词同一套：sortText(text, orig) 再 parseTemplate
// （text 是恢复大小写后的显示文字，orig 是字幕原文，说话人标签按原文判；不传 orig 就当原文）。
// slots：[{text, norm, value, span}]：text 原文（数字词位是原文里那一段，含中间的空格 / 连字符）；norm 比较用（小写、直撇号）；
//   value 只有数字词位有（数字串，如 '25'），普通词位是 null；span 原文占几个词；
// parts：给界面摆格子用的模板 [{type:'literal', text} | {type:'slot', text, slotIndex}]，slotIndex 对应 slots；
//   合成一个数字词位的几个词，中间的空格、连字符并进那个词位里，不再单独出现。
export function layoutOf(text, orig = text, lang = 'en') {
  const rules = judgeRulesOf(lang);
  if (rules.dict) return dictLayoutOf(text, lang, rules);
  // 非英语先合成 NFC：有的字幕把 á 存成 a + 单独重音记号，不合成会把一个词切成两半
  if (!rules.cardinal) { text = String(text ?? '').normalize('NFC'); orig = String(orig ?? '').normalize('NFC'); }
  const src = parseTemplate(sortText(text, orig));
  const words = [];     // {text, gap}：gap = 这个词和前一个词之间的固定文字
  let gap = '';
  for (const p of src) {
    if (p.type === 'literal') gap += p.text;
    else { words.push({ text: p.text, gap }); gap = ''; }
  }
  const low = words.map((w) => (rules.cardinal ? lower(w.text) : rules.norm(w.text)));
  const ok = (k) => k > 0 && k < words.length && JOIN_GAP.test(words[k].gap);
  const slots = [];
  for (let i = 0; i < words.length;) {
    const c = rules.cardinal ? cardinal(low, i, ok) : null;
    if (c) {
      const joined = words.slice(i, i + c.len).map((w, k) => (k ? w.gap : '') + w.text).join('');
      slots.push({ text: joined, norm: low.slice(i, i + c.len).join(' '), value: String(c.value), span: c.len });
      i += c.len;
      continue;
    }
    const dv = rules.cardinal ? digitsValue(words[i].text) : null;
    slots.push({ text: words[i].text, norm: dv ?? low[i], value: dv, span: 1 });
    i += 1;
  }
  const parts = [];
  let skip = 0;
  let k = 0;
  for (const p of src) {
    if (p.type === 'literal') { if (!skip) parts.push(p); continue; }
    if (skip) { skip -= 1; continue; }
    parts.push({ type: 'slot', text: slots[k].text, slotIndex: k });
    skip = slots[k].span - 1;
    k += 1;
  }
  return { slots, parts };
}

// 日、中没有空格：按切词器（shared/langProfile.js registerSegmenter，「日语中文切词」代理注册）切词，每个词一个词位。
// 切词器返回 [{text, w, reading?}]：w 为真的是词（读音 reading 是假名，日语打读音也算对），不是词的（标点）当固定文字。
// 没注册切词器（或切不出词）= 这句不出听写题：slots 为空，界面和预填都容忍空词位表。
function dictLayoutOf(text, lang, rules) {
  const clean = sortTextZh(String(text ?? '').normalize('NFC'));
  const seg = segmenterOf(lang);
  const toks = seg && clean ? seg(clean) : null;
  const slots = [];
  const parts = [];
  const lit = (t) => { if (!t) return; const last = parts[parts.length - 1]; if (last && last.type === 'literal') last.text += t; else parts.push({ type: 'literal', text: t }); };
  if (!Array.isArray(toks)) { lit(clean); return { slots, parts }; }
  for (const t of toks) {
    const w = String(t?.text ?? '');
    if (!t?.w || !/[\p{L}\p{N}]/u.test(w)) { lit(w); continue; }
    const slot = { text: w, norm: rules.norm(w), value: null, span: 1 };
    if (t.reading) slot.alts = [rules.norm(t.reading)];
    parts.push({ type: 'slot', text: w, slotIndex: slots.length });
    slots.push(slot);
  }
  return { slots, parts };
}

export const slotsOf = (text, orig = text, lang = 'en') => layoutOf(text, orig, lang).slots;

// ---- 读输入 ----
// 两端的标点、符号（数字里面的逗号在中间，不受影响）：规则在 langRules.js 的 edge（元音符号、天城文附标的语言把组合记号当词的一部分）
const DASH = /[-\u2010-\u2015\u2212]+/;              // 词里面的连字符、破折号：按它切成几块，well-known 当 well 和 known 两个词

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;
const countLD = (s) => (String(s).match(LETTER_OR_DIGIT) || []).length;

// 一块再按出题的切词规则切成词（shared/sortText.js 的 tokenize，和 parseTemplate 同一个 WORD_RE）：
// 出题把 U.S. 切成 U、S，3pm 切成 3、pm，10:30 切成 10、30，24/7、and/or、e.g. 也各是两个词位；
// 她把它们当一个 token 打下去（U.S.、3pm……）也要对得上，逐词打（U S）照旧对。
// 切完以后字母数字的个数对不上（输入里有切词不认的字，比如中文、希腊字母）就不切，整块当一个词，照旧判错。
function wordsOf(bit) {
  const ws = tokenize(bit);
  return ws.length > 1 && countLD(ws.join('')) === countLD(bit) ? ws : [bit];
}

// 把输入串切成「块」：按单个空格切（不合并连续空格）；剥完两端标点是空串的 token 当「留空」；token 里的连字符再切开，
// 再按出题的切词规则切（wordsOf）。
// 最后一个 token 是正在打的（没有后面的空格）：它的最后一块标 typing；final（回车检查）时按已完成算。
function readInput(value, final, rules) {
  const raw = rules.noSpace ? String(value ?? '').replace(/\s+/g, '') : String(value ?? '');
  const toks = (rules.cardinal ? raw : raw.normalize('NFC')).replace(APOS, "'").split(' ');
  const out = [];
  toks.forEach((tok, k) => {
    const last = k === toks.length - 1;
    const core = tok.replace(rules.edge, '');
    if (!core) { if (!last) out.push({ blank: true, text: '', norm: '', typing: false }); return; }
    const bits = core.split(DASH).filter(Boolean).flatMap(wordsOf);
    bits.forEach((b, n) => out.push({ blank: false, text: b, norm: rules.cardinal ? b.toLowerCase() : rules.norm(b), typing: last && !final && n === bits.length - 1 }));
  });
  return out;
}

// 这几块当成一个数，是多少（数字串）；不是一个完整的数就 null
function typedValue(run) {
  if (run.length === 1) { const d = digitsValue(run[0].norm); if (d !== null) return d; }
  const ws = run.map((x) => x.norm);
  const c = cardinal(ws, 0, always);
  return c && c.len === ws.length ? String(c.value) : null;
}

// 打到一半：这几块（一直到输入末尾）是不是这个数某种读法的开头。末尾那块如果是正在打的，只要是下一个词的开头就行
function isPartial(run, slot) {
  const lastTyping = run[run.length - 1].typing;
  if (run.length === 1) {
    const d = run[0].norm.replace(/,/g, '');
    if (/^\d+$/.test(d)) { const v = trimZeros(d); if (slot.value.length > v.length && slot.value.startsWith(v)) return true; }
  }
  const n = slot.value.length <= 6 ? Number(slot.value) : -1;
  return readingsOf(n).some((r) => {
    if (lastTyping ? run.length > r.length : run.length >= r.length) return false;
    return run.every((x, k) => (k === run.length - 1 && lastTyping ? r[k].startsWith(x.norm) : r[k] === x.norm));
  });
}

const typedOf = (run) => run.map((x) => x.text).join(' ');

// 数字词位吃输入里的几块：{used, cell}
function matchNumber(slot, pieces, p) {
  const run = [];
  for (let k = p; k < pieces.length && !pieces[k].blank && run.length < 12; k++) run.push(pieces[k]);
  // 1. 前 len 块恰好是这个数
  for (let len = 1; len <= run.length; len++) {
    const part = run.slice(0, len);
    if (typedValue(part) === slot.value) return { used: len, cell: { status: part.some((x) => x.typing) ? 'typing' : 'ok', typed: typedOf(part) } };
  }
  // 2. 一直到输入末尾都还在往这个数上打（twenty → 25）：中性
  if (p + run.length === pieces.length && run.length && isPartial(run, slot)) {
    return { used: run.length, cell: { status: run[run.length - 1].typing ? 'typing' : 'part', typed: typedOf(run) } };
  }
  // 3. 错了：吃掉看上去是一个数的那几块（至少一块）
  const c = cardinal(run.map((x) => x.norm), 0, always);
  const used = Math.max(1, c ? c.len : 1);
  const part = run.slice(0, used);
  return { used, cell: { status: part.some((x) => x.typing) ? 'typing' : 'bad', typed: typedOf(part) } };
}

// ---- 判词 ----
// slots：slotsOf 的结果；value：答案框里的字符串；final：回车检查（最后一个没跟空格的词按已完成算）
// 返回 {cells:[{status, typed}], solved}
//   solved  每个词位 ok 且没有多打的词（extra）、没有留空
export function judge(slots, value, { final = false, lang = 'en' } = {}) {
  const rules = judgeRulesOf(lang);
  const pieces = readInput(value, final, rules);
  const cells = [];
  let p = 0;
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    if (p >= pieces.length) { cells.push({ status: 'empty', typed: '' }); continue; }
    const pc = pieces[p];
    if (pc.blank) { cells.push({ status: 'blank', typed: '' }); p += 1; continue; }
    if (slot.value === null) {
      const m = pc.typing ? 0 : rules.match(pc.norm, slot.norm, slot.alts);
      const status = pc.typing ? 'typing' : m ? 'ok' : 'bad';
      // m === 2：只是少打了重音符号（西语），算对，带上正确拼法让界面标黄
      cells.push(m === 2 ? { status, typed: pc.text, fix: slot.text } : { status, typed: pc.text });
      p += 1;
      continue;
    }
    const r = matchNumber(slot, pieces, p);
    cells.push(r.cell);
    p += r.used;
  }
  const hasExtra = pieces.slice(p).some((x) => !x.blank);
  return { cells, solved: slots.length > 0 && !hasExtra && cells.every((c) => c.status === 'ok') };
}

// ---- 一词一格 ----
const tidy = (typed) => String(typed ?? '').trim().replace(/\s+/g, ' ');

// 一格判对错（回车 / 最后一格按空格时）：'ok' 对 ｜ 'bad' 错 ｜ 'empty' 没打。大小写、两端标点不管；数字格写数字、写英文都认
export function judgeCell(slot, typed, lang = 'en') {
  return judgeCellFix(slot, typed, lang).verdict;
}

// 同 judgeCell，另给「差一点」：{verdict, fix}。fix 只有西语少打重音符号、判对的那一格有（值 = 正确拼法），其余是 null
export function judgeCellFix(slot, typed, lang = 'en') {
  const v = tidy(typed);
  if (!v) return { verdict: 'empty', fix: null };
  const r = judge([slot], v, { final: true, lang });
  return { verdict: r.solved ? 'ok' : 'bad', fix: r.solved ? r.cells[0]?.fix ?? null : null };
}

// 这一格里按空格是不是还在这一格里（不跳下一格）：只有数字格、刚打完一个英文词、而且还是这个数某种读法的开头
// （25 的格子里打了 twenty，空格后面还要打 five）。打的是阿拉伯数字、已经是完整的数、对不上，空格都跳下一格
export function spaceInside(slot, typed) {
  if (!slot || slot.value === null) return false;
  const v = String(typed ?? '');
  if (!/\p{L}$/u.test(v)) return false;
  return judge([slot], `${tidy(v)} `).cells[0]?.status === 'part';
}
