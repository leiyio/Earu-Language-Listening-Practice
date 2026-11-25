// 把字幕条合并成练习用的整句。电视字幕常把一句话拆成两三条显示：
//   "But where are those" / "good old-fashioned values"
// 精听、循环、翻译都按整句来更好。
//
// 改了任何一条规则都要把 MERGE_VER 加一：翻译指纹带着它，句子切法变了就是另一份字幕、整份重翻。
// m2：对白分隔号认全各种「长得像减号」的字符（字幕里常见 U+2010 ‐），统一成「- 」；一条里几个人说话时每人一行。
// m3：合并规则整套重写——
//   - 相邻间隔 < 0.6 秒就并，哪怕上一条已经有句号（循环前后的缓冲反正会漏进邻句，并起来循环边界两侧都是安静段）；
//   - 并到 22 个词以后，遇到句末才断；间隔 > 2 秒、或整段跨度 > 20 秒必断；没有句末标点时 2 秒内都接；
//   - 缩写表补成 27 个；只合并英文轨，别的语种原样一条一句；
//   - 句末只认 . ! ? …（后面可跟引号、括号）。m2 自加的 ♪、"--"、—、中文句号不再算句末，
//     「going to...」接「...the store」的省略号续接也去掉了；
//     用两集三条轨核对过切点；
//   - 去掉了 m2 的「最多 4 条 / 15 秒」「小写开头 3 秒内接」「换人说话必断」「多人对白不和前后并」「重叠 0.5 秒以上不并」；
//   - lines.js 同时改了：句中任何位置的 [..]、(..) 音效标注剥掉（带防吞台词的保护），零时长条丢掉（以前补 2 秒）；
//   - 只有一个说话人时去掉开头的分隔号，"- Hi." → "Hi."；
//   - 一条里第一行没分隔号、后面的行有（"BOINK!\n- OH, RAY!"），分成两个说话人（m2 接成一行）。
// m4：相邻间隔 < 0.3 秒才并（m3 是 0.6），别的一条不改。
//   这一条有意改了：m3 并 0.6 秒以内的，理由是「循环前后的缓冲反正会漏进邻句」；现在播放器把前后缓冲各夹在
//   与邻句间隙的一半以内（sentencePlayer.js loopStart / loopEnd），缓冲不会再漏进邻句，0.3–0.6 秒之间的两句不必为了缓冲并成一题。
//   目标是「听的和字幕对得上」：循环时听到的正好是屏幕上那几个字，不多邻句一个字、不少一个字。
//   顺手：间隔先取整到毫秒再比（gapOf）。字幕时间是毫秒，直接相减有浮点误差（2.9 − 2.6 = 0.29999…），正好 300 毫秒的空档
//   以前是并是断看运气；m4 起正好 0.3 秒一定断。
//   升了版本，老指纹变了：保留 m3 的指纹（PREV_MERGE，translate.js），可以把老条目里一字不差的句子的译文搬过来。
// m5：自动字幕常常一个句末标点都没有，
//   m4 等不到句号，只能拖满 20 秒才断，一句 50~70 个词。m5 加两条路，都只对「走英文合句那一路」的轨生效：
//   - 规则 1：整轨句末带标点的条数 < 10%（punctRatio）→ 不拼，一条字幕一句；
//   - cuts：字幕文件顶层带断点（{v:1, model, at:[[t, w, word], ...]}，t 是这个词所在那一条的 start、
//     w 是它在这一条 lineWords 里的下标、word 是词本身，核对用）→ 先在断点处把条劈开，再按断点接成句（不看标点比例）。
//     断点对不上的丢掉，对不上的超过两成整份不用（退回规则 1 / m4）；间隔 > MAX_GAP、跨度 > MAX_SPAN 照旧保底断。
//   走了规则 1 或 cuts 的轨，每个整句对象带 mv: 5（translate.js mergeVerOf 看它出 'm5'）；m4 轨的整句对象一个字段不多，指纹不变，
//   译文、校准、排序进度全部接着用。m5 轨的老指纹 = 同一份字幕按 m4 合（M4_MERGE：不用规则 1、不用 cuts），版本 m4。
//   原字幕一个字不改：文件的 body 字节不动，cuts 只是文件末尾多的一项。
//
// 【契约】一句的文本要么是单行，要么是多行且每行以「- 」开头（一行一个说话人），不会混着来。
// 译文行数靠这个核对。外部实现没有"说话人"这个概念（整条洗成一行），
// 按间隔合并跨过换人时这样处理（本实现自定）：
//   - 下一条以分隔号开头 = 换人：另起一个说话人行；这时上一句原来那一行（哪怕没写分隔号）也成为一个说话人行；
//   - 下一条没有分隔号 = 同一个人接着说：接到最后一个说话人那行的后面。

