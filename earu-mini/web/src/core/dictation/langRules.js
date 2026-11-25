// 听写「按语言不同」的规则，全收在这一个文件。
// judge.js（判词）、rare.js（人名、难词）、prefill.js（预填）、DictPanel.jsx（输入辅助按钮）都只问这里，不到处写 lang === 'es'。
// 规则的「数据」放在 shared/langProfile.js 的 dictate 列（DICTATE 表），这里只按表生成判词函数：
// 加一门语言只改表，不改这里。不认识的语言一律按英语（和 prefill.js 以前「不传 lang 当英语」一致）。英语的行为一个字都没动。
//
// 西语：少打重音符号（á→a、é→e、í→i、ó→o、ú→u、ü→u）算对但那个词标黄、显示正确拼法（判成 2，另给 fix）；
//   重音打错（é 打成 è）、ñ 漏打成 n、多打重音都算错；千位点 1.000 = 1000；英语那套基数词表、缩写撇号规则不套到别的语言。
// 各语言通用：
//   · 判对 = 两边先过同一道 norm（NFC → 撇号 → strip → equiv → 小写 → 数字写法 → fold），再比；比的时候允许表里 slip 写的「漏打 / 换写」，
//     一字不差返回 1，靠 slip 才对上返回 2（界面标黄，显示正确拼法），对不上返回 0。
//   · 汉字「繁简互换算对」：fold 'han' 逐字繁转简（hanFold.gen.js，数据来自 OpenCC TSCharacters）；同音字是别的字，判错。
//   · 日语：假名写法和汉字写法都算对——切词器给的词带 reading（假名读音）时，打读音也对（平假名片假名同一个）。ja.db 没有读音字段，靠切词器给。
//   · 韩、日、中靠系统输入法：ime 为 true，界面在拼写（composition）过程中不判、不吞字；ja、zh 没有空格，整个输入去掉空白再比。

import { profileOf, lowerOf } from '../../../../shared/langProfile.js';
import { HANT, HANS } from './hanFold.gen.js';

// ---- 繁简 / 假名 ----
let HAN_MAP = null;
const hanMap = () => {
  if (!HAN_MAP) { HAN_MAP = new Map(); const t = [...HANT]; const s = [...HANS]; t.forEach((c, i) => HAN_MAP.set(c, s[i])); }
  return HAN_MAP;
};
const foldHan = (s) => { const m = hanMap(); let o = ''; for (const c of s.toLowerCase()) o += m.get(c) ?? c; return o; };   // 日、中档案没有大小写规则，句子里夹的拉丁词在这里转小写
// NFKC（全角半角、半角片假名）+ 片假名 → 平假名（U+30A1–U+30F6 减 0x60）；长音符 ー 不动
const foldKana = (s) => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const FOLDS = { han: foldHan, kana: foldKana };

// 阿拉伯-印度数字 ٠-٩、波斯数字 ۰-۹、天城文数字 ०-९ → 0-9
const toAsciiDigits = (s) => s.replace(/[٠-٩۰-۹०-९]/g, (c) => {
  const n = c.charCodeAt(0);
  return String(n >= 0x0966 ? n - 0x0966 : n >= 0x06F0 ? n - 0x06F0 : n - 0x0660);
});

// ---- 比较用写法 ----
// 一个词的比较用写法：两边（她打的 / 答案）都过它
export function normFor(lang) {
  const d = profileOf(lang).dictate?.norm || {};
  const strip = d.strip ? new RegExp(`[${d.strip}]`, 'gu') : null;
  const equiv = d.equiv && Object.keys(d.equiv).length ? d.equiv : null;
  const equivRe = equiv ? new RegExp(`[${Object.keys(equiv).join('')}]`, 'gu') : null;
  const fold = d.fold ? FOLDS[d.fold] : null;
  // 千分位：欧洲语言点（1.000 = 1000），中日韩逗号（5,000 = 5000，DT-1）——档案 norm.thousands
  const groups = d.thousands === ',' ? /^\d{1,3}(?:,\d{3})+$/ : /^\d{1,3}(?:\.\d{3})+$/;
  return (s) => {
    let t = String(s ?? '').normalize('NFC').replace(/[’‘ʼ]/g, "'");
    if (strip) t = t.replace(strip, '');
    if (equivRe) t = t.replace(equivRe, (c) => equiv[c]);
    t = lowerOf(lang, t);
    if (d.digits) t = toAsciiDigits(t);
    if (fold) t = fold(t);
    // 中日韩输入法常打出全角数字、全角逗号（５，０００）：先换成半角再认千分位
    if (d.thousands === ',') t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/(?<=\d)，(?=\d)/g, ',');
    if (groups.test(t)) t = t.replace(/[.,]/g, '');   // 去掉千分位
    return t;
  };
}

