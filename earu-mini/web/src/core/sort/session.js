// 排序练习的「这一场」：当前这道题、每句的练习统计（hints / secs / loops）、提示的 10 秒冷却和 2 秒还原、偷看译文。
// 不依赖 React、不碰 DOM；时钟和定时器从外面注入，Node 里能用假时钟测。
// 界面用 useSyncExternalStore(session.subscribe, session.getSnapshot) 接上；播放器循环一遍调 countLoop，
// 排对时 onSolved 回调把这句交给上报。
//
import { createHintGate } from '../hintGate.js';
import { buildPuzzle, reshuffle as reshufflePuzzle, retext, clickToken, dropToken, startHint, endHint } from './puzzle.js';

export const HINT_SHOW_MS = 2000;    // 提示摆 2 秒，然后还原她的排法
export const STATS_MAX = 200;        // 每句统计最多留 200 句，满了丢最久没碰的
export const SECS_CAP = 999;         // 一句挂一下午不该把平均值拉爆，服务端也只留 3 位

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

// clock：{now(), setTimeout(fn, ms), clearTimeout(h)}，默认真时钟。
// random：打乱用的随机数（默认 Math.random；预摆不用它，预摆按句子文字定死）。
// onSolved({id, text, words, presetN, stats})：最后一个词放对、判对的那一刻调一次；stats = {hints, secs, loops}。
export function createSortSession({ clock = realClock, random = Math.random, onSolved } = {}) {
  let puzzle = null;
  let visible = false;
  let hintTimer = null;
  let tickTimer = null;
  let snapshot = null;
  const listeners = new Set();
  // 中文题最近一次 show 带的标注 {id, anno}：标注晚到时她已经动过题、题没换，「重新打乱」用它换成正式词块
  let lastZh = null;
  // 此刻的难度（primary / middle / high / college）：用来定英文等题预摆几个、哪几个。放在会话里不放进题目对象——en-golden 整题哈希，多一个字段全红。
  // 中途改了难度，已经出好的这一题不动（她正在排的东西不能在手底下变），下一句出题起按新难度
  let grade;
  // 这一题出题时用的难度（retext 按它重挑预摆，不按中途改过的 grade）；学的语言（setLang，只有英语看人名和生词，core/dictation/prefill.js）
  let builtGrade;
  let lang;
  // 偷看了译文的那一题的 id。
  // 换了一题（id 变了）就作废；空档里清掉题又回到同一句、「重新打乱」都还算这一句，照旧亮着
  let zhPeekId = '';

  // ---- 每句的练习统计 ----
  // 不放进题目里：「重新打乱」会整个重建题目，而统计要的恰恰是「这一句一共用了几次提示」，一打乱就清零等于白统计。
  // 按题目 id 各存一份：她用 ← 翻回上一句看一眼、再 → 翻回来排对，提示次数照样接着数。
  // Map 保留插入顺序，「碰过」就挪到队尾，满 200 条丢队头。
  const stats = new Map();   // id → {hints, loops, startedAt}
  let statsKey = '';         // 正在做的那一句：用来分清「重新打乱」（同 id）和「翻回来了」（id 变过）

  // 出题时调（startPuzzleStats）。三种情况：
  //   重新打乱（同一句、本来就是当前句）——什么都不动，次数照旧累加；
  //   翻回一句做过的——次数接着数，计时重新起头（secs 的口径是「这一轮从出题到排对」，别把在别的句子上花的时间算进来）；
  //   新句——建一条新记录。
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

  // 给某一句记一笔（bumpPuzzleStat）：记到事件自己带的那句上；没有记录（换片清过、被挤出去了）就不记，
  // 绝不凭空补一条——那会让根本没出过题的句子冒出统计来。
  function bump(id, field) {
    const rec = id ? stats.get(id) : null;
    if (rec) rec[field] += 1;
  }

  // 上报用的三个数（solvedStatsFor）。没有记录一律 0/0/0。secs 按墙钟算（她走开去喝水也算），封顶 999。
  function statsFor(id = puzzle?.id) {
    const rec = id ? stats.get(id) : null;
    if (!rec) return { hints: 0, secs: 0, loops: 0 };
    const secs = rec.startedAt ? Math.min(SECS_CAP, Math.max(0, Math.round((clock.now() - rec.startedAt) / 1000))) : 0;
    return { hints: rec.hints, secs, loops: rec.loops };
  }

  // ---- 提示冷却 ----
  // 从「词块真的在她眼前」那一刻起算——不是从出题、也不是从选中句子：正常看片时词块收着，从选中起算等于白送。
  // 「在眼前」由界面判断后告诉 setVisible：词块摆出来了（循环或暂停，留白那一下不算暂停）、面板真的在屏幕上
  // （标签页在前台、不是只剩画中画小窗、全屏时面板挂进了舞台）——不看面板闲置态会出问题：
  // 10 秒在黑着的词块上走完，她回来时提示已经能点。
  // 每句只打一次时间戳：同一句收起再展开不重新计时（不然她反复切换永远点不到），重新打乱也不重新计时；换句重新起算。
  // 起算之后就不再管看不看得见。
  // 读秒闸门和听写共用一处（core/hintGate.js，10 秒只在那里定义）
  const gate = createHintGate(clock);
  const stampGate = () => gate.stamp(visible, puzzle?.id);

  // 提示按钮的状态（renderHintButton）。只有 ready 能点，其余都灰：
  //   none     没有题
  //   solved   已排对
  //   showing  提示正在摆的那 2 秒
  //   hidden   词块还没摆在她眼前（暂停、或者开循环，词块摆出来之后才给看答案）——
  //            这时不写倒计时：一个不走字的「还有 10 秒」看着就是坏了
  //   waiting  词块出现后的 10 秒内，leftSec 是还剩几秒（向上取整），按钮写「提示 · 还有 N 秒」
  //   ready    可以点（「提示 2 秒」）
  function hintStatus() {
    if (!puzzle) return { state: 'none', leftSec: 0 };
    if (puzzle.solved) return { state: 'solved', leftSec: 0 };
    if (puzzle.hint) return { state: 'showing', leftSec: 0 };
    if (!visible) return { state: 'hidden', leftSec: 0 };
    return gate.status(puzzle.id);
  }

  // ---- 通知界面 ----
  // 快照只在状态变了时换新对象（useSyncExternalStore 要求同一状态拿到的是同一个对象）。
  // 倒计时要自己走拍子：她做题时视频多半是暂停的，没有 timeupdate 驱动重画，要自己起一个 250ms 的计时器。
  // 这里算好下一次秒数变化的时刻定一个定时器，到点重算、通知一次。
  function emit() {
    const hint = hintStatus();
    snapshot = { puzzle, visible, hint, zhPeek: !!puzzle && zhPeekId === puzzle.id };
    if (tickTimer != null) { clock.clearTimeout(tickTimer); tickTimer = null; }
    if (hint.state === 'waiting') {
      tickTimer = clock.setTimeout(() => { tickTimer = null; emit(); }, gate.nextTickMs(puzzle.id));
    }
    for (const fn of [...listeners]) fn();
  }

  function cancelHint() {
    if (hintTimer != null) { clock.clearTimeout(hintTimer); hintTimer = null; }
  }

  // 新出一道题（buildPuzzle 的收尾）：作废还在等的提示还原、起统计、看得见就打冷却的时间戳。
  function setNewPuzzle(next) {
    cancelHint();
    if (next && next.id !== zhPeekId) zhPeekId = '';
    puzzle = next;
    if (puzzle) {
      startStats(puzzle.id);
      stampGate();
    }
    emit();
  }

  // 一次摆放之后：判对了就交给上报（completePuzzle → recordSolvedSentence）。
  // 排对后不停循环，那是播放器的事，这里不管。
  function applyMove(next) {
    if (next === puzzle) return false;
    const wasSolved = puzzle.solved;
    puzzle = next;
    emit();
    if (!wasSolved && puzzle.solved && onSolved) {
      onSolved({
        id: puzzle.id,
        text: puzzle.text,
        words: puzzle.original.length,      // 整句词数，预摆了几个都不减
        presetN: puzzle.preset.length,
        stats: statsFor(puzzle.id),
      });
    }
    return true;
  }

  snapshot = { puzzle, visible, hint: hintStatus(), zhPeek: false };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,

    // 当前句是这一句（preparePuzzle）。id = puzzleId(字幕指纹, 句号)，text = 句子原文或恢复大小写后的文字，
    // orig = 这句的原文（rawLines[i].text）：说话人标签按原文判，空位数和服务端 wordCount(原文) 一样（s2）。
    // 同一个 id 时不传 orig 就沿用出题时的原文。
    // 同一个 id：保留她的排法，不重新打乱（循环时词块不能被打乱）；只是文字的大小写变了（恢复大小写晚到）就只换字。
    // 换了 id：出新题——排到一半的进度丢掉，翻回来是一道新题（打乱顺序可能不同，预摆的词和位置一样，01 §1.7）。
    // 这句剥完没词：没有题（puzzle = null）。
    // opts：中文题传 {zh: true, anno}，anno 是这一句的标注（translate.js 的 tr.anno[i]，没标到是 null）；英文题不传。
    // 中文题的词块变了（标注晚到，puzzleZh.js retextZh 回 null）：没动过的静默换成标注的词块；她动过、排对了的不换——
    // 排到一半的词块在手底下变了比用临时词块排完更糟；计分的块数本来就按标注算。
    // 看过提示的也不换（评审 B7-2）：提示那 2 秒里换题会把提示打断、次数却已经记上；看完了换，
    // 她刚记住的是旧词块的排法，新词块上用不上——和动过一样，正式词块等她点「重新打乱」。
    show(id, text, orig, opts) {
      if (opts?.zh) lastZh = { id, anno: opts.anno ?? null };
      if (puzzle && puzzle.id === id) {
        const next = retext(puzzle, text, orig, opts?.zh ? opts : { grade: builtGrade, lang, random });
        if (next === puzzle) return;
        if (next) { puzzle = next; emit(); return; }
        if (puzzle.zh && opts?.zh && (puzzle.touched || puzzle.solved || puzzle.hint || puzzle.hinted)) return;
      }
      builtGrade = grade;
      setNewPuzzle(buildPuzzle(opts?.zh ? { id, text, orig, random, zh: true, anno: opts.anno ?? null, lang: opts.lang, grade } : { id, text, orig, random, grade, lang }));
    },

    // 换难度：只记下来，下一句出题起生效（不重出当前题，不通知界面）。不认识的值当「没传」＝基础
    setGrade(next) {
      grade = typeof next === 'string' ? next : undefined;
    },
    // 学的语言（'en'、'es'……）：同 setGrade，下一句出题起生效。不传当英语
    setLang(next) {
      lang = typeof next === 'string' ? next : undefined;
    },

    // 此刻没有句子（播放头在空档里、面板清空）。统计和冷却的「当前句」不清：
    // 清完又回到同一句时算接着做（不重新计时）。什么时候该清由界面按 isInProgress 等条件判断。
    clear() {
      if (!puzzle) return;
      cancelHint();
      puzzle = null;
      emit();
    },

    // 「重新打乱」（reshufflePuzzle）：重建这一题，预摆不变；统计、冷却都不动（同一个 id）。
    // 中文题带上这句最新的标注（见上面 lastZh）
    reshuffle() {
      if (!puzzle) return;
      builtGrade = grade;
      // 中文、日语题也带难度档（JA-4）：中途改了难度再点「重新打乱」按新难度摆，同英文
      setNewPuzzle(reshufflePuzzle(puzzle, random, puzzle.zh ? { ...(lastZh?.id === puzzle.id ? lastZh : {}), grade } : { grade, lang }));
    },

    // 点一下词块；拖完松手（drop = puzzle.js 的 resolveDrop 结果）。动了返回 true。
    click(tokenId) {
      return puzzle ? applyMove(clickToken(puzzle, tokenId)) : false;
    },
    drop(tokenId, drop) {
      return puzzle ? applyMove(dropToken(puzzle, tokenId, drop)) : false;
    },

    // 「提示 2 秒」（showHint）。只有 hint.state === 'ready' 时生效，返回 true。
    // 真给出提示的这一次才记 hints（上面的早退都不记）。次数不限；和计分无关，看了提示照样计分。
    // 2 秒后还原她的排法（endHint）；这期间换句、重新打乱，定时器作废，新题不受影响。
    hint() {
      if (hintStatus().state !== 'ready') return false;
      bump(puzzle.id, 'hints');
      cancelHint();
      puzzle = startHint(puzzle);
      hintTimer = clock.setTimeout(() => {
        hintTimer = null;
        puzzle = endHint(puzzle);
        emit();
      }, HINT_SHOW_MS);
      emit();
      return true;
    },

    // 偷看译文：点开答题区 / 画面上打码的译文。和「提示 2 秒」同一个闸门——只有 hint.state === 'ready'
    // 时生效（词块真摆在她眼前 10 秒以后；提示那 2 秒里、排对了都不行），同一个计数（记一次 hints，跟着排对那一句上报，计分照旧不受影响）；
    // 词块不动（看的是意思，不是答案的排法）。亮到这一句结束（zhPeekId，见上面）；同一题再点不再记。真看上了返回 true
    peekZh() {
      if (!puzzle || zhPeekId === puzzle.id) return false;
      if (hintStatus().state !== 'ready') return false;
      bump(puzzle.id, 'hints');
      zhPeekId = puzzle.id;
      emit();
      return true;
    },

    // 词块此刻是不是真的摆在她眼前（见上面「提示冷却」）。界面每次条件变了就调。
    setVisible(v) {
      const next = Boolean(v);
      if (next === visible) return;
      visible = next;
      stampGate();
      emit();
    },

    // 循环播完一遍。默认记在当前题上；播放器知道是哪一句时传 id（换句那一瞬的残留事件属于上一句）。
    countLoop(id = puzzle?.id) {
      bump(id, 'loops');
    },

    statsFor,

    // 换片、换字幕轨（clearPuzzleStats）：每句统计全作废，题目清掉。
    resetAll() {
      stats.clear();
      statsKey = '';
      lastZh = null;
      zhPeekId = '';
      cancelHint();
      puzzle = null;
      emit();
    },

    dispose() {
      cancelHint();
      if (tickTimer != null) { clock.clearTimeout(tickTimer); tickTimer = null; }
      listeners.clear();
    },
  };
}