export const MERGE_VER = 'm4';
// 上一版的合并（m3：间隔 < 0.6 秒就并、间隔不取整，别的和 m4 一样）。只给搬旧译文用：同一份字幕按它再合一遍、算出老指纹，
// 把旧指纹交出去（media.js trackLines 的 prevOut → translate.js prevKey）。合并代码只有下面这一份，换的只是这两个参数
// （mergeSentences(lines, PREV_MERGE)；ver 只是记一笔，合并不看它）。老指纹必须和当初 m3 算的一字不差，所以浮点误差也照旧
export const PREV_MERGE = Object.freeze({ ver: 'm3', minGap: 0.6, rawGap: true });
// m5 轨的老指纹用的合并（m4：不用规则 1、不用 cuts，别的和现在一样）。m5 轨按它再合一遍，版本 m4（media.js trackLines 的 prevOut）
export const M4_MERGE = Object.freeze({ ver: 'm4', m5: false });
// m5 轨整句对象上的版本记号（mv: 5）和它对应的合句版本（translate.js mergeVerOf）
export const MV_M5 = 5;
export const MERGE_VER_M5 = 'm5';

// 四个数；MIN_GAP 是 m4 改的（原 0.6），另外三个原样沿用
const MIN_GAP = 0.3;    // 间隔小于它就并（m4 起 0.3；m3 是 0.6）
const WORD_CAP = 22;    // 并到这么多词以后，遇句末就断
export const MAX_GAP = 2.0;    // 间隔超过它必断（防跨场景误并）
export const MAX_SPAN = 20.0;  // 一句最长跨度兜底

// m5 的几个门槛（算 cuts 的脚本口径要和这里一致）
export const RULE1_RATIO = 0.10;   // 规则 1：句末带标点的条数占比低于它就不拼
export const CUTS_BAD_MAX = 0.20;  // cuts 里对不上的断点超过这个比例，整份 cuts 不用
export const CUTS_T_EPS = 0.0005;  // 断点的 t 和这一条的 start 相差小于它才算同一条（秒）

// 对白分隔号：- ‐ ‑ ‒ – — ― −（有的字幕用 U+2010，看着和减号一样）。两个连着的（"-- and then"）是话被打断后接着说，不是换人
const DASH = '[-‐-―−]';
const DASH_START = new RegExp(`^${DASH}(?!${DASH})\\s*`);

