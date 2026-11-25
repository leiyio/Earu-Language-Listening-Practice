// 把解出的字幕条整理成「句子列表」：剥音效标注、丢空条和零时长条、排序、合并同时出现的行、去重。
// 产出的每句带稳定编号 i（从 0 起），后面翻译按这个编号对齐。
// 这里改了任何会影响文字或条数的规则，都要把 sentences.js 的 MERGE_VER 加一。

// ---- 音效 / 说话人标注 ----
// 句子里任何位置的 [..]、(..) 都剥掉，
// 比如 [thunder rumbling] [Marie] (sighs)。这些没有对应的语音，留着就是"听不到的题"。
// 朴素正则 \[[^\]]*\]|\([^)]*\) 遇到不成对的括号会从左括号一路吞到后面别的右括号，
// 把真台词剥掉（Family Guy S20E01 那句 (à That was Elmer Hartman … "I Hate Computers (Tra‐La‐La)."
// 落在一条里时，用它剥完只剩 ."，整句被丢）。字幕是逐条剥的，这一句原轨拆成两条，实际只丢了歌名里的
// (Tra‐La‐La)，剩 "I Hate Computers ."。所以这里加了三道保护：
// 1. 只认成对、里面不再套同种括号的一层（嵌套的由内向外剥），不成对的左括号原样留着；
// 2. 圆括号在引号里面不剥——那是歌名、书名的一部分（"I Hate Computers (Tra‐La‐La)"）；方括号照剥（标题里几乎不用方括号）；
// 3. 括号里超过 MAX_NOTE_WORDS 个词、而【同一行】还有别的台词时不剥——那多半是括起来的真台词。
//    自己独占一行（或整条）的标注不受这条限制，照常剥：SDH 轨的歌名说明能到 8 个词
//    （("Don't Cry Out Loud" by Melissa Manchester begins)），长音效描述也常单独一行、下一行才是台词。
const NOTE_RE = /\[[^[\]]*\]|\([^()]*\)/g;
const NOTE_ALL = new RegExp(NOTE_RE.source, 'g'); // 在 NOTE_RE 的替换回调里用，别共用一个带 g 的对象
const MAX_NOTE_WORDS = 6;
const WORD_RE = /[\p{L}\p{N}']+/gu;
// 判「有没有台词」若只用 [A-Za-z0-9]，中文轨会全被当成没台词；所有文本轨都走这里，所以认所有文字和数字
const HAS_WORD = /[\p{L}\p{N}]/u;
const GAP = '\u0000'; // 剥掉的位置先占个位，好收拾它留下的空格
// 行首的对白分隔号（同 sentences.js 的 DASH_START）
const DASH_LEAD = /^[-‐-―−](?![-‐-―−])/;

const countWords = (s) => (s.match(WORD_RE) || []).length;

// 第 off 个字符是不是在一对引号里面（直引号数奇偶，弯引号比开合）
function insideQuote(s, off) {
  const before = s.slice(0, off);
  const straight = (before.match(/"/g) || []).length;
  const open = (before.match(/“/g) || []).length, close = (before.match(/”/g) || []).length;
  return straight % 2 === 1 || open > close;
}

// 标注所在的那一行，去掉所有标注以后还有没有台词
function lineHasSpeech(s, off, len) {
  const a = s.lastIndexOf('\n', off - 1) + 1;
  const b = s.indexOf('\n', off + len);
  return HAS_WORD.test((s.slice(a, off) + ' ' + s.slice(off + len, b < 0 ? s.length : b)).replace(NOTE_ALL, ' '));
}

export function stripNotes(text) {
  let s = text;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    s = s.replace(NOTE_RE, (m, off, whole) => {
      if (m[0] === '(' && insideQuote(whole, off)) return m;
      if (countWords(m) > MAX_NOTE_WORDS && lineHasSpeech(whole, off, m.length)) return m;
      changed = true;
      return GAP;
    });
    if (!changed) break;
  }
  if (!s.includes(GAP)) return text;
  const out = [];
  let carryDash = false;
  for (let l of s.split('\n')) {
    const had = l.includes(GAP);
    const dash = DASH_LEAD.test(l);
    l = l
      // 行首的说话人标注连同冒号一起去掉："(Lois): Hi" → "Hi"，"- [Peter]: Hey" → "- Hey"
      .replace(/^([-‐-―−]?[ \t]*)\u0000+[ \t]*:[ \t]*/, '$1')
      // "Hello [laughs]." → "Hello."；其余位置换成空格
      .replace(/[ \t]*\u0000+[ \t]*(?=[.,!?;:…]|$)/g, '').replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
    // 剥完这一行没字了（"- [door closes]"、"(music playing)"）就整行去掉，免得多出一个空的说话人行；
    // 它开头的分隔号（换人）挪给下一行："- [chuckles]\nYEP." → "- YEP."
    if (had && !HAS_WORD.test(l)) { carryDash ||= dash; continue; }
    if (carryDash && !DASH_LEAD.test(l)) l = `- ${l}`;
    carryDash = false;
    if (l) out.push(l);
  }
  return out.join('\n');
}

export function buildLines(cues) {
  const sorted = cues
    .filter((c) => c.text && Number.isFinite(c.start))
    // kara：逐词时间（ASS 卡拉 OK 标记），跟着这一条走，合并时接起来
    .map((c) => ({ start: Math.max(0, c.start), end: c.end, text: stripNotes(c.text), ...(c.kara ? { kara: c.kara } : {}) }))
    // 剥完只剩标点 / 空白（♪♪、纯音效行）的整条丢掉；
    // 零时长、结束不晚于开始的条丢掉
    .filter((c) => HAS_WORD.test(c.text) && c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const c of sorted) {
    const prev = merged[merged.length - 1];
    // ASS 常把同一时刻的上下两行拆成两条事件；同起同止的合并成一句
    if (prev && Math.abs(prev.start - c.start) < 0.02 && Math.abs(prev.end - c.end) < 0.02) {
      if (!prev.text.split('\n').includes(c.text)) {
        prev.text += '\n' + c.text;
        if (c.kara) prev.kara = [...(prev.kara || []), ...c.kara];
      }
      continue;
    }
    // 同一句被拆成首尾相接的重复块（常见于转封装出来的字幕）
    if (prev && prev.text === c.text && c.start - prev.end < 0.05) {
      prev.end = Math.max(prev.end, c.end);
      continue;
    }
    merged.push({ ...c });
  }
  return merged.map((l, i) => ({ i, ...l }));
}

// 最后一个 start <= t 的句子下标（没有返回 -1）
export function lineIndexAt(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