// ---- 比较 ----
// typed、target 都是 norm 过的。slip：{正确字: [可接受的打法…]}（空串 = 可以不打）。返回 0 不对 ｜ 1 一字不差 ｜ 2 靠 slip 才对上
export function slipMatch(typed, target, slip) {
  if (typed === target) return 1;
  if (!slip || !Object.keys(slip).length) return 0;
  const x = [...typed];
  const y = [...target];
  const INF = 1e9;
  let prev = new Array(x.length + 1).fill(INF);
  prev[0] = 0;
  for (const ch of y) {
    const cur = new Array(x.length + 1).fill(INF);
    const vars = slip[ch];
    for (let j = 0; j <= x.length; j += 1) {
      if (prev[j] >= INF) continue;
      if (j < x.length && x[j] === ch) cur[j + 1] = Math.min(cur[j + 1], prev[j]);
      if (vars) {
        for (const v of vars) {
          const vc = [...v];
          if (j + vc.length <= x.length && vc.every((c, k) => x[j + k] === c)) cur[j + vc.length] = Math.min(cur[j + vc.length], prev[j] + 1);
        }
      }
    }
    prev = cur;
  }
  const r = prev[x.length];
  return r >= INF ? 0 : r === 0 ? 1 : 2;
}

// ---- 判词规则 ----
const enNorm = (s) => String(s).replace(/[’‘ʼ]/g, "'").toLowerCase();
const EDGE_PLAIN = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;          // 两端的标点、符号
const EDGE_MARKS = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;  // 组合记号（元音符号、天城文附标）算词的一部分

const EN_JUDGE = Object.freeze({
  id: 'en',
  cardinal: true,                                                    // 相邻的英文基数词合成一个数字词位（twenty five = 25）
  norm: enNorm,
  match: (typed, target) => (typed === target ? 1 : 0),
  edge: EDGE_PLAIN,
  noSpace: false,
  dict: false,
  ime: false,
  chars: Object.freeze([]),
  kbd: null,
});

const CACHE = new Map();
export function judgeRulesOf(lang) {
  const prof = profileOf(lang);
  if (prof.learn === 'en' || !prof.dictate) return EN_JUDGE;
  let r = CACHE.get(prof.learn);
  if (!r) {
    const d = prof.dictate;
    const norm = normFor(prof.learn);
    const dict = prof.wordSegment === 'dict';
    r = Object.freeze({
      id: prof.learn,
      cardinal: false,
      norm,
      // alts：这个词位还有哪些写法也对（日语读音，已 norm 过），不标黄
      match: (typed, target, alts) => {
        let best = slipMatch(typed, target, d.slip);
        if (best === 1 || !alts) return best;
        for (const a of alts) { if (typed === a) return 1; }
        return best;
      },
      edge: d.marks ? EDGE_MARKS : EDGE_PLAIN,
      noSpace: dict,                      // 日、中没有空格：输入里的空白一律去掉
      dict,
      ime: !!d.ime,
      chars: Object.freeze([...(d.chars || [])]),
      kbd: d.kbd ? Object.freeze(d.kbd.map((row) => Object.freeze([...row]))) : null,
    });
    CACHE.set(prof.learn, r);
  }
  return r;
}
// 输入区旁边的字符按钮（美式键盘打不出这些）：西语 á é í ó ú ü ñ（¿ ¡ 不是词，不用打）；德 ä ö ü ß；法、葡、土同理。不认识的当英语（没有）
export const charButtonsOf = (lang) => judgeRulesOf(lang).chars;
// 屏幕字母键（俄、阿、印地）：按行排的字符串数组；没有的语言是 null
export const keyboardRowsOf = (lang) => judgeRulesOf(lang).kbd;

// ---- 人名规则（rare.js nameFlags） ----
const NAMES_CACHE = new Map();
export function nameRulesOf(lang) {
  const prof = profileOf(lang);
  let r = NAMES_CACHE.get(prof.learn);
  if (!r) {
    const n = prof.dictate?.names || {};
    const quote = n.quote || '"“‘';
    r = Object.freeze({
      notNames: new Set(n.notNames || []),
      abbr: new Set(n.abbr || []),
      // 引号里的话开头也是句首：He said, "Look at Rome." 里的 Look 不是专名（西语 « ¿ ¡ 等见表的 quote）
      quoteOpen: new RegExp(`[,:;]\\s*[${quote}]\\s*$`, 'u'),
      notName: n.contractions ? (low) => /^i'(m|ll|d|ve)$/.test(low) : () => false,
    });
    NAMES_CACHE.set(prof.learn, r);
  }
  return r;
}

// ---- 难词表 ----
// 哪些语言有预填用的词频档表（rare.js ensureWordRank / wordBandOf）、因此预填走「人名 → 难词」两步。别的语言只走句首句尾 + 均匀撒
export const hasWordRank = (lang) => lang === 'en' || lang === 'es';
// 预填时要不要认人名：看档案的 nameByCase（德语名词都大写、没有大小写的文字都不认）。不要求有词频表
export const namesByCase = (lang) => !!profileOf(lang).nameByCase;
