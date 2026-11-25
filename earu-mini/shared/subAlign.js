// 字幕自动校准的对齐数学：全是纯函数，Node 里直接测。
//
// 两层最后都落到同一条直线：真实时间 = k × 字幕时间 + b（k 是比例，≈1；b 是偏移，秒）。
//   第 1 层（浏览器里免费做，vadAlign）：人声模型（Silero）每 32 毫秒给一个「是不是人在说话」，在「比例 × 偏移」里找
//     字幕区间和人声区间最吻合的一组（二值皮尔逊相关，前缀和算，一组参数只要 O(条数)）；再切 5 段各自找偏移，看是不是都贴着这条直线。
//   第 2 层（外部听写抽 5 段各 60 秒，anchorAlign）：每句开头几个词 / 几个字在听写里原样出现 = 一个锚点（字幕时间 ↔ 真正说出来的时间），
//     稳健直线（Theil–Sen：两两斜率的中位数）。
// 实测（两集真实剧集）：第 1 层 k 0.99930 / 0.99900，和整集听写比中位差 0.10–0.11 秒；
// 对的字幕相关 0.50–0.52、配错集的 0.05–0.09。下面的门槛都是照这些数定的，改之前先重新实测。

export const ALIGN = Object.freeze({
  SR: 16000,                 // 人声模型吃 16 kHz 单声道
  HOP: 512,                  // 每块 512 个样本 = 32 毫秒（Silero v5 在 16 kHz 下的块长）
  CTX: 64,                   // 每块前面带上一块最后 64 个样本当上下文（Silero v5 的规矩）
  STEP: 512 / 16000,         // 一格多长（秒）
  SPEECH_P: 0.5,             // 人声概率 > 0.5 算「在说话」
  // 找直线
  K_BASES: [1, 1000 / 1001, 1001 / 1000, 23.976 / 25, 25 / 23.976],   // 常见的帧率错配：没有、23.976↔24、23.976↔25
  K_SPREAD: 0.0004,          // 每个基准比例上下再各试 4 档
  K_STEP: 0.0001,
  OFFSET_RANGE: 10,          // 偏移在 ±10 秒里找
  FINE_STEP: 0.005,          // 粗找（半格 16 毫秒）以后在 ±1 格里按 5 毫秒细找
  // 把握度（实测定的）
  CORR_MIN: 0.3,             // 相关不到 0.3 不算（对的 0.50–0.54；配错集的 0.05–0.09）
  SEG_N: 5,                  // 整部片切 5 段
  SEG_RANGE: 1.5,            // 每段在全局直线附近 ±1.5 秒里单独找偏移
  SEG_DEV: 0.25,             // 每段偏离全局直线不超过 0.25 秒（对的两集最大 0.16；配错集的 0.5–1.5）
  SEG_MIN_CUES: 5,           // 一段里不到 5 条字幕（片头曲、长段配乐）：这段不算数
  SEG_MIN_OK: 3,             // 算数的段至少 3 段（短片段数不到 3 的：每段都要算数）
  // 10 分钟以下的短片：照长片切 5 段每段只有 1 分钟左右，±1.5 秒里常找到假峰（说话轮流、停顿有节奏），
  // 两集真集切出来的 3–10 分钟片段只有 23% 有把握，大多白白去走花钱的第 2 层。改成每段至少约 2 分钟（段数 = 片长 ÷ 2 分钟，2–5 段）、
  // 每段只在全局偏移 ±0.5 秒里找、找到的最好位置贴在搜索边上（这段里根本没有峰：配乐、片头曲）这段不算数——有把握 65–67%（真模型），
  // 改坏的比例不升（0.6%，原来 1.1%）、配错集照样 0 个有把握
  SHORT_SEG_SECS: 120,
  SHORT_SEG_RANGE: 0.5,
  // 改不改
  SHORT_SECS: 600,           // 10 分钟以下只算偏移（比例固定 1：太短算不准比例，2 分钟的示例片会算出 0.9987 的假比例）
  SHORT_MIN_FIX: 0.2,        // 短片偏移不到 0.2 秒不改
  MIN_FIX: 0.15,             // 长片整部片最大改动不到 0.15 秒不改
  // 哪些片子才校准
  MIN_CUES: 20,              // 不到 20 句的不校准（测试片、片段）
  MIN_SECS: 120,             // 不到 2 分钟的不校准
  // 第 2 层
  WIN_SECS: 60,              // 一段听 60 秒
  WIN_AT: [0.1, 0.3, 0.5, 0.7, 0.9],
  ANCHOR_WORDS: 3,           // 英文（拉丁字母的语言）：一句开头连续 3 个词和听写一样
  ANCHOR_CHARS: 4,           // 中日韩：一句开头连续 4 个字和听写一样
  ANCHOR_NEAR: 12,           // 第一遍在字幕时间 ±12 秒里找锚点，定个大概的偏移
  ANCHOR_NEAR2: 3,           // 第二遍在「字幕时间 + 大概偏移」±3 秒里找
  MIN_ANCHORS_WIN: 4,        // 一段至少 4 个锚点才算这段听出来了
  WIN_OK_SHARE: 0.6,         // 听出来的段至少占六成（5 段里 3 段）
  WIN_DISAGREE: 0.3,         // 各段对直线的残差（中位数）超过 0.3 秒 = 中间有剪辑跳变，不校准
  TS_MIN_DX: 120,            // Theil–Sen 只用相隔 2 分钟以上的两个锚点算斜率（隔得近的斜率全是噪声）
  // 存下来、拿来用之前的合理范围（读缓存时按它挡）
  K_MIN: 0.95, K_MAX: 1.06, B_MAX: 15,
  // 比例只认常见帧率比（K_BASES）上下 0.0005 以内的：第 1 层本来就只在这些附近找；第 2 层的 Theil–Sen 算出别的数
  // 多半是锚点有问题，不校准——也让人造假声音能挪动的幅度小很多（原来 0.95–1.06 之间都收，22 分钟的片能挪一分多钟）
  K_TOL: 0.0005,
  // 「不校准」的结论（第 2 层听出来不是这一版字幕、不是在学的语言……）30 天后作废、可以再试
  NEG_TTL_DAYS: 30,
});

