// 听写练习的「这一场」：当前这道题、每句的统计（hints / secs / loops）、眼睛 / 偷看译文的闸门和次数、「看过答案」的本机记录。
// 和 core/sort/session.js 同形（subscribe / getSnapshot / show / clear / setVisible / countLoop / statsFor / resetAll / dispose），
// 快照也同形：{puzzle, visible, hint, zhPeek}，所以 useStudySession 里的 display / masks / peek 整条下游不用改。
// 不依赖 React、不碰 DOM；时钟、存储、日期从外面注入，Node 里能用假的测。
//
// 和排序会话的差别：
//   · 闸门和排序同一套读秒（core/hintGate.js）：答案框真的摆在眼前满 10 秒才开眼睛、译文偷看，之前 hint.state 是 'waiting'、带 leftSec。
//     原来的「这一句循环听完一遍 / 自然播过一遍」闸门取消。
//   · 答案框是「一词一格」：每个词位一格，格子里的字和回车判出的对错（verdict）存在会话里（setCell / getCells / getVerdict），
//     不放进快照：每敲一个键就换快照，整棵树都跟着重画。快照只在「第一次打字 / 清空」「眼睛」「全对」这几下才变。
//     回车（check）一起判：对的格子锁住（setCell 不收），错的标红；错的格子重打了不消红、变蓝（'fixed'，改过还没再判），
//     下次判之前一直算错的格子，光标只在它们之间走（core/dictation/keys.js）
//   · 预填：长句先替用户填好几个词，几个、挑哪几个见 prefill.js（按难度档，会话用 setGrade 记着当前档，
//     下一句起生效）。预填的格子显示正确答案、锁住（setCell 不收、getVerdict 回 'ok'，界面的光标、空格、退格本来就绕开锁住的格子），
//     回车判对错时按对的算，不算提示；字只在读取时叠上去（getCells），不放进 input.cells，所以「答案框里有没有字」「判过没有」都只看用户自己的格子。
//     计分和上报仍按整句：words / slots 是全部词位数，presetN 带预填了几个
//   · 学的语言：lang（createDictSession 的入参，setLang 随时改，下一句起生效；不传＝英语，行为一字不差）传给词位表、预填、判词。
//     西语少打重音符号（á→a）判成 'ok'（照样锁住、计对），另记「差一点」：getFixes(id)[k] = 这一格的正确拼法，界面把那格标黄、显示正确拼法；
//     不新增 verdict 状态，keys.js 的 isWrong 和锁格逻辑不用动
//   · 眼睛（peekEn）把原文亮 2 秒，视同看了答案
//   · 「看过答案 / 眼睛看过」按「本机日期 + 题目 id」存 localStorage（读写都 try/catch，存不了就只在内存里；换天作废），
//     重播、切句、退出后都保留；全对提交时据此算 peeked，计分时据此说明
import { layoutOf, judgeCellFix } from './judge.js';
import { pickPresets } from './prefill.js';
import { createHintGate } from '../hintGate.js';

export const EYE_SHOW_MS = 2000;      // 眼睛：原文亮 2 秒，然后收回（和排序的提示 2 秒一样）
export const STATS_MAX = 200;         // 每句统计最多留 200 句，满了丢最久没碰的（和排序一样）
export const SECS_CAP = 999;          // 一句挂一下午不该把平均值拉爆，只留 3 位
export const MARKS_KEY = 'earu.dictMarks.v1';
export const MARKS_MAX = 600;         // 一天最多记 600 句的「看过答案」，满了丢最旧的

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