// 句末：原样：. ! ? … 后面可以跟引号/括号。"..." 以点结尾，所以也算句末
const END_RE = /[.!?…]["'”’)\]]*$/;
// 以点结尾但不是句末的缩写（27 个；包括 no——"No." 结尾也当没说完）
const ABBR_RE = /\b(mr|mrs|ms|dr|st|sr|jr|vs|etc|no|inc|ltd|co|prof|gen|sen|gov|lt|sgt|capt|col|maj|rev|hon|dept|vol|op)\.$/i;
// 数词：数词
const WORD_RE = /[A-Za-z0-9']+/g;

const wordCount = (s) => (s.match(WORD_RE) || []).length;
// 两条之间的间隔，取整到毫秒（m4 起；字幕时间本来就是毫秒，直接相减带浮点误差）
const gapOf = (end, start) => Math.round((start - end) * 1000) / 1000;

// 一条字幕按说话人拆开：[{ dash: 这一段是不是以分隔号开头（换人）, text }]
// 以分隔号开头的行另起一个说话人，其余的行是排版折行，接到上一段后面。
// 第一行没有分隔号、后面的行有（"BOINK! BOINK!\n- OH, RAY!"）：第一段是上一个人接着说，后面换人
// ——m2 把这种接成一行 "BOINK! BOINK! - OH, RAY!"，m3 起分成两个说话人。
const squash = (s) => s.replace(/\s+/g, ' ').trim();
export function speakersOf(text) {
  const groups = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (DASH_START.test(l)) groups.push({ dash: true, parts: [l.replace(DASH_START, '')] });
    else if (!groups.length) groups.push({ dash: false, parts: [l] });
    else groups[groups.length - 1].parts.push(l);
  }
  return groups.map((g) => ({ dash: g.dash, text: squash(g.parts.join(' ')) })).filter((g) => g.text);
}

// 合回文本：一个人 → 单行、不带分隔号；几个人 → 每人一行「- 」
const render = (turns) => (turns.length > 1 ? turns.map((t) => `- ${t.text}`).join('\n') : turns[0].text);

const LEAD_ELLIPSIS = /^\.{2,}\s*|^…\s*/;
function join(a, b) {
  // 用一个空格接；顺手去掉下一条开头重复的省略号：
  // "going to..." + "...the store" → "going to... the store"（只改文字，不影响在哪断）
  return `${a} ${b.replace(LEAD_ELLIPSIS, '')}`.replace(/\s+/g, ' ').trim();
}

// 上一句的结尾算不算句末（hard：有句末标点、又不是缩写结尾）
function isHardEnd(cur) {
  const last = cur.turns[cur.turns.length - 1].text;
  return END_RE.test(last) && !ABBR_RE.test(last);
}

// 同步断点要用：只看「这一条自己」的结尾算不算句末（不依赖前面累计了什么）。
// 一条整个是省略号（"..."）、又是接在上一条后面的，join 会把它吃掉、不改上一句的结尾，所以不算它自己的结尾——这种一律当不确定
function ownHardEnd(u) {
  if (u.turns.length === 1 && !u.turns[0].dash && !u.turns[0].text.replace(LEAD_ELLIPSIS, '')) return false;
  return isHardEnd(u);
}

// 整轨看着像不像英文（_looks_english）：前 300 条里拉丁字母 >= 30 个，且不少于中日韩字符。
// 不像就不合并，原样一条一句（只整理英文轨，中文轨原样）
function looksEnglish(lines) {
  const sample = lines.slice(0, 300).map((l) => l.text).join(' ');
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const cjk = (sample.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  return latin >= 30 && latin >= cjk;
}

// ---- m5：词、标点比例、cuts ----

// 一条字幕里的词：按说话人拆开（speakersOf 已经把空白压成单个空格）、再按空格切。cuts 的 w 就是它的下标。
// 前端和算 cuts 的脚本必须用同一个口径，所以导出
const wordsOfTurns = (turns) => turns.flatMap((t) => t.text.split(' ')).filter(Boolean);
export const lineWords = (text) => wordsOfTurns(speakersOf(text));

// 句末带标点的条数占比：每条取最后一个说话人那段文字，匹配 END_RE 的算（缩写结尾不排除）；说话人拆不出来的条（speakersOf 为空）不计。
// units 是 buildLines 的输出（{text}），或 mergeSentences 里的 units（{turns}）。一条都没有回 0
export function punctRatio(units) {
  let n = 0;
  let hit = 0;
  for (const u of units || []) {
    const turns = Array.isArray(u.turns) ? u.turns : speakersOf(String(u.text ?? ''));
    if (!turns.length) continue;
    n++;
    if (END_RE.test(turns[turns.length - 1].text)) hit++;
  }
  return n ? hit / n : 0;
}

// 把 cuts 对到条上（units 已经滤掉了没有说话人的条）：找 |start − t| < CUTS_T_EPS 的那一条，且 lineWords[w] === word。
// 对不上的断点丢掉；对不上的超过 CUTS_BAD_MAX（两成）、格式不对（v 不是 1、at 不是数组、一个断点都没有）整份不用，返回 null。
// 用得上返回 Map<条的下标, 词下标的升序数组>（w = 0 是从这一条开头断）
function matchCuts(units, cuts) {
  const at = cuts && cuts.v === 1 && Array.isArray(cuts.at) ? cuts.at : null;
  if (!at || !at.length) return null;
  const firstFrom = (x) => {
    let lo = 0;
    let hi = units.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (units[mid].start < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const words = new Map();
  const wordsAt = (j) => {
    if (!words.has(j)) words.set(j, wordsOfTurns(units[j].turns));
    return words.get(j);
  };
  const marks = new Map();
  let bad = 0;
  for (const e of at) {
    let ok = false;
    if (Array.isArray(e) && Number.isFinite(e[0]) && Number.isInteger(e[1]) && e[1] >= 0 && typeof e[2] === 'string') {
      for (let j = firstFrom(e[0] - CUTS_T_EPS); j < units.length && units[j].start - e[0] < CUTS_T_EPS; j++) {
        if (Math.abs(units[j].start - e[0]) < CUTS_T_EPS && wordsAt(j)[e[1]] === e[2]) {
          if (!marks.has(j)) marks.set(j, new Set());
          marks.get(j).add(e[1]);
          ok = true;
          break;
        }
      }
    }
    if (!ok) bad++;
  }
  if (bad / at.length > CUTS_BAD_MAX || !marks.size) return null;
  return new Map([...marks].map(([j, ws]) => [j, [...ws].sort((a, b) => a - b)]));
}

const round3 = (x) => Math.round(x * 1000) / 1000;

// 一条在词下标 ws（升序、都 > 0）处劈成几段，cut0 = 这一条的开头本身就是断点。每段 { start, end, gs, ge, turns, kara, cut }，cut 为真 = 这一段是新句的开头。
// - 劈开的时刻（start / end，整句的开始、结束用它）：有逐词时间（kara）且「个数和词数一样、每个词的字也一样」，用 kara 里第 w 个词的开始；
//   否则按字符数比例在 start–end 之间插值（取整到毫秒）。
//   只个数一样不够（一处多一个词、另一处少一个词，个数碰巧相等，中间就全错位了），所以逐个核对字；
//   这一条里每一刀的 kara 时刻必须严格升序、且都落在「条头之后、本条结束 / 下一条开始之前」的开区间里才用（数据自相矛盾，用了会劈出零时长的句子）；
//   有一刀不合格，这一条的刀【全部】退回比例，不混用——混用时退回去的比例时刻可能早于前一刀的 kara 时刻，被压成同一刻，
//   劈出零时长的段（常见：自动字幕条尾被截到下一条开头，尾部词的真实时刻晚于条尾，两刀紧挨着时中了这种）；
// - 保底判断用的时刻（gs / ge，joinByCuts 的「间隔 > MAX_GAP、跨度 > MAX_SPAN」只看它）：一律按字符数比例估，不看 kara。
//   这样哪几条接成一句、每句什么字只由 cuts 和保底说了算，有没有逐词时间都一样——整句的文字进翻译指纹（mergeVer + 全部原文），
//   劈开的时刻若能左右保底，同一份字幕有没有 kara 就会算出两个指纹（译文、校准、排序进度全不认）；
// - 说话人：按词所在的说话人段切开，分隔号（dash）留在原来那段（从一段中间劈出来的后半段不再有分隔号）；
// - kara：个数对得上按词下标分，对不上按开始时刻落在哪一段分
// - 劈开的时刻不晚于下一条的开始（nextStart）：两条时间重叠（两人抢话）时，劈出来的后半段不能排到下一条后面，否则整句列表的开始时刻不再升序，lineIndexAt 的二分会找错
function splitUnit(u, ws, cut0, nextStart = Infinity) {
  const words = wordsOfTurns(u.turns);
  const n = words.length;
  const byKara = !!u.kara && u.kara.length === n && u.kara.every((s, k) => s.text === words[k]);
  const off = [0];
  for (const w of words) off.push(off[off.length - 1] + w.length + 1);
  const bounds = [0, ...ws, n];
  const times = [u.start];    // 输出用：能用 kara 的刀用 kara
  const gtimes = [u.start];   // 保底判断用：一律按字符比例估
  const tMax = Math.min(u.end, Math.max(nextStart, u.start));
  // kara 给的各刀时刻：严格升序地落在（条头, tMax）里才用，有一刀不合格整条都不用
  let kts = byKara ? ws.map((w) => u.kara[w].start) : null;
  if (kts) {
    let last = u.start;
    if (!kts.every((t) => { const ok = t > last && t < tMax; last = t; return ok; })) kts = null;
  }
  for (const w of ws) {
    const prev = times[times.length - 1];
    let g = u.start + (u.end - u.start) * (off[w] / off[n]);
    const r = round3(g);
    if (r > u.start && r < u.end) g = r;
    g = Math.min(Math.max(g, gtimes[gtimes.length - 1]), tMax);
    gtimes.push(g);
    times.push(kts ? kts[times.length - 1] : Math.min(Math.max(g, prev), tMax));
  }
  const parts = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const turns = [];
    let c0 = 0;
    for (const t of u.turns) {
      const c1 = c0 + t.text.split(' ').filter(Boolean).length;
      const lo = Math.max(a, c0);
      const hi = Math.min(b, c1);
      if (lo < hi) turns.push({ dash: t.dash && a <= c0, text: words.slice(lo, hi).join(' ') });
      c0 = c1;
    }
    let kara = null;
    if (u.kara) {
      kara = byKara ? u.kara.slice(a, b) : u.kara.filter((s) => {
        let p = 0;
        while (p + 1 < times.length && s.start >= times[p + 1]) p++;
        return p === k;
      });
      if (!kara.length) kara = null;
    }
    const inner = k + 1 < bounds.length - 1;
    parts.push({ start: times[k], end: inner ? times[k + 1] : u.end, gs: gtimes[k], ge: inner ? gtimes[k + 1] : u.end, turns, kara, cut: k > 0 || cut0 });
  }
  return parts;
}

// 按 cuts 把条劈开，返回新的条列表（每条有 cut 标记）；cuts 用不了返回 null
function applyCuts(units, cuts) {
  const marks = matchCuts(units, cuts);
  if (!marks) return null;
  const out = [];
  units.forEach((u, j) => {
    const ws = marks.get(j);
    if (!ws) { out.push(u); return; }
    const inner = ws.filter((w) => w > 0);
    if (!inner.length) out.push({ ...u, cut: true });
    else out.push(...splitUnit(u, inner, ws[0] === 0, units[j + 1]?.start));
  });
  return out;
}

// 把后一条 u 接到当前这句 cur 后面（m4 和 cuts 模式共用一份，写法完全一样）
function absorb(cur, u) {
  const [first, ...rest] = u.turns;
  if (first.dash) cur.turns.push(first);
  else cur.turns[cur.turns.length - 1].text = join(cur.turns[cur.turns.length - 1].text, first.text);
  cur.turns.push(...rest);
  // 结束时间取最大：后开始的一条可能先结束（两人台词重叠）
  cur.end = Math.max(cur.end, u.end);
  if (u.kara) cur.kara = [...(cur.kara || []), ...u.kara];
}
const startSentence = (u) => ({ start: u.start, end: u.end, turns: u.turns.map((t) => ({ ...t })), kara: u.kara ? [...u.kara] : null });

// cuts 模式的接句：碰到断点开头的条就断；间隔 > MAX_GAP、跨度 > MAX_SPAN 也断（保底）。标点、词数一概不看
// 保底只看劈条时按字符比例估的时刻（gs / ge，没劈过的条就是它自己的 start / end），不看逐词时间——见 splitUnit
function joinByCuts(parts) {
  const out = [];
  let cur = null;
  let gStart = 0;
  let gEnd = 0;
  for (const u of parts) {
    const us = u.gs ?? u.start;
    const ue = u.ge ?? u.end;
    if (cur) {
      if (!(u.cut || gapOf(gEnd, us) > MAX_GAP || ue - gStart > MAX_SPAN)) { absorb(cur, u); gEnd = Math.max(gEnd, ue); continue; }
      out.push(cur);
    }
    cur = startSentence(u);
    gStart = us;
    gEnd = ue;
  }
  if (cur) out.push(cur);
  return out;
}

// lines: buildLines() 的输出 [{i, start, end, text}]（已排序）；返回同样形状的整句列表，i 重新编号。
// opts：不传就是现行版本（m4 的合并 + m5 的两条路）。
//   算上一版的老指纹时传 PREV_MERGE（m3）——minGap 0.6（间隔小于它就并）、rawGap true（间隔不取整到毫秒），这时没有 m5 的两条路；
//   m5 轨算它的 m4 老指纹时传 M4_MERGE（m5: false）；
//   cuts：字幕文件顶层的 cuts（见头部 m5），只有 m5 开着、这条轨走英文合句那一路才用；用得上就按 cuts 断，用不上退回规则 1 / m4。
// 走了规则 1 或 cuts 的，每个整句对象多一个 mv: 5；没走的和 m4 一字不差（不加字段）
// breaksOut（分段早翻译，partialLines 用）：传一个空数组进来，往里记「同步断点」——输出里哪些整句是紧跟在同步断点后面开头的（整句下标，从小到大）。
//   同步断点 = 因为「上一条是句末且间隔够大」或「间隔 > MAX_GAP」而断开的地方：只看相邻这一对条，和这句话从哪条开始累计无关，
//   所以读到一半的字幕（头被截掉）和读全的整轨在这里断得一样；靠词数封顶（WORD_CAP）、跨度封顶（MAX_SPAN）断的取决于累计起点，不记。
//   不合句（不像英文）、规则 1 是一条字幕一句，每个边界都是同步的：数组上记 .all = true，不一个个写；
//   走了「规则 1 还是合句」这一判断的（英文、没 cuts），还在数组上记 .ratio（句末带标点的条数占比）和 .n（条数）：占比离 RULE1_RATIO 太近的小样本，
//   读到的这一段和读全的整轨可能判得不一样（partialLines 据此把整段当不定稿）。
//   cuts 路不记（也不标 all）：partialLines 从来不传 cuts，用 cuts 的场景用不着，按「没有同步断点」处理最保守。
//   只记录，不影响任何输出：断句结果、输出的句子对象（不加字段）、传进来的 lines 都和不传时一字不差。
export function mergeSentences(lines, { minGap = MIN_GAP, rawGap = false, m5 = !rawGap, cuts = null, breaksOut = null } = {}) {
  // kara：逐词时间，合并成整句时按先后接起来
  const units = lines
    .map((l) => ({ start: l.start, end: l.end, turns: speakersOf(l.text), kara: l.kara || null }))
    .filter((u) => u.turns.length);
  const out = [];
  let mv5 = false;
  if (!looksEnglish(lines)) { out.push(...units); if (breaksOut) breaksOut.all = true; }
  else {
    const cutParts = m5 && cuts ? applyCuts(units, cuts) : null;
    if (cutParts) {
      mv5 = true;
      out.push(...joinByCuts(cutParts));
    } else if (m5 && (breaksOut ? (breaksOut.ratio = punctRatio(units), breaksOut.n = units.length, breaksOut.ratio) : punctRatio(units)) < RULE1_RATIO) {
      // 规则 1：整轨几乎没有句末标点，m4 等不到句号只会拖满 20 秒才断——不拼，一条字幕一句
      mv5 = true;
      out.push(...units);
      if (breaksOut) breaksOut.all = true;
    } else {
      let cur = null;
      let prev = null; // 上一条字幕（同步断点只看相邻这一对）
      for (const u of units) {
        if (cur) {
          const gap = rawGap ? u.start - cur.end : gapOf(cur.end, u.start);
          const span = u.end - cur.start;
          const words = cur.turns.reduce((n, t) => n + wordCount(t.text), 0);
          const hard = isHardEnd(cur);
          const brk = (hard && (gap >= minGap || words >= WORD_CAP)) || gap > MAX_GAP || span > MAX_SPAN;
          if (!brk) { absorb(cur, u); prev = u; continue; }
          out.push(cur);
          if (breaksOut && ((hard && ownHardEnd(prev) && gap >= minGap) || gap > MAX_GAP)) breaksOut.push(out.length);
        }
        cur = startSentence(u);
        prev = u;
      }
      if (cur) out.push(cur);
    }
  }
  return out.map(({ start, end, turns, kara }, i) => {
    const s = kara ? { i, start, end, text: render(turns), kara } : { i, start, end, text: render(turns) };
    if (mv5) s.mv = MV_M5;
    return s;
  });
}