// 比例是不是常见的帧率比（K_BASES 上下 K_TOL 以内）
export const kPlausible = (k) => typeof k === 'number' && Number.isFinite(k) && ALIGN.K_BASES.some((k0) => Math.abs(k - k0) <= ALIGN.K_TOL + 1e-12);

// 所有比例候选：五个基准各 ±0.0004（步长 0.0001），去重
export function kCandidates() {
  const out = [];
  for (const k0 of ALIGN.K_BASES) {
    for (let d = -ALIGN.K_SPREAD; d <= ALIGN.K_SPREAD + 1e-9; d += ALIGN.K_STEP) {
      const k = Math.round((k0 + d) * 1e7) / 1e7;
      if (!out.some((x) => Math.abs(x - k) < 1e-8)) out.push(k);
    }
  }
  return out;
}

const median = (a) => {
  if (!a.length) return NaN;
  const b = Float64Array.from(a).sort();
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
export { median };

// 人声概率 → 0/1（> SPEECH_P 算在说话）
export function speechFrames(probs, p = ALIGN.SPEECH_P) {
  const s = new Uint8Array(probs.length);
  for (let i = 0; i < probs.length; i++) s[i] = probs[i] > p ? 1 : 0;
  return s;
}

// 字幕区间（[[起, 止], …] 或平铺的 [起, 止, 起, 止, …]）整理成按起点排好、互不重叠的两列：两人台词重叠的地方只算一次，
// 不然相关系数里「字幕覆盖了几格」会多数（比例≈1，先在字幕时间里并、再换算，和换算以后再并一样）
export function cueSpans(cues) {
  const pairs = [];
  if (cues && typeof cues[0] === 'number') { for (let i = 0; i + 1 < cues.length; i += 2) pairs.push([cues[i], cues[i + 1]]); }
  else for (const c of cues || []) pairs.push(Array.isArray(c) ? [c[0], c[1]] : [c.start, c.end]);
  const ok = pairs.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const S = [], E = [];
  for (const [s, e] of ok) {
    if (S.length && s <= E[E.length - 1]) { E[E.length - 1] = Math.max(E[E.length - 1], e); continue; }
    S.push(s); E.push(e);
  }
  return { S: Float64Array.from(S), E: Float64Array.from(E) };
}

// ---- 第 1 层 ----
// speech：每格 0/1（speechFrames）；cues：字幕区间（合句之前的每一条，见 cueSpans）；
// opts.duration：片长（秒，判是不是 10 分钟以下的短片；不给按声音长度）；opts.step：一格多长。
// 回 { k, b, corr, segs: [{ q, dev, corr, n } | null], sure, short, cues: 条数 }。sure = 相关够、各段都贴着直线（见 ALIGN 的把握度）
export function vadAlign(speech, cues, { step = ALIGN.STEP, duration = null } = {}) {
  const N = speech.length;
  const pre = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + speech[i];
  const { S, E } = cueSpans(cues);
  const M = S.length;
  const dur = Number.isFinite(duration) && duration > 0 ? duration : N * step;
  const short = dur < ALIGN.SHORT_SECS;
  const empty = { k: 1, b: 0, corr: 0, segs: [], sure: false, short, cues: M };
  if (!N || !M || !pre[N]) return empty;

  // 区间 [c0, c1) 这几条字幕按 (k, b) 换算以后，和第 lo..hi 格的人声的二值皮尔逊相关
  const corr = (c0, c1, k, b, lo, hi) => {
    let on = 0, all = 0;
    for (let i = c0; i < c1; i++) {
      let a = Math.floor((k * S[i] + b) / step), z = Math.floor((k * E[i] + b) / step);
      if (a < lo) a = lo;
      if (z > hi) z = hi;
      if (z > a) { on += pre[z] - pre[a]; all += z - a; }
    }
    const n = hi - lo, sp = pre[hi] - pre[lo];
    const den = Math.sqrt(all * (n - all) * sp * (n - sp));
    return den ? (n * on - all * sp) / den : -1;
  };
  // 在比例 ks × 偏移 b0 ± range 里找最好的一组：先按半格粗找，再在 ±1 格里按 5 毫秒细找
  const best = (c0, c1, ks, lo, hi, range, b0) => {
    let r = { c: -9, k: ks[0], b: b0 };
    const st = step / 2;
    for (const k of ks) {
      for (let b = b0 - range; b <= b0 + range + 1e-9; b += st) {
        const c = corr(c0, c1, k, b, lo, hi);
        if (c > r.c) r = { c, k, b };
      }
    }
    const k = r.k, b1 = r.b;
    for (let b = b1 - step; b <= b1 + step + 1e-9; b += ALIGN.FINE_STEP) {
      const c = corr(c0, c1, k, b, lo, hi);
      if (c > r.c) r = { c, k, b };
    }
    return r;
  };

  const g = best(0, M, short ? [1] : kCandidates(), 0, N, ALIGN.OFFSET_RANGE, 0);
  // 把握度：切几段（长片 5 段；短片每段至少约 2 分钟，2–5 段），每段在全局比例下单独找偏移（长片全局偏移 ±1.5 秒里、短片 ±0.5 秒里），
  // 看是不是都贴着全局直线
  const nseg = segCount(dur);
  const range = short ? ALIGN.SHORT_SEG_RANGE : ALIGN.SEG_RANGE;
  const segs = [];
  for (let q = 0; q < nseg; q++) {
    const lo = Math.floor((q * N) / nseg), hi = Math.floor(((q + 1) * N) / nseg);
    // 换算以后起点落在这一段里的字幕（单调，二分找下标范围）
    const at = (frame) => {
      let a = 0, z = M;
      while (a < z) { const m = (a + z) >> 1; if ((g.k * S[m] + g.b) / step < frame) a = m + 1; else z = m; }
      return a;
    };
    const c0 = at(lo), c1 = at(hi);
    if (c1 - c0 < ALIGN.SEG_MIN_CUES) { segs.push(null); continue; }
    const r = best(c0, c1, [g.k], lo, hi, range, g.b);
    // 贴在搜索边上：这段里没有峰（只是往边上越走越高），短片这段不算数（长片照原样：偏离超过 0.25 秒就是没把握）
    const edge = Math.abs(r.b - g.b) >= range - step;
    segs.push({ q, dev: r.b - g.b, corr: r.c, n: c1 - c0, edge });
  }
  const used = segs.filter((s) => s && !(short && s.edge));
  const sure = g.c >= ALIGN.CORR_MIN && used.length >= Math.min(ALIGN.SEG_MIN_OK, nseg) && used.every((s) => Math.abs(s.dev) <= ALIGN.SEG_DEV);
  return { k: g.k, b: g.b, corr: g.c, segs, sure, short, cues: M };
}
// 第 1 层切几段：长片 5 段；10 分钟以下每段至少约 2 分钟（片长 ÷ 2 分钟取整），2–5 段
export const segCount = (dur) => (dur < ALIGN.SHORT_SECS ? Math.max(2, Math.min(ALIGN.SEG_N, Math.floor(dur / ALIGN.SHORT_SEG_SECS))) : ALIGN.SEG_N);

// ---- 改不改（两层共用）----
// 整部片最大改动：直线和「不改」之差在第一句、最后一句两头最大（一次函数）
export const maxFixOf = ({ k, b }, first, last) => Math.max(Math.abs((k - 1) * first + b), Math.abs((k - 1) * last + b));
// first / last：第一句的开始、最后一句的结束（秒）；short：10 分钟以下的短片（只算偏移，比例是 1）。
// 回 { apply, maxFix }：短片偏移 ≥ 0.2 秒才改；长片整部片最大改动 ≥ 0.15 秒才改（不到就当本来就对得上）
export function decide(cal, { first, last, short }) {
  const maxFix = maxFixOf(cal, first, last);
  const apply = short ? Math.abs(cal.b) >= ALIGN.SHORT_MIN_FIX : maxFix >= ALIGN.MIN_FIX;
  return { apply, maxFix: Math.round(maxFix * 1000) / 1000 };
}

// 两份句子列表是不是同一份字幕（条数、每句文字一样，只有时间可能不同）：播放器按它判断只换时间（保住循环）还是整份换
export function sameSentences(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]?.text !== b[i]?.text) return false;
  return true;
}

