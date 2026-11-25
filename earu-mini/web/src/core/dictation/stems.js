// 一个英文词形可能是从哪些原形变来的（词频表 wordRank.gen.js 只存原形和少数不规则变形，其余变形靠这里折回原形再查）。
// 纯函数、不依赖别的文件：生成词频表时判断「哪些变形规则推不出来、要单独存」，以及 core/dictation/rare.js（运行时查表）
// 用的是同一份，两边口径不会跑偏。
//
// 只做规则变形（复数 / 三单 / 过去式 / 现在分词 / 比较级 / 副词），不做真正的词形还原——went、children 这类不规则的由生成脚本从词典的变形表里
// 挑出来直接存进词频表。候选宁多勿少，查表时只认表里有的那几个；候选太短（<3 个字母，或词本身 <4 个字母时 <2 个）不要，
// 免得 was → wa、his → hi、bus → bu 这种凑巧命中。
// 参数 w：全小写、只有字母（撇号、连字符、数字由 rare.js 先处理掉）

const VOWEL = /[aeiou]/;

// 词尾两个字母相同的辅音（stop+p+ed → stopp → stop）
const doubled = (b) => b.length >= 3 && b[b.length - 1] === b[b.length - 2] && !VOWEL.test(b[b.length - 1]);

export function stemsOf(w) {
  const out = [];
  const seen = new Set([w]);
  const push = (s) => {
    if (seen.has(s)) return;
    if (s.length < 3 && !(s.length === 2 && w.length >= 4)) return;
    seen.add(s);
    out.push(s);
  };
  const L = w.length;
  // 复数、三单：cities → city、wolves → wolf / wolve、boxes → box、cats → cat
  if (w.endsWith('ies') && L > 4) push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ves') && L > 4) { push(`${w.slice(0, -3)}f`); push(`${w.slice(0, -3)}fe`); }
  if (w.endsWith('es') && L > 3) push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && L > 3) push(w.slice(0, -1));
  // 过去式、过去分词：studied → study、walked → walk、liked → like、stopped → stop
  if (w.endsWith('ied') && L > 4) push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed') && L > 3) {
    const b = w.slice(0, -2);
    push(b);
    push(w.slice(0, -1));
    if (doubled(b)) push(b.slice(0, -1));
  }
  // 现在分词：running → run、making → make、dying → die、walking → walk
  if (w.endsWith('ing') && L > 4) {
    const b = w.slice(0, -3);
    push(b);
    push(`${b}e`);
    if (doubled(b)) push(b.slice(0, -1));
    if (w.endsWith('ying')) push(`${w.slice(0, -4)}ie`);
  }
  // 比较级、最高级：happier → happy、bigger → big、nicer → nice、fastest → fast
  for (const suf of ['er', 'est']) {
    if (!w.endsWith(suf) || L <= suf.length + 2) continue;
    const b = w.slice(0, -suf.length);
    push(b);
    push(`${b}e`);
    if (doubled(b)) push(b.slice(0, -1));
    if (b.endsWith('i')) push(`${b.slice(0, -1)}y`);
  }
  // 副词：quickly → quick、happily → happy、simply → simple、basically → basic
  if (w.endsWith('ly') && L > 4) {
    const b = w.slice(0, -2);
    push(b);
    push(`${b}e`);
    if (b.endsWith('i')) push(`${b.slice(0, -1)}y`);
    if (b.endsWith('al')) push(b.slice(0, -2));
  }
  return out;
}