const pad = (n) => String(n).padStart(2, '0');
// 本机日期 YYYY-MM-DD（换天作废用本地时间，不是 UTC）
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// 「看过答案」的本机记录：{day, m: {题目id: {r: 看了答案, e: 眼睛看过原文}}}。
// storage：{getItem, setItem}，默认 localStorage（取不到、读写抛错都当没有，只在内存里记）；today()：当天日期串。
// owner：用户标识（值或每次现取的函数）。同一台电脑换用户，不能把上一个人的「看过答案」带过来：拿得到就存在 MARKS_KEY.<owner> 下，
// 拿不到（没有标识）照旧用 MARKS_KEY 本身（老键兼容）
export function marksKey(owner) {
  const o = owner == null ? '' : String(owner);
  return o ? `${MARKS_KEY}.${o}` : MARKS_KEY;
}
export function createMarks({ storage, today = localDay, owner } = {}) {
  const st = storage === undefined ? browserStorage() : storage;
  let data = null;
  let dataKey = '';
  function load() {
    const day = today();
    const key = marksKey(typeof owner === 'function' ? owner() : owner);
    if (data && data.day === day && dataKey === key) return data;
    let raw = null;
    try { raw = JSON.parse(st?.getItem(key) ?? 'null'); } catch { raw = null; }
    data = raw && raw.day === day && raw.m && typeof raw.m === 'object' ? { day, m: raw.m } : { day, m: {} };
    dataKey = key;
    return data;
  }
  function save() {
    try { st?.setItem(dataKey, JSON.stringify(data)); } catch { /* 存不了就只在内存里 */ }
  }
  return {
    get(id) {
      const r = load().m[id];
      return { revealed: !!r?.r, eye: !!r?.e };
    },
    // patch：{revealed?, eye?}，只改给了的几项
    set(id, patch) {
      const d = load();
      const cur = this.get(id);
      const next = { r: patch.revealed ?? cur.revealed ? 1 : 0, e: patch.eye ?? cur.eye ? 1 : 0 };
      delete d.m[id];      // 挪到队尾：满了丢队头（最久没碰的）
      d.m[id] = next;
      const keys = Object.keys(d.m);
      for (let k = 0; k < keys.length - MARKS_MAX; k++) delete d.m[keys[k]];
      save();
    },
  };
}

// 看过答案没有（design 9.3）：看了答案（老版本留下的当天记录）∨ 眼睛看过原文
export function isPeeked(mark) {
  return !!mark && (mark.revealed || mark.eye);
}

// 答案框里有字时，题目的 answer 里放这一项（isInProgress 看的是「有没有非预摆的词」）
const TYPED = Object.freeze({ id: 'typed', i: 0, text: '' });