// 中日韩的字（拿来当锚点的那种）
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export const isCjkLang = (lang) => /^(zh|ja|ko)/.test(String(lang || ''));
// 一句字幕 → 拿来比的单位：英文是小写的词（只留字母数字和撇号；音效标注合句时已经剥掉了），中日韩是一个个字（标点、空格、拉丁字母都不要）
export function unitsOf(text, lang) {
  const s = String(text || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'");
  if (isCjkLang(lang)) return [...s].filter((c) => CJK_RE.test(c));
  return s.split(/[^\p{L}\p{N}']+/u).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);
}

// 稳健直线（Theil–Sen）：比例 = 相隔 2 分钟以上的两两锚点斜率的中位数，偏移 = 「真实 − 比例 × 字幕」的中位数。短片比例固定 1
export function theilSen(anchors, { short = false } = {}) {
  let k = 1;
  if (!short) {
    const sl = [];
    for (let a = 0; a < anchors.length; a++) {
      for (let c = a + 1; c < anchors.length; c++) {
        const dx = anchors[c].sub - anchors[a].sub;
        if (dx > ALIGN.TS_MIN_DX) sl.push((anchors[c].real - anchors[a].real) / dx);
      }
    }
    if (sl.length) k = median(sl);
  }
  const b = median(anchors.map((p) => p.real - k * p.sub));
  return { k, b };
}

// 第 2 层的结论：{ ok, why?, k, b, anchors, perWin: [{ w, n, med }] }。
//   why 'anchors'：锚点太少（听出来的段不到六成，或者总数不够）——字幕不是这一版、是意译；
//   why 'jumps'：某一段对直线的残差中位数超过 0.3 秒——中间有剪辑跳变，一条直线校不了（以后再考虑整集听写逐句修）；
//   why 'range'：算出来的比例 / 偏移离谱（比例不是常见的帧率比 ±0.0005，见 kPlausible）
export function anchorAlign({ anchors, windows, short = false }) {
  const perWin = windows.map((w) => ({ w: w.i, n: anchors.filter((a) => a.w === w.i).length, med: null }));
  const good = perWin.filter((p) => p.n >= ALIGN.MIN_ANCHORS_WIN);
  const base = { anchors: anchors.length, perWin };
  if (!windows.length || good.length < Math.ceil(windows.length * ALIGN.WIN_OK_SHARE) || anchors.length < ALIGN.MIN_ANCHORS_WIN * good.length) {
    return { ok: false, why: 'anchors', k: 1, b: 0, ...base };
  }
  const { k, b } = theilSen(anchors, { short });
  if (!(k >= ALIGN.K_MIN && k <= ALIGN.K_MAX) || !(Math.abs(b) <= ALIGN.B_MAX)) return { ok: false, why: 'range', k, b, ...base };
  for (const p of perWin) {
    if (p.n < 3) continue;
    p.med = median(anchors.filter((a) => a.w === p.w).map((a) => a.real - (k * a.sub + b)));
  }
  if (perWin.some((p) => p.med != null && Math.abs(p.med) > ALIGN.WIN_DISAGREE)) return { ok: false, why: 'jumps', k, b, ...base };
  // 各段都贴着直线、比例却不是常见的帧率比：多半是锚点有问题（或者有人造了假声音），不校准
  if (!kPlausible(k)) return { ok: false, why: 'range', k, b, ...base };
  return { ok: true, k, b, ...base };
}

// ---- 存下来的校准结果 ----
// { v: 1, layer: 1 | 2, ok, apply, k, b, maxFix, corr?, anchors?, why?, at }：
//   ok：有把握（直线可信；apply 说要不要改，maxFix 是整部片最大改动）；ok 为 false 时 why 说为什么（'unsure' 第 1 层没把握、
//   'lang' 听写出来不是在学的语言、'anchors' / 'jumps' / 'range' 见 anchorAlign、'nospeech' 声音里没听到人声）。
// 读缓存时过一遍：字段不对、数离谱的回 null（宁可当没校准过，也不拿一条离谱的直线去改字幕）
const WHY = new Set(['unsure', 'lang', 'anchors', 'jumps', 'range', 'nospeech', 'codec']);