// clock：{now(), setTimeout(fn, ms), clearTimeout(h)}，默认真时钟。marks：createMarks() 的结果，默认用 localStorage。
// onSolved({id, text, words, slots, presetN, peeked, stats})：真正全对的那一刻调一次；stats = {hints, secs, loops}。
export function createDictSession({ clock = realClock, marks = createMarks(), onSolved, lang: lang0 } = {}) {
  // 手上这一题：cur 是会变的内部状态，puzzle 是据此做出来、交给界面的不可变快照对象
  let cur = null;            // {id, source, shown, layout, solved, eye, touched}
  let puzzle = null;
  let visible = false;
  let eyeTimer = null;
  let snapshot = null;
  // 答案框各格的字、回车判出的对错（'ok' / 'bad' / 'empty'，没判过是 undefined）、判错以后动过没有（edited）。只记手上这一题的
  const blank = (id) => ({ id, cells: [], verdict: [], edited: [], fixes: [] });
  let input = blank('');
  let lang = typeof lang0 === 'string' ? lang0 : 'en';   // 学的语言（判词、词位表、预填按它）
  let grade;                 // 难度档（primary / middle / high / college），只用来定预填几个、挑哪些；不传按基础。改了从下一句起生效
  let tickTimer = null;      // 读秒的重画定时器（做题时视频多半暂停，没有 timeupdate 驱动）
  const gate = createHintGate(clock);   // 提示的读秒闸门，和排序共用（core/hintGate.js）
  const stampGate = () => gate.stamp(visible, cur?.id);
  let zhPeekId = '';
  const listeners = new Set();

  // ---- 每句的练习统计（和排序会话同一套口径，core/sort/session.js）----
  const stats = new Map();   // id → {hints, loops, startedAt}
  let statsKey = '';

  function startStats(id) {
    const prev = stats.get(id);
    if (prev && statsKey === id) return;
    if (prev) {
      stats.delete(id);
      prev.startedAt = clock.now();
      stats.set(id, prev);
    } else {
      stats.set(id, { hints: 0, loops: 0, startedAt: clock.now() });
      while (stats.size > STATS_MAX) stats.delete(stats.keys().next().value);
    }
    statsKey = id;
  }
  function bump(id, field) {
    const rec = id ? stats.get(id) : null;
    if (rec) rec[field] += 1;
  }
  function statsFor(id = puzzle?.id) {
    const rec = id ? stats.get(id) : null;
    if (!rec) return { hints: 0, secs: 0, loops: 0 };
    const secs = rec.startedAt != null ? Math.min(SECS_CAP, Math.max(0, Math.round((clock.now() - rec.startedAt) / 1000))) : 0;
    return { hints: rec.hints, secs, loops: rec.loops };
  }

  // ---- 题目 ----
  function materialize() {
    if (!cur) return null;
    const { slots, parts } = cur.layout;
    const typed = input.id === cur.id && input.cells.some((c) => c);
    return {
      id: cur.id,
      text: cur.shown,
      orig: cur.source,
      parts,
      slots,
      solved: cur.solved,
      touched: cur.touched,
      // 眼睛亮着的这 2 秒里是 true（下游 peek.en、isInProgress 看它）；平时是 null
      hint: cur.eye ? true : null,
      peeked: isPeeked(marks.get(cur.id)),
      // 下面几项是和排序题同形用的：答案框有字就当「有一个非预摆的词」（isInProgress），没有中文标注、没有预摆、没有词块
      answer: typed ? [TYPED] : [],
      preset: cur.preset,      // 预填的词位序号（排序题里是预摆的位置，同名同形；听写下游只有答题区自己读它）
      bank: [],
      zh: false,
    };
  }

  // 提示按钮的状态（沿用排序的取值，hint.state）：
  //   none 没有题｜solved 已全对｜showing 眼睛亮着的 2 秒｜hidden 面板不在眼前｜
  //   waiting 答案框摆出来后的 10 秒内（leftSec 是还剩几秒，按钮写「提示 · 还有 N 秒」）｜ready 可以点
  function hintStatus() {
    if (!puzzle) return { state: 'none', leftSec: 0 };
    if (puzzle.solved) return { state: 'solved', leftSec: 0 };
    if (puzzle.hint) return { state: 'showing', leftSec: 0 };
    if (!visible) return { state: 'hidden', leftSec: 0 };
    return gate.status(puzzle.id);
  }

  function emit() {
    puzzle = materialize();
    const hint = hintStatus();
    snapshot = { puzzle, visible, hint, zhPeek: !!puzzle && zhPeekId === puzzle.id };
    if (tickTimer != null) { clock.clearTimeout(tickTimer); tickTimer = null; }
    if (hint.state === 'waiting') {
      tickTimer = clock.setTimeout(() => { tickTimer = null; emit(); }, gate.nextTickMs(puzzle.id));
    }
    for (const fn of [...listeners]) fn();
  }

  function cancelEye() {
    if (eyeTimer != null) { clock.clearTimeout(eyeTimer); eyeTimer = null; }
  }

  function build(id, text, orig) {
    const source = orig == null ? String(text ?? '') : String(orig);
    const layout = layoutOf(text, source, lang);
    if (!layout.slots.length) return null;
    return { id, source, shown: String(text ?? ''), layout, ...presetsOf(layout), solved: false, eye: false, touched: false };
  }
  // 这个词位表要预填哪几个：{preset: [序号], presetSet}
  function presetsOf(layout) {
    const preset = pickPresets(layout, grade, lang);
    return { preset, presetSet: new Set(preset) };
  }
  const isPreset = (k) => !!cur?.presetSet?.has(k);

  snapshot = { puzzle, visible, hint: hintStatus(), zhPeek: false };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,

    // 当前句是这一句。id = 题目 id（字幕指纹:句号），text = 显示用的句子（恢复大小写后的），orig = 字幕原文（rawLines[i].text）。
    // 同一个 id 保留已打的字和各种状态，只在文字变了（恢复大小写晚到）时换词位；换了 id 出新题，答案框清空；这句剥完没词：没有题
    show(id, text, orig) {
      if (cur && cur.id === id) {
        const source = orig == null ? cur.source : String(orig);
        const shown = String(text ?? '');
        if (shown === cur.shown && source === cur.source) return;
        const layout = layoutOf(shown, source, lang);
        if (!layout.slots.length) return;
        if (layout.slots.length !== cur.layout.slots.length) {
          cur = { ...cur, shown, source, layout, ...presetsOf(layout) };
          // 格子数变了：多出来的格子丢掉，对错作废（重新回车判）；预填重挑了，落在预填格上的字也丢掉
          if (input.id === id) {
            input = { ...blank(id), cells: input.cells.slice(0, layout.slots.length).map((c, k) => (cur.presetSet.has(k) ? '' : c)) };
          }
        } else if (!cur.touched) {
          // 用户还没动过：大小写恢复晚到会让人名的判断变（全大写时一个人名都认不出），预填跟着重挑；挑出来不一样才清掉判错的记号。
          // 动过了就不换，免得正打着字、格子突然变了
          const next = presetsOf(layout);
          const same = next.preset.length === cur.preset.length && next.preset.every((k, j) => k === cur.preset[j]);
          cur = same ? { ...cur, shown, source, layout } : { ...cur, shown, source, layout, ...next };
          if (!same && input.id === id) input = blank(id);
        } else {
          cur = { ...cur, shown, source, layout };
        }
        emit();
        return;
      }
      cancelEye();
      const next = build(id, text, orig);
      if (input.id !== id) input = blank(id);
      if (next && zhPeekId && zhPeekId !== id) zhPeekId = '';
      cur = next;
      if (cur) { startStats(id); stampGate(); }
      emit();
    },

    // 此刻没有句子（播放头在空档里、面板清空）。统计、答案框里的字不清：清完又回到同一句时接着做
    clear() {
      if (!cur) return;
      cancelEye();
      cur = null;
      emit();
    },

    // 第 k 格的字（界面每次变化都告诉会话）。只有「有字 / 没字」翻转时才换快照。锁住了（全对、看了答案、这一格回车判过是对的）不收；
    // 判错的格子改了字照样算错的格子（getVerdict 回 'fixed' / 'empty'），下次回车再判
    setCell(k, value) {
      if (!cur || cur.solved || !(k >= 0 && k < cur.layout.slots.length)) return;
      if (isPreset(k)) return;
      if (input.id !== cur.id) input = blank(cur.id);
      if (input.verdict[k] === 'ok') return;
      const v = String(value ?? '');
      const had = input.cells.some((c) => c);
      const cells = [...input.cells];
      cells[k] = v;
      const edited = [...input.edited];
      if (input.verdict[k]) edited[k] = true;
      input = { ...input, cells, edited };
      const has = cells.some((c) => c);
      if (has && !cur.touched) { cur = { ...cur, touched: true }; emit(); return; }
      if (has !== had) emit();
    },
    // 各格的字。预填的格子在这里叠上正确答案（词位原文），用户自己的格子照旧
    getCells(id = cur?.id) {
      const own = input.id === id ? input.cells : [];
      if (!cur || cur.id !== id || !cur.preset.length) return own;
      const out = Array.from({ length: cur.layout.slots.length }, (_, k) => own[k] || '');
      for (const k of cur.preset) out[k] = cur.layout.slots[k].text;
      return out;
    },
    // 各格对错：'ok' 对（锁住；预填的格子一开始就是）｜'bad' 打错｜'empty' 没打（判错以后清空了也是）｜'fixed' 判错以后重打过、还没再判（蓝）｜undefined 没判过
    getVerdict(id = cur?.id) {
      const out = [];
      if (input.id === id) {
        const { verdict, edited, cells } = input;
        verdict.forEach((v, k) => { out[k] = v && v !== 'ok' && edited[k] ? (cells[k] ? 'fixed' : 'empty') : v; });
      }
      if (cur && cur.id === id) for (const k of cur.preset) out[k] = 'ok';
      return out;
    },

    // 差一点的格子（西语少打了重音符号、判对了）：fixes[k] = 正确拼法，没有的是 undefined。界面把这一格标黄、显示正确拼法
    getFixes(id = cur?.id) {
      return input.id === id && input.fixes ? input.fixes : [];
    },

    // 回车（或最后一格 / 最后一个错的格子按空格）一起判，蓝的（改过的）一并重判。返回 {solved, wrong, blanks, first, ignored}：
    //   wrong 不对的格数（含没打的）；blanks 没打的格数；first 第一个不对的格子（界面把光标放过去）；ignored 没有题或已经锁住。
    //   没全对只回结果、不扣分（界面说 dictCheckWrong）；全对：锁住、亮出原文、交给上报（只这一次）
    check() {
      if (!cur || cur.solved) return { solved: false, ignored: true };
      if (input.id !== cur.id) input = blank(cur.id);
      // 预填的格子一律按对的算；存进 input.verdict 的只有用户自己的格子（预填的在 getVerdict 里叠上去，重挑预填时不会留下过期的锁）。
      // wrong / blanks / 「动过没有」都只数用户自己的格子：预填的不是用户打的，不该让「还差几个」变少、也不该让「全空回车」变成动过
      // 西语少打重音符号的格子判 'ok'，另记正确拼法（fixes）；已经锁住的格子保留原来的记录
      const fixes = [];
      const verdict = cur.layout.slots.map((slot, k) => {
        if (isPreset(k)) return 'ok';
        if (input.verdict[k] === 'ok') { if (input.fixes?.[k]) fixes[k] = input.fixes[k]; return 'ok'; }
        const r = judgeCellFix(slot, input.cells[k], lang);
        if (r.fix) fixes[k] = r.fix;
        return r.verdict;
      });
      input = { ...input, verdict: verdict.map((v, k) => (isPreset(k) ? undefined : v)), edited: [], fixes };
      const wrong = verdict.filter((v) => v !== 'ok').length;
      if (wrong) {
        const blanks = verdict.filter((v) => v === 'empty').length;
        if (blanks < verdict.length - cur.preset.length && !cur.touched) { cur = { ...cur, touched: true }; emit(); }
        return { solved: false, wrong, blanks, first: verdict.findIndex((v) => v !== 'ok'), ignored: false };
      }
      cur = { ...cur, solved: true, touched: true };
      cancelEye();
      cur.eye = false;
      emit();
      if (onSolved) {
        // 整句计分：words / slots 是全部词位数；presetN 只记录这句预填了几个，不据此改分
        onSolved({
          id: cur.id, text: cur.shown, words: cur.layout.slots.length, slots: cur.layout.slots.length, presetN: cur.preset.length,
          peeked: isPeeked(marks.get(cur.id)), stats: statsFor(cur.id),
        });
      }
      return { solved: true, wrong: 0, blanks: 0, first: -1, ignored: false };
    },

    // 「眼睛」：原文亮 2 秒。闸门是答案框摆出来满 10 秒（core/hintGate.js）；hints + 1；视同看了答案（peeked，按常理定，design 第 12 节第 1 条）。真亮了返回 true
    peekEn() {
      if (hintStatus().state !== 'ready') return false;
      bump(cur.id, 'hints');
      marks.set(cur.id, { eye: true });
      cancelEye();
      cur = { ...cur, eye: true };
      eyeTimer = clock.setTimeout(() => {
        eyeTimer = null;
        if (cur) { cur = { ...cur, eye: false }; emit(); }
      }, EYE_SHOW_MS);
      emit();
      return true;
    },

    // 偷看译文：只 hints + 1，不算看了答案。同一个闸门；同一题再点不再记。真看上了返回 true
    peekZh() {
      if (!cur || zhPeekId === cur.id) return false;
      if (hintStatus().state !== 'ready') return false;
      bump(cur.id, 'hints');
      zhPeekId = cur.id;
      emit();
      return true;
    },

    // 「清空重写」：没锁住的格子全清空（回车判过是对的照旧锁着），它们的对错作废、回到没判过（又从打字阶段开始）。
    // 返回第一个没锁住的格子（界面把光标放过去）；没有题、已经锁住回 -1。不记提示、不碰闸门
    clearAll() {
      if (!cur || cur.solved) return -1;
      if (input.id !== cur.id) input = blank(cur.id);
      const keep = (k) => input.verdict[k] === 'ok';
      const n = cur.layout.slots.length;
      const cells = Array.from({ length: n }, (_, k) => (keep(k) ? input.cells[k] : ''));
      const verdict = Array.from({ length: n }, (_, k) => (keep(k) ? 'ok' : undefined));
      input = { id: cur.id, cells, verdict, edited: [], fixes: (input.fixes || []).map((f, k) => (keep(k) ? f : undefined)) };
      emit();
      // 预填的格子本来就锁着，不算「没锁住的第一个」
      return cur.layout.slots.findIndex((_, k) => !keep(k) && !isPreset(k));
    },

    // 学的语言（界面每次变化都告诉会话）。只管之后出的题和之后的判词；手上这一题的词位表不变
    setLang(next) {
      lang = typeof next === 'string' && next ? next : 'en';
    },

    // 难度档（primary / middle / high / college）。只管之后出的题预填几个、挑哪些；手上这一题的预填不变。不换快照
    setGrade(next) {
      grade = typeof next === 'string' ? next : undefined;
    },

    // 面板此刻是不是真的摆在眼前（展开、标签页在前台、不在画中画小窗里）。界面每次条件变了就调
    setVisible(v) {
      const next = Boolean(v);
      if (next === visible) return;
      visible = next;
      stampGate();
      emit();
    },

    // 循环播完一遍。默认记在当前题上；播放器知道是哪一句时传 id。只是统计，不管闸门
    countLoop(id = cur?.id) {
      bump(id, 'loops');
    },

    statsFor,
    // 这一句现在算不算看过答案（界面和测试用）
    peeked(id = cur?.id) {
      return id && cur && id === cur.id ? isPeeked(marks.get(id)) : false;
    },

    // 换片、换字幕轨：每句统计、答案框全作废，题目清掉。本机的「看过答案」记录不动（按日期和题目 id 存，换片自然对不上）
    resetAll() {
      stats.clear();
      statsKey = '';
      zhPeekId = '';
      input = blank('');
      cancelEye();
      cur = null;
      emit();
    },

    dispose() {
      cancelEye();
      if (tickTimer != null) { clock.clearTimeout(tickTimer); tickTimer = null; }
      listeners.clear();
    },
  };
}
