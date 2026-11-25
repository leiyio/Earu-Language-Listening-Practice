// 按句控制播放：点句跳转、上一句/下一句、单句循环、循环模式、变速。只依赖 HTMLVideoElement，不依赖 React。
// 循环与留白规则：
//
// - 当前句按【编号】认。不循环时跟着播放头走，但导航光标只在播放头真的
//   落在某句里时才更新，空档里记着刚才那句；←/→、点列表跳过去以后，播放头还在前缓冲里（按时间算还在上一句）
//   的那一小会儿，当前句钉在跳过去的那句。
//   循环时钉死在被循环的那句，画面只在它自己的时间窗里（±0.05 秒）显示它——句首句尾多播的那一截不会闪出
//   邻句的字幕（留白字幕消失以后再播放一段时间，字幕该消失就消失）；
//   唯一例外是暂停：暂停时照常显示这句（停在这句上看译文）。
// - 循环：句首前多播 leadIn、句尾后多播 tail（终点不超过片长），到点后【把速度设成 0 原地冻结】
//   留白 gap 秒再跳回句首——不用真暂停：真暂停会闪控制条、留白时按空格停不下来、
//   播放器会当成用户暂停去存进度截图。留白期间任何地方写速度都不许解冻。
//   片子已经播到头（终点被片长截住、后台标签页没赶上判）也照样留白、跳回接着循环。
//   所以对外要分清两件事（00 §1.3 改动 9）：state.waiting = 留白冻结（不是她按的），state.paused = 她暂停了 / 片子停着。
// - 循环三个数 setOpts({lead, tail, gap})，默认 0.2 / 0.2 / 1 秒，改了立即生效。
//   边转边播的片（换了盒子的 MKV）跳一下要等一会儿（iPhone 实测 0.5 秒）：setOpts({earlyBack: true}) 时冻住的同时就跳回句首，
//   等的那一会儿藏进留白里，留白完了直接接着放（留白里画面停在句首那一帧）。直接放的片不开，照旧留白完了再跳。
//   前后缓冲各自最多用到与邻句间隙的一半（精听、排序都一样；以前只有排序模式夹、夹在整个间隙以内），见 loopStart / loopEnd。
// - 暂停不退出循环，只停跳转：留白定时器一并清掉。
// - 判句尾：播放中用 requestAnimationFrame 轮询；另按剩余时长挂一个定时器，
//   标签页在后台 rAF 停了也能按时跳回。判的是停点 stopAt：循环终点往前提一点（一帧的余量），但最多提前到句尾；
//   定时器挂到停点前 30 毫秒，最后一截用 MessageChannel 紧盯（spinTo）——两句挨着、后缓冲夹成 0 时，前台不吃掉本句的尾巴，
//   后台（画中画小窗、主页面藏着）也不放进下一句的开头。留白完了先跳回句首、再恢复速度。
// - 循环开关：关 → 接着往下播；开 → 当前有句子（且过得了 filter）就从句首开始循环，
//   没有（两句之间的空档、字幕还没读完、这句被 filter 挡掉）就先进入循环模式、播到下一句时自动咬住
//   换字幕时循环模式保留。
// - 能不能循环（setOpts loopGate ④）：分句没定（边读边出）、这句译文没到时不能循环。
//   所有入口（按钮、R、列表、面板、armLoop、自动咬住）都只问 canLoop：
//   眼下这句不能循环时按钮灰着（state.loopLocked）、按了不理；开着的循环被它挡住就悄悄关掉（不跳、不开播），
//   等能循环了自己再开（armWanted，同 armLoop 只亮按钮）。全片译完、不用翻时 loopGate 是 null，全都能循环。
// - 循环模式：开着时播进哪句就咬住哪句（只咬 filter 收的句子；
//   第 2 步按难度过滤用，默认全收）。「继续播放 ›」= release()：放行本句、播进下一句再咬。
// - 点绿框重播 = playOnce(i)：从句首前缓冲放到循环终点就停（oneShotEnd），不退出循环模式。
// - 排序面板上摆着哪道题由 App 用 setFocus(i) 传进来：
//   空档里「继续播放」放行哪句、按 R 循环哪句、暂停时画面给哪句，都按同一套规则认。
// - 上一句/下一句：编号 ±1，从没选中过句子时才按播放头时间找邻居。首尾不环绕：
//   第一句按 ← / 最后一句按 → 什么都不做（不环绕；边读边出时每一段的首尾也一样，不跨过中间没读到的那一截）。
// - 三种播放方式（互斥，互斥只在这里管；界面只调 setPlayMode / toggleStopMode，从练习回到观影调 restorePlayMode）：连续播放（默认）、每句停、单句循环。
//   每句停（stopMode）：播到这一句自己的停点 stopAt(k) 就真暂停（自动字幕轨也一样），钉住这句（hold，画面、列表不跳），
//   再按播放接着往下放、不往回跳，这一句不会再触发（stopDone）。不等译文（不看 loopGate）；重播一次（playOnce）优先，放完照旧钉住。
//   待停的是哪句（stopArm）：播着时没有就挑——刚跳过去的钉子（navPin）优先，其次播放头所在的句，空档里取下一句；已经过了停点、已经停过的跳到下一句。
//   一旦挑中就不再按播放头重挑（停点常落在 indexAt 的容差之外，重挑会丢掉它），只有播放头回到它的句首之前、或者远远越过它的停点才重挑。
//   程序自己的跳转（上一句 / 下一句 / 重听 playLine）直接把目标句设成待停的句子，不看播放头，所以两句挨着（空档 0）时按「下一句」不会在上一句句尾立刻停；
//   拖进度条不触发它，拖完在落点所在的句子上重新挑（停过的记号也清掉，往回拖能再停一次）。关掉每句停只把它自己造成的暂停放开（autoPaused）。
//   定时器、MessageChannel 紧盯、tick 三条路判的是同一个目标（segTarget），后台标签页也按点停。
// - 拖进度条：拖出本句范围（循环段前后各放宽 0.5 秒；落进别的句子也算拖出）就退出循环；等待咬住时还没有「本句」，
//   一拖就退出。拖完一律开始播放，落在片尾的除外。
//   程序自己恢复进度（续播、画中画）用 internalSeek()，不算拖。
// - 打开跟读、单词这些页面之前 exitLoopAndPause()：退出循环模式再暂停。
//
// 对外的 state（subscribe 收到的对象，值变了才换新对象）：
//   index      当前句编号（循环 / 重播 / 停下来钉住时是那句，否则见 cursorAt；-1 = 还没有）
//   active     画面上该显示哪句（-1 = 不显示）
//   loopIndex  正在循环的句子（-1 = 没在循环；循环模式开着、等着咬住时也是 -1）
//   loopMode   循环模式开着（按钮亮）
//   playMode   现在的播放方式：'continuous' | 'stop'（每句停）| 'loop'（= loopMode）。三选一，界面的图标和菜单只看它
//   loopLocked 循环按钮灰着：循环没开、眼下这句还不能循环（loopGate）
//   waiting    正在循环终点留白（速度 0 冻结，不是她按的暂停）
//   paused     视频停着、而且不是留白（她按了暂停、重播放完停住了、片子播完了）
//   once       正在「重播一次」的句子（-1 = 没有）
//   loops      走完的循环遍数（从建播放器起累计，每到一次循环终点 +1； loops）

import { pickStep } from './stepPick.js';

// 前缓冲 / 后缓冲 / 留白的默认值
const DEFAULTS = { leadIn: 0.2, tail: 0.2, gap: 1 };
const LIMITS = { leadIn: 3, tail: 5, gap: 5 };          // 设置的上限
const EDGE = 0.05;                                      // 画面认句子的容差
// 判到停点的提前量：rAF 一帧约 16 毫秒，比循环终点提前 25 毫秒判，冻住时不会已经多放了一帧。最多提前到后缓冲实际用上的那截（stopAt）：
// 后缓冲夹成 0（两句挨着）时一点不提前，不然本句最后 14–25 毫秒的声音被吃掉
const END_EARLY = 0.025;
// 判句尾的最后一截不靠定时器（scheduleSegment / spinTo）：Windows 上的 Chrome 定时器到点晚 0–16 毫秒说不准
// 后台时只靠它判，晚的那截就是放进下一句的那截。
// 离停点还远时定时器挂到停点前 SEG_NEAR_MS 毫秒（晚 16 毫秒到也还有十几毫秒），到了以后用 MessageChannel 一条接一条地看播放头
// （消息之间不到 1 毫秒，前台后台都不限速），到停点马上判。紧盯这一截每遍循环十几到三十毫秒
const SEG_NEAR_MS = 30;
// 紧盯了这么久（毫秒，从该到停点的时刻算）还没到停点：播放头卡住了（等数据），放手回到定时器
const SPIN_GRACE_MS = 50;
// 「继续播放」：播放头越过句尾这么多才退回，退到句尾后这么多
const RELEASE_OVER = 0.05;
const RELEASE_BACK = 0.01;
// 每句停：待停的句子的停点已经被越过这么多秒（外部程序跳转、后台标签页被拖到很晚才醒）就当它作废、按播放头重挑，不在不相干的地方突然停
const STOP_STALE = 3;

// 最后一个 start <= t 的句子下标（没有返回 -1）
function lastStartedAt(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// line 在 lines 里是哪一句（swapLines 用）：句首差不到 1 毫秒、文字一样的那句；没有就取时间上盖住 line 中点的那句；都没有 -1
function sameLineIn(lines, line) {
  if (!line) return -1;
  for (let j = lastStartedAt(lines, line.start + 0.001); j >= 0 && lines[j].start > line.start - 0.001; j--) {
    if (lines[j].text === line.text) return j;
  }
  const mid = (line.start + line.end) / 2;
  const j = lastStartedAt(lines, mid);
  return j >= 0 && lines[j].end >= mid ? j : -1;
}

// 程序自己发起、还没落地的 seek 个数，按 video 记。
// 为什么不记在 SentencePlayer 身上：续播（App）、画中画搬家后恢复进度（Player）这些不归播放器管的地方也要登记；
// 换片时 video 元素复用、播放器重建，计数跟着 video 走才不会错位。
// 浏览器每设一次 currentTime 就发一次 seeking（连着设两次就是两次），所以按个数记，seeking 来了消掉一个。
const quietSeeks = new WeakMap();

// 程序自己设播放位置：SentencePlayer 不把它当成用户拖进度条——不退出循环、不「拖完开播」。
// App 续播、Player 画中画恢复进度都要用它，不要直接写 video.currentTime（直接写 = 当成她拖的，会自己开播）。
// 要在有了元数据之后调（readyState ≥ 1）：HAVE_NOTHING 时浏览器只记下起播位置、当下不发 seeking，
// 所以这时不记数（记了没人消，会吞掉她下一次拖动）；元数据到了以后浏览器补的那次跳转会被当成用户拖动。
// 不是有限数（NaN、Infinity）就什么都不做：浏览器对这种值直接抛 TypeError、不跳也不发 seeking，
// 先记了数再抛，这一笔就永远悬着，会吞掉她下一次拖进度条。
export function internalSeek(video, t) {
  if (!video || !Number.isFinite(t)) return;
  if (video.readyState !== 0) quietSeeks.set(video, (quietSeeks.get(video) || 0) + 1);
  video.currentTime = t;
}

// seeking 来了：是程序登记过的就消掉一笔、返回 true
function takeQuietSeek(video) {
  const n = quietSeeks.get(video) || 0;
  if (n > 0) quietSeeks.set(video, n - 1);
  return n > 0;
}

// 每个 video 上现在的播放器（换片重建就换成新的）：外部的「放完就停」逻辑要问它是不是正循环着一句
const players = new WeakMap();

// 这个 video 正在单句循环（含循环的留白）：片尾归循环管，「放完就停」不插手，最后一句照常循环
export function loopsHere(video) {
  const p = players.get(video);
  return !!p && (p.loopIndex >= 0 || p.gapActive);
}

// 程序自己把片子换个位置、像「重新开始看」（续播跳到上次看到的地方、放完停住后按播放从头重播）：
// 不算她拖进度条（以前直接写 currentTime，被当成拖动，循环模式给关了），循环模式留着；本句循环、留白、停点、每句停作废，
// 落点那句由 tick 重新咬住（latch：落在句子深处跳回句首）。这个 video 上没有播放器就只是 internalSeek
export function relocate(video, t) {
  if (!video || !Number.isFinite(t)) return;
  const p = players.get(video);
  if (p && !p.destroyed) p.relocate(t);
  else internalSeek(video, t);
}

export class SentencePlayer {
  // opts 同 setOpts
  constructor(video, opts = {}) {
    this.video = video;
    this.lines = [];
    this.loopMode = false;     // 循环模式：开着时播到哪句就循环哪句
    this.loopIndex = -1;       // 正在循环的句子
    this.once = -1;            // 正在「重播一次」的句子，放到循环终点就停
    // 停下来以后钉住的那句：重播一次放完停住、exitLoopAndPause 以后，
    // 播放头停在句尾 + 后缓冲，按时间常常已经落进下一句——这时当前句还得是刚才那句，不然面板上排对的绿框
    // 被下一题顶掉。她再按播放、拖进度条、换句时松开
    this.hold = -1;
    // 「继续播放」放行的那句：循环模式里不再咬住它，播放头进了别的句子就清掉。
    // 句子编号不随时间轴变（字幕自动校准只换起止时间、不动编号），直接按编号记
    this.skipLatch = -1;
    // 循环模式里重播一次一路放到片尾、浏览器自己停了：再按播放时浏览器先把播完的片子拉回 0，
    // 这一下不是她拖的，接着循环这句（同复核 P-7 的片尾留白）
    this.endedHold = false;
    this.frozen = null;        // 锁住起止的那句 { line, a, b }（字幕边读边长时，见 swapLines）
    this.filter = null;        // 自动咬住只咬 filter(i, line) 为真的句子；null = 全收（第 2 步按难度过滤用）
    this.loopGate = null;      // 这句能不能循环：loopGate(i, line) 为真才能；null = 都能（见文件头、setOpts）
    this.armWanted = false;    // 想开循环、眼下这句还不能循环（armLoop 时、被 loopGate 关掉时）：能循环了自己开
    this.loops = 0;            // 走完的循环遍数（每到一次循环终点 +1）
    this.timing = { ...DEFAULTS };
    this.speed = video.playbackRate || 1;
    this.lastNav = -1;         // 导航光标：播放头最近落在的那句，空档里不变，←/→ 按它 ±1
    this.navPin = -1;          // 刚跳过去、播放头还在它前缓冲里的那句，到了句首就松开
    this.focus = -1;           // 排序面板上摆着的那道题，见 setFocus；-1 = 面板空着 / 精听模式
    this.gapActive = false;    // 正在循环终点留白
    this.gapEnded = false;     // 这次留白是片子已经播到头、浏览器自己停了
    this.earlyBack = false;    // 留白一开始就跳回句首（setOpts earlyBack，边转边播的片）
    this.gapEarly = false;     // 这次留白已经提前跳回句首了
    // 每句停。开关只由 setPlayMode / toggleStopMode / enterLoopMode / dropStop 动，和 loopMode 互斥
    this.stopMode = false;     // 每句停开着
    this.stopArm = -1;         // 待停的句子：播到它的停点（stopAt）就暂停；-1 = 还没挑 / 刚停过
    this.stopDone = -1;        // 刚停过的那句：再按播放时不再触发它（停点不动，播放头就在停点上）
    this.autoPaused = false;   // 眼下的暂停是每句停造成的：关掉每句停时只放开这一种暂停，她自己按的暂停不碰
    this.state = { index: -1, active: -1, loopIndex: -1, waiting: false, loopMode: false, playMode: 'continuous',
      paused: !!video.paused, once: -1, loops: 0, loopLocked: false };
    this.listeners = new Set();
    this.raf = 0;
    this.gapTimer = 0;
    this.segAt = -1;           // 上次挂判句尾定时器时的播放头（scheduleSegment：到点了播放头没动 = 卡住了，不紧着空转）
    this.segTimer = 0;
    this.userSeeked = false;
    // 新播放器 = 换了片：旧片里没落地的程序跳转作废（换源时浏览器本来就会丢掉排着队的 seeking 事件）
    quietSeeks.delete(video);
    players.set(video, this);

    this.tick = this.tick.bind(this);
    this.handlers = [
      ['play', () => this.onPlay()],
      ['pause', () => this.onPause()],
      ['ended', () => this.onEnded()],
      ['timeupdate', () => this.tick()],
      ['seeking', () => this.onSeeking()],
      ['seeked', () => this.onSeeked()],
      // 重新加载（换源、画中画跨窗口搬 video 被重载）：浏览器丢掉了排着队的 seeking/seeked。计数清零，免得吞掉她下一次拖动；
      // 「她刚拖过、等 seeked 开播」也作废——那个 seeked 不会来了，留着的话画中画恢复进度那次 seeked 会把暂停的片子放起来
      ['emptied', () => { quietSeeks.delete(video); this.userSeeked = false; this.clearStopArm(); }],
      ['ratechange', () => this.scheduleSegment()],
      ['durationchange', () => this.scheduleSegment()],
    ];
    for (const [ev, fn] of this.handlers) video.addEventListener(ev, fn);
    // 紧盯停点用的通道（spinTo）。没有 MessageChannel 的环境只靠定时器
    this.spin = 0;             // 正在紧盯的那一轮的编号（0 = 没在盯）；重新挂、停下都换掉，晚到的消息对不上编号就不理
    this.spinSeq = 0;
    this.chan = typeof MessageChannel === 'function' ? new MessageChannel() : null;
    if (this.chan) {
      this.chan.port1.onmessage = (e) => this.spinStep(e.data);
      this.chan.port1.unref?.();   // Node（测试）里不让它拖住进程
    }
    if (!video.paused) this.startRaf();
    this.setOpts(opts);
  }

  // 换片时 video 元素是复用的、播放器会新建一个：旧的必须彻底停手，
  // 否则它的 rAF 轮询还在同一个 video 上跑，两个播放器抢着跳
  destroy() {
    this.destroyed = true;
    if (players.get(this.video) === this) players.delete(this.video);
    this.stopSegment();
    this.chan?.port1.close();
    this.chan?.port2.close();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const [ev, fn] of this.handlers) this.video.removeEventListener(ev, fn);
    this.listeners.clear();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  // 换字幕（读完、换轨）：停掉本句循环、清导航光标，但【循环模式保留】（复核 P-9； 只 stopSegment，
  // 不动 loopModePreferred）——字幕还没读完时按了 R，读完后照常咬住播放头所在的句子，按钮不会亮了又自己灭。
  // 不接管播放（A16）：不跳转、不开播；只有正在播、循环模式本来就开着（她自己按的 R）时才会咬住。
  setLines(lines) {
    this.lines = lines || [];
    this.stopSegment();
    this.clearStopArm();       // 每句停开着就留着，只是待停的句子编号作废，tick 按新字幕重挑
    this.lastNav = -1;
    this.navPin = -1;
    this.tick(true);
  }

  // 只换时间（字幕自动校准）：同一份字幕、同样的句子，只是起止按声音校准过（或者她点图标切回原版）。
  // 和 setLines 不一样：循环的那句、重播、钉住、放行、导航光标、循环模式全都留着——句子编号没变，只是这句从哪儿起、到哪儿停变了；
  // 正在走的停点按新时间重挂（下一帧就按新的句尾判），留白里跳回句首用新的句首。什么时候换由 App 定（core/calib/index.js canSwitch：
  // 暂停时、或者这一句放完进下一句时），这里只管换。句子对不上（条数、文字不一样）照 setLines 整份换
  retime(lines) {
    const next = lines || [];
    if (next.length !== this.lines.length || next.some((l, i) => l?.text !== this.lines[i]?.text)) { this.setLines(next); return; }
    this.lines = next;
    this.frozen = null;
    if (!this.gapActive) this.scheduleSegment();
    this.tick(true);
  }

  // 字幕边读边长（远程片边读边出，desktop/useLocalAdapter.js）：同一条轨又多读进来一些——前面可能插进句子、编号跟着变，
  // 边界上的句子可能和新读到的拼成一句。和 setLines 不一样：循环、重播、钉住、放行、导航光标都按【句子本身】接到新列表上
  // （同样的句首和文字；找不到就找时间上盖住原来那句中点的新句子，见 sameLineIn），正在循环 / 重播的那句起止锁成换之前的样子（frozen），
  // 不跟着新插进来的邻句重新夹。
  // 正在循环 / 重播的那句在新列表里找不到，照 setLines 整份换；别的编号找不到就作废
  swapLines(lines) {
    const prev = this.lines, next = lines || [];
    const k = this.loopIndex >= 0 ? this.loopIndex : this.once;
    const kj = k >= 0 ? sameLineIn(next, prev[k]) : -1;
    if (k >= 0 && kj < 0) { this.setLines(next); return; }
    let frozen = null;
    if (k >= 0) {
      const f = this.frozen && this.frozen.line === prev[k] ? this.frozen : { a: this.loopStart(k), b: this.loopEnd(k) };
      frozen = { line: next[kj], a: f.a, b: f.b };
    }
    for (const key of ['loopIndex', 'once', 'hold', 'skipLatch', 'lastNav', 'navPin', 'stopArm', 'stopDone']) {
      if (this[key] >= 0) this[key] = this[key] === k ? kj : sameLineIn(next, prev[this[key]]);
    }
    this.lines = next;
    this.frozen = frozen;
    if (!this.gapActive) this.scheduleSegment();
    this.tick(true);
  }

  // 设置（只改传了的键，undefined 不动）：
  //   lead / tail / gap：循环前缓冲、后缓冲、留白（秒）；负数、非数字不收，超上限夹回
  //   filter：(i, line) => boolean，自动咬住和「循环」按钮只认它收的句子；null = 全收
  //   earlyBack：到循环终点冻住的同时就跳回句首（边转边播的片，见文件头）；下一次留白时生效
  //   loopGate：(i, line) => boolean，这句能不能循环；null = 都能。换了马上对一遍（gateCheck）
  // 改了立即生效：后缓冲下一帧就按新终点判；前缓冲下一次跳回句首时用；留白下一次留白时用
  // （正在走的这次留白不改，到点才读设置）。
  setOpts(o = {}) {
    for (const [k, key] of [['lead', 'leadIn'], ['tail', 'tail'], ['gap', 'gap']]) {
      if (o[k] === undefined || o[k] === null) continue;
      const v = Number(o[k]);
      if (Number.isFinite(v) && v >= 0 && this.timing[key] !== Math.min(v, LIMITS[key])) {
        this.timing[key] = Math.min(v, LIMITS[key]);
        if (key !== 'gap') this.frozen = null; // 前后缓冲改了：锁住的那句也按新的来
      }
    }
    if (o.filter !== undefined) this.filter = typeof o.filter === 'function' ? o.filter : null;
    if (o.earlyBack !== undefined) this.earlyBack = !!o.earlyBack;
    if (o.loopGate !== undefined) {
      this.loopGate = typeof o.loopGate === 'function' ? o.loopGate : null;
      this.gateCheck();
    }
    this.scheduleSegment();
  }

  // 变速：留白冻结期间只记下来，留白结束时用新速度恢复
  setRate(r) {
    this.speed = r;
    this.video.preservesPitch = true;
    if (!this.gapActive) this.video.playbackRate = r;
    this.scheduleSegment();
  }

  // 排序面板上摆着哪道题（句号；-1 = 面板空着「此刻无字幕」，精听模式也传 -1）：
  // 播进空档时面板清不清由界面定（她在排、排对且暂停时留着），
  // 播放器按播放头推不出来，所以由 App 传进来。只在空档里（播放头不在任何句子里、又没有钉住的句子）用到：
  //   「继续播放」放行哪句（passIndex）、按 R 循环哪句（toggleLoop）、暂停时画面给哪句（tick）。
  // 改了马上按新值刷一次状态（暂停在空档里时画面、答题区那行中文跟着变）。
  setFocus(i) {
    const k = Number.isInteger(i) && i >= 0 ? i : -1;
    if (k === this.focus) return;
    this.focus = k;
    this.tick();
  }

  // 当前句编号：循环、重播、钉住时就是那句，否则见 cursorAt
  current() {
    const p = this.pinned();
    return p >= 0 ? p : this.cursorAt(this.video.currentTime);
  }

  // 跳到第 i 句开头播放；循环模式下就循环这一句
  playLine(i) {
    const line = this.lines[i];
    if (!line) return;
    this.stopSegment();
    this.lastNav = i;
    // 落点是句首前缓冲处，按时间还在上一句（或空档）里：到句首之前当前句钉在 i，
    // 不然这一小会儿里再按 → 还是这句、按 ← 跳过一句、S 重听上一句
    this.navPin = i;
    // 这句还不能循环（loopGate）：照常跳过去放，循环模式等着咬住后面能循环的句子
    if (this.loopMode) this.loopIndex = this.canLoop(i) ? i : -1;
    // 每句停：程序自己跳过去，目标句直接就是待停的句子，不看播放头（两句挨着时播放头按时间还在上一句里，重挑会在上一句句尾立刻停）；
    // 这句之前停过也再停一次（重听、往回跳）
    if (this.stopMode) { this.stopArm = i; this.stopDone = -1; this.autoPaused = false; }
    this.seekTo(this.loopStart(i));
    this.play();
    this.tick(true);
  }

  // 点绿框重播一次：从句首前缓冲放到循环终点（句尾 + 后缓冲）就停。
  // 循环模式不动：开着的话放完停住就是「循环（暂停）」，再按播放接着循环这句（
  // startLoopFromCurrentPosition）；不开的话停住后钉在这句，再按播放接着往下放。
  // 「继续播放」放行过的这句（放行后绿框还在时点它）：放行标记留着（stopSegment 不碰
  // skipLoopLatchKey），放完钉住、再按播放接着往下放，不重新循环它（见 finishOnce）。
  playOnce(i) {
    if (!this.lines[i]) return;
    const keep = this.skipLatch === i ? i : -1;
    this.stopSegment();
    this.skipLatch = keep;
    this.lastNav = i;
    this.navPin = -1;          // 重播自己钉着这句，不用 navPin
    this.stopArm = -1;         // 每句停：重播一次优先（segTarget），放完钉住这句；待停的句子等再播放时重挑
    this.autoPaused = false;
    this.once = i;
    this.seekTo(this.loopStart(i));
    this.play();
    this.scheduleSegment();
    this.tick(true);
  }

  // 「继续播放 ›」：循环模式里解除本句循环、放行本句，循环模式保留，
  // 播进下一句（过得了 filter 的）自动咬住。播放头已经越过本句句尾 0.05 秒以上（留白冻结在句尾 + 后缓冲处，
  // 后缓冲大时可能已经越过下一句）就先退回句尾 + 0.01 秒再放，保证紧挨着的下一句整个咬住窗口都被走一遍，
  // 0.3 秒的短句不会被后台约 4 次/秒的 timeupdate 漏掉。
  // 不在循环模式里就只是接着播。
  // 【改】重播一次（playOnce）还没放完、或放完钉住时点它：一律作废那个停点、接着往下播。非循环模式下
  // 若只恢复播放、不动 oneShotEnd，片子还会停在句尾——那是实现上的顺带，不是有意的；
  // 「继续播放」四个字说的就是接着放。
  release() {
    const v = this.video;
    const i = this.passIndex();
    const looping = this.loopMode;
    // 留白里已经提前跳回句首了（earlyBack）：按「还停在句尾」算，退回句尾接着放，不把这句再放一遍
    const early = this.gapActive && this.gapEarly;
    this.stopSegment();        // 解除本句循环、留白、重播停点；循环模式本身不动
    if (looping) {
      this.skipLatch = i;
      const line = this.lines[i];
      const t = v.currentTime;
      if (line && (early || t > line.end + RELEASE_OVER)) this.seekTo(line.end + RELEASE_BACK);
      // 循环刚跳回句首、播放头还在本句的前缓冲里（离上一句近时按时间还落在上一句的容差里）：当前句钉在本句
      // （navPin，同复核 P-2），到了句首自己松开。不钉的话下一帧按播放头认出上一句、咬住它跳回去循环，
      // 面板也先清掉、再给本句出一道新题，排对的绿框丢了。
      // 【改】 用 findIndex 取第一个命中的句子，同样会选中上一句，这里不照抄
      else if (line && t >= this.loopStart(i) - EDGE && t < line.start - EDGE) this.navPin = i;
    }
    if (i >= 0) this.lastNav = i;
    this.play();
    this.tick(true);
  }

  // 重听本句（S 键）：从句首再来，循环状态不变
  replay() {
    const i = this.current();
    this.playLine(i >= 0 ? i : 0);
  }

  prev() { return this.step(-1, { wrap: false }); }
  next() { return this.step(1, { wrap: false }); }

  // 上一句 / 下一句：按编号 ±dir，不看 filter。
  // 按钮、键盘、浮动控制区都走 prev() / next()，它们传 wrap:false：首尾不环绕，到头不动、返回 false。
  // 这里 wrap 的默认值仍是 true（首尾环绕），只留给直接调 step(dir) 的老调用（没有字幕时退回 ±10 秒也走这里）。
  // accept(i)（练习用，stepSort）：只停在 accept 说行的句子上，沿 dir 方向往后找（stepPick.js 的 pickStep），
  // 找不到就不动、返回 false；传了 accept 就不环绕（wrap 不起作用）。
  step(dir, { wrap = true, accept } = {}) {
    const n = this.lines.length;
    if (!n) {
      // 没有字幕的片：退回 ±10 秒
      this.seekBy(dir * 10);
      return true;
    }
    let base = this.pinned(), byCursor = false;
    if (base < 0) {
      this.cursorAt(this.video.currentTime); // 先按眼下的播放头把光标对齐（这一帧 tick 可能还没跑）
      base = this.navPin >= 0 ? this.navPin : this.lastNav;
      byCursor = this.navPin < 0;
    }
    const mod = (k) => ((k % n) + n) % n;
    const t = this.video.currentTime;
    let target, lo = 0, hi = n - 1;
    if (base >= 0) {
      // 边读边出时列表里有几段（段头那句带 gapBefore，media.js partialLines）：首尾按这句所在那段算，不跨过中间没读到的那一截
      lo = base;
      while (lo > 0 && !this.lines[lo].gapBefore) lo--;
      hi = base;
      while (hi < n - 1 && !this.lines[hi + 1].gapBefore) hi++;
      // 播放头已经走出光标那句所在的段、停在段与段之间没读到的那一截里（光标是上一段留下的）：
      // 按播放头时间找邻居，→ 去后一段第一句，不绕回上一段段首。只有一段时两个条件都不成立，和以前一样
      if (byCursor && ((hi < n - 1 && t > this.lines[hi].end + EDGE) || (lo > 0 && t < this.lines[lo].start - EDGE))) {
        base = -1; lo = 0; hi = n - 1;
      }
    }
    if (base >= 0) target = base + dir;
    else {
      // 从没选中过句子（或刚走出上一段）：按播放头时间找邻居（不带容差）
      const after = this.lines.findIndex((l) => l.start > t);
      if (dir > 0) target = after < 0 ? n : after;
      else {
        // 「最近开始的那句」按环绕取，播放头在它里面（end >= t）就再退一格
        const last = after < 0 ? n - 1 : after - 1;
        target = this.lines[mod(last)].end >= t ? last - 1 : last;
      }
    }
    if (accept) {
      target = pickStep(target, dir, lo, hi, accept);
      if (target < 0) return false;
    } else if (target < lo || target > hi) {
      if (!wrap) return false;
      const len = hi - lo + 1;
      target = lo + (((target - lo) % len) + len) % len;
    }
    this.playLine(target);
    return true;
  }

  // 前后跳几秒（Shift + ←/→）：和拖进度条一样算用户跳转
  seekBy(sec) {
    const v = this.video;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(Math.max(0, v.currentTime + sec), d);
  }

  // 循环按钮 / R 键
  toggleLoop() {
    if (this.loopMode) { this.setLoop(-1); return; }
    const t = this.video.currentTime;
    this.cursorAt(t);
    if (!this.canLoop(this.loopPick(t))) return;   // 眼下这句还不能循环（loopGate）：按钮灰着，R 键也不理
    // 重播一次的那句、停住钉着的那句优先；
    // 刚按 ←/→、点了列表，播放头还在前缓冲里：循环跳过去的那句，不是按时间算的上一句；
    // 空档里面板还摆着她正在排的那句：循环这句，
    // 不然等着咬住下一句、面板换题，排到一半的词全丢
    const p = this.pinned();
    const k = this.indexAt(t, true);
    const i = p >= 0 ? p : this.navPin >= 0 ? this.navPin : k >= 0 ? k : this.focused();
    if (i >= 0 && this.accepts(i)) { this.setLoop(i); return; }
    // 两句之间的空档（面板也空着）、这句被 filter 挡掉：先进入循环模式，播到下一句（过得了 filter 的）时自动咬住
    this.stopSegment();
    this.armWanted = false;
    this.enterLoopMode();
    this.play();
    this.emit();
  }

  // ---- 三种播放方式 ----
  // 换成 m：'continuous' | 'stop' | 'loop'。互斥在这里管，界面（菜单、Q、R）只调它。
  //   'loop'：同 toggleLoop 的「开」——眼下这句不能循环（loopGate）就不理，每句停保持原样；开成了每句停就关掉
  //   'stop'：循环开着先关（同 R：接着往下播），再开每句停；已经开着不动
  //   'continuous'：循环开着就关（接着往下播），每句停开着就关（只放开它自己造成的暂停）
  setPlayMode(m) {
    if (this.destroyed) return;
    if (m === 'loop') { if (!this.loopMode) this.toggleLoop(); return; }
    this.armWanted = false;    // 她选了别的方式，「能循环了自己开」作废
    if (m === 'stop') {
      if (this.stopMode) return;
      if (this.loopMode) this.setLoop(-1);
      this.stopMode = true;
      this.clearStopArm();
      this.tick(true);
      return;
    }
    if (this.loopMode) { this.setLoop(-1); return; }
    if (this.stopMode) this.dropStop(true);
    this.tick(true);
  }

  // Q 键：每句停开着就关（回到连续播放），没开就开（循环开着先关）
  toggleStopMode() {
    this.setPlayMode(this.stopMode ? 'continuous' : 'stop');
  }

  // 从练习回到观影：换回练习前的播放方式 m。
  // 和 setPlayMode 只差在关循环：暂停着就照旧停着（exitLoopAndPause；setLoop(-1) 会顺手开播），放着的接着往下放（同进画中画那条）。
  // 'loop'：练习前就在循环，开着就不动、关了照 armLoop 只亮按钮
  restorePlayMode(m) {
    if (this.destroyed) return;
    if (m === 'loop') { if (!this.loopMode) this.armLoop(); return; }
    if (this.loopMode) { if (this.video.paused) this.exitLoopAndPause(); else this.setLoop(-1); }
    this.setPlayMode(m);
  }

  // 现在的播放方式（state.playMode 用）
  playModeNow() {
    return this.loopMode ? 'loop' : this.stopMode ? 'stop' : 'continuous';
  }

  // 进入循环模式的唯一入口（四处要开循环模式的地方都走它）：每句停和循环互斥，开循环先把每句停关掉（不放开它的暂停——
  // 开循环的几条路自己要不要播各有各的规矩，armLoop 只亮按钮、不开播）
  enterLoopMode() {
    this.dropStop(false);
    this.loopMode = true;
  }

  // 关掉每句停。resume：把它自己造成的暂停放开（她自己按的暂停、拖完又暂停的都不碰）。不 tick，调用方自己刷新
  dropStop(resume) {
    if (!this.stopMode) return;
    const back = resume && this.autoPaused && this.video.paused && !this.video.ended;
    this.stopMode = false;
    this.clearStopArm();
    if (back) this.play();
  }

  // 待停的句子、停过的记号、自己造成的暂停都作废（每句停开不开不变）
  clearStopArm() {
    this.stopArm = -1;
    this.stopDone = -1;
    this.autoPaused = false;
  }

  // 现在要判停点的是哪句：正在循环的、重播一次的（它们优先），然后才是每句停待停的那句；没有 -1。
  // 定时器（scheduleSegment）、紧盯（spinStep）都问它，和 tick 里到点的判断是同一个目标
  segTarget() {
    return this.loopIndex >= 0 ? this.loopIndex : this.once >= 0 ? this.once : this.stopMode ? this.stopArm : -1;
  }

  // 挑待停的句子（每句停播着、没在循环 / 重播、还没有待停的句子时由 tick 调；t 是播放头）：
  // 刚跳过去的钉子（navPin）优先——不然两句挨着时按时间还在上一句里；其次播放头所在的句子；在空档里取下一句。
  // 已经停过的那句、停点已经过了的那句往后跳（停在停点上再播放：播放头就在停点上，不能再触发它）。没有了 -1
  armStop(t) {
    const n = this.lines.length;
    let i = this.navPin >= 0 ? this.navPin : this.indexAt(t, true);
    if (i < 0) { const j = lastStartedAt(this.lines, t) + 1; i = j < n ? j : -1; }
    while (i >= 0 && (i === this.stopDone || t >= this.stopAt(i))) i = i + 1 < n ? i + 1 : -1;
    const prev = this.stopArm;
    this.stopArm = i;
    // 新挑中了一句：定时器按它的停点挂（后台标签页 rAF 停了也要按点停；onPlay 里的 scheduleSegment 比这一步早，那时还没有目标）
    if (i >= 0 && i !== prev && !this.video.paused) this.scheduleSegment();
  }

  // 到了待停那句的停点：真暂停（不是留白冻结），钉住这句；记下停过的是它，再按播放不会重复触发
  stopHere() {
    const k = this.stopArm;
    this.stopArm = -1;
    this.stopDone = k;
    this.hold = k;
    this.lastNav = k;
    this.autoPaused = true;
    clearTimeout(this.segTimer);
    this.segTimer = 0;
    this.spin = 0;
    this.video.pause();
  }

  // 打开视频 / 切到排序时默认开着循环模式：只亮按钮，不跳、不开播。
  // 她按播放时 tick 按播放头咬住那句（和空档里按 R 一样）；已经开着就不动。
  // 眼下这句还不能循环（loopGate）：先记着（armWanted），能循环了 tick 自己开
  armLoop() {
    if (this.loopMode) return;
    this.dropStop(false);      // 练习（排序 / 听写）只许单句循环，每句停让位
    if (!this.canLoop(this.loopPick(this.video.currentTime))) { this.armWanted = true; this.emit(); return; }
    this.armWanted = false;
    this.enterLoopMode();
    this.emit();
  }

  // 记着的「能循环了自己开」作废（进画中画放开循环：只看片时不循环；回来由 armLoop 重新记）
  disarm() {
    this.armWanted = false;
  }

  // setLoop(i)：循环第 i 句（从句首开始）；setLoop(-1)：关掉循环、接着往下播。
  // 第 i 句还不能循环（loopGate）：不理
  setLoop(i) {
    if (i < 0) {
      this.armWanted = false;
      const wasFrozen = this.gapActive;
      const back = this.earlyUndo();
      this.loopMode = false;
      this.stopSegment();
      if (back != null) this.seekTo(back);
      // 片尾留白（已经播到头）时不放：对播完的片子 play() 浏览器会先跳回 0，等于从头重放
      if ((wasFrozen || this.video.paused) && !this.video.ended) this.play();
      this.tick(true);
      return;
    }
    if (!this.canLoop(i)) return;
    this.armWanted = false;
    this.enterLoopMode();
    this.playLine(i);
  }

  // 打开跟读、单词这些页面之前：先退出循环再暂停（exitLoopAndPause；
  // 只暂停的话，留白定时器到点会在后台把视频又放起来）。
  // 她刚拖了进度条、seeked 还没到（拖完一律开播在等着）：也作废，不然 seeked 一到片子在任务页后面放起来。
  // 正在循环 / 重播的那句钉住，关掉任务页回来面板还在这句上（见 hold）。
  exitLoopAndPause() {
    const keep = this.pinned();
    const back = this.earlyUndo();
    this.loopMode = false;
    this.armWanted = false;
    this.userSeeked = false;
    this.stopSegment();
    if (back != null) this.seekTo(back);
    this.hold = keep;
    this.video.pause();
    this.tick(true);
  }

  // 打开生词本、跟读、单词这些页面之前：只暂停，循环模式和循环的那句照旧、不退出循环状态。
  // 退出循环是怕留白定时器在后台
  // 把片子放起来——留白时视频没停（速度 0），pause() 走 onPause 清掉留白定时器，定时器到点也先看 paused，放不起来。
  // 她刚拖了进度条、seeked 还没到（拖完一律开播在等着）：也作废，不然 seeked 一到片子在页签那一页后面放起来。回来按播放接着循环这句
  pauseForPage() {
    this.userSeeked = false;
    this.video.pause();
    this.tick(true);
  }

  // ---- 内部 ----

  // 钉住的句子：正在循环的、正在重播的、停住钉着的（没有返回 -1）
  pinned() {
    return this.loopIndex >= 0 ? this.loopIndex : this.once >= 0 ? this.once : this.hold;
  }

  // 自动咬住、「循环」按钮收不收第 i 句
  accepts(i) {
    return !this.filter || !!this.filter(i, this.lines[i]);
  }

  // 第 i 句眼下能不能循环（loopGate，见文件头）；-1（没有句子）只在有 loopGate 时算不能
  canLoop(i) {
    return !this.loopGate || (!!this.lines[i] && !!this.loopGate(i, this.lines[i]));
  }

  // 现在按循环会循环哪句（同 toggleLoop 的挑法）；在空档里就是下一句（等着咬住它）。没有返回 -1
  loopPick(t) {
    const p = this.pinned();
    if (p >= 0) return p;
    if (this.navPin >= 0) return this.navPin;
    const k = this.indexAt(t, true);
    if (k >= 0) return k;
    const f = this.focused();
    if (f >= 0) return f;
    const n = lastStartedAt(this.lines, t) + 1;
    return n < this.lines.length ? n : -1;
  }

  // 被 loopGate 挡住时悄悄关掉循环：不跳、不开播（setLoop(-1) 暂停着会开播）。留白冻着的解冻接着往下放；
  // 暂停着就钉住原来那句，画面、列表不跳
  unloop() {
    const keep = this.video.paused ? this.pinned() : -1;
    const back = this.earlyUndo();
    this.loopMode = false;
    this.stopSegment();
    if (back != null) this.seekTo(back);
    this.hold = keep;
  }

  // loopGate 换了：开着的循环眼下这句不能循环了就悄悄关掉、记着能循环了再开（armWanted）；按钮灰不灰交给 tick 重算
  gateCheck() {
    if (this.loopMode) {
      const k = this.loopIndex >= 0 ? this.loopIndex : this.loopPick(this.video.currentTime);
      if (!this.canLoop(k)) { this.unloop(); this.armWanted = true; }
    }
    this.tick(true);
  }

  // 面板上摆着的那道题（setFocus），这句不在当前字幕里（换字幕时界面还没跟上）就当没有
  focused() {
    return this.lines[this.focus] ? this.focus : -1;
  }

  // 「继续播放」放行的是哪句：钉住的那句；刚跳过去还在前缓冲里的那句；
  // 播放头所在的那句；在空档里（播放、暂停都一样）是面板上摆着的那道题（她在排、播进空档面板留着）。
  // 面板空着就没有：只接着放、不往回退。【不能】拿导航光标 lastNav 兜底——播进空档面板清了（= -1，
  //）以后她在空档里暂停再点，会被拉回上一句句尾、整段空档重放一遍（此时 passedCue 是 undefined，不退）。
  passIndex() {
    const p = this.pinned();
    if (p >= 0) return p;
    if (this.navPin >= 0) return this.navPin;
    const i = this.indexAt(this.video.currentTime, true);
    if (i >= 0) return i;
    return this.focused();
  }

  // 第 i 句循环段的起点、终点。终点不超过片长。
  // 前缓冲最多用到和上一句之间空档的一半、后缓冲最多用到和下一句之间空档的一半；两句挨着、重叠（空档 ≤ 0）就不加缓冲
  // 精听、排序都各用一半：上一句的后缓冲和这一句的前缓冲正好在空档中间碰头，谁都不伸进对方的话里——只要字幕时间本身对得上，
  // 循环听到的就正好是屏幕上那几个字。
  // 合并只并 0.3 秒以内的句子（英文 m4、中文 zm2），中文句末够长的不管多近都断，两句常常只隔零点几秒、甚至挨着，所以缓冲不夹的话会漏进邻句。
  // 邻句 = 编号相邻的那句。
  // 字幕边读边长时正在循环 / 重播的那句起止锁在换列表之前那样（frozen，见 swapLines），不跟着新插进来的邻句重新夹
  loopStart(i) {
    const line = this.lines[i];
    if (this.frozen && this.frozen.line === line) return this.frozen.a;
    let lead = this.timing.leadIn;
    if (i > 0) lead = Math.min(lead, Math.max(0, (line.start - this.lines[i - 1].end) / 2));
    return Math.max(0, line.start - lead);
  }
  loopEnd(i) {
    const line = this.lines[i];
    if (this.frozen && this.frozen.line === line) return this.frozen.b;
    let tail = this.timing.tail;
    if (i + 1 < this.lines.length) tail = Math.min(tail, Math.max(0, (this.lines[i + 1].start - line.end) / 2));
    const e = line.end + tail;
    const d = this.video.duration;
    return Number.isFinite(d) ? Math.min(d, e) : e;
  }
  // 第 i 句判「到了循环终点」的时刻（停点）：循环终点往前提 END_EARLY，但不早于句尾——后缓冲用了多少最多提前多少（见 END_EARLY）
  stopAt(i) {
    const e = this.loopEnd(i);
    return e - Math.min(END_EARLY, Math.max(0, e - this.lines[i].end));
  }

  // 播放头所在的句子：start - 容差 <= t；strict=true 时还要求 t 没过句尾
  indexAt(t, strict = false) {
    const i = lastStartedAt(this.lines, t + EDGE);
    if (i < 0) return -1;
    if (strict && t > this.lines[i].end + EDGE) return -1;
    return i;
  }

  // 不循环时的当前句编号，顺带维护导航光标：
  // 1. 刚 ←/→、点列表跳过去，播放头还在它的前缓冲里：就是跳过去的那句（钉住）
  // 2. 播放头落在某句的时间窗里：就是那句，导航光标记下它
  // 3. 在空档里：导航光标记着的刚才那句（只认「包含播放头的句子」，
  //    空档里 lastNavIndex 不动
  // 4. 光标也没有（刚打开、续播落在空档里）：按时间最近开始的那句——只用来显示和定翻译优先级；
  //    ←/→ 这时走 step 里「按时间找邻居」的冷启动
  cursorAt(t) {
    if (this.navPin >= 0) {
      const pin = this.lines[this.navPin];
      if (pin && t < pin.start - EDGE) return this.navPin;
      this.navPin = -1;
    }
    const i = this.indexAt(t, true);
    if (i >= 0) { this.lastNav = i; return i; }
    return this.lastNav >= 0 ? this.lastNav : lastStartedAt(this.lines, t + EDGE);
  }

  play() { this.video.play().catch(() => {}); }

  seekTo(t) { internalSeek(this.video, t); }

  // 见上面导出的 relocate（LP-1）
  relocate(t) {
    this.stopSegment();
    this.navPin = -1;
    this.clearStopArm();
    this.lastNav = lastStartedAt(this.lines, t + EDGE);
    this.seekTo(t);
  }

  // 停掉本句循环、留白、重播停点、钉子、放行标记；循环模式本身不动
  stopSegment() {
    this.clearGap();
    this.frozen = null;
    this.loopIndex = -1;
    this.once = -1;
    this.hold = -1;
    this.skipLatch = -1;
    this.endedHold = false;
    clearTimeout(this.segTimer);
    this.segTimer = 0;
    this.spin = 0;
  }

  // 留白里已经提前跳回句首了（earlyBack）：关循环、退出循环时要回到的地方（循环终点，留白本来冻在那儿）；不是就 null。
  // 不回去的话「关掉循环接着往下播」会把这句再放一遍
  earlyUndo() {
    return this.gapActive && this.gapEarly && this.lines[this.loopIndex] ? this.loopEnd(this.loopIndex) : null;
  }

  // 结束留白：恢复速度（冻结期间改的速度这时才写进去）、清定时器
  clearGap() {
    if (this.gapActive) this.video.playbackRate = this.speed;
    this.gapActive = false;
    this.gapEnded = false;
    this.gapEarly = false;
    clearTimeout(this.gapTimer);
    this.gapTimer = 0;
  }

  // 到循环终点：留白 gap 秒再跳回句首。
  // 播放中用速度 0 原地冻结（不发 pause、不闪控制条，见文件头）。
  // ended=true：片子已经播到头、浏览器自己停了，不用冻结，等够留白直接跳回接着循环。
  endOfLoop(ended) {
    this.loops++;              // 走完一遍
    const gap = this.timing.gap;
    if (gap <= 0) { this.back(); return; }
    this.gapActive = true;
    this.gapEnded = ended;
    clearTimeout(this.segTimer);
    this.segTimer = 0;
    if (!ended) this.video.playbackRate = 0;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = 0;
      const wasEnded = this.gapEnded;
      const early = this.gapEarly;
      const k = this.loopIndex;
      // 再兜一道：Chrome 里 pause() 同步置 paused、'pause' 事件排队，定时器可能抢在事件前面到点。
      // 她已经暂停了就只恢复速度，不跳回开播；片尾那种是浏览器停的，照样跳回
      const go = k >= 0 && (wasEnded || !this.video.paused);
      // 留白一开始已经跳回句首（earlyBack）、留白里没人动过播放头：恢复了速度就是接着放，不再跳一次
      const stay = go && early && Math.abs(this.video.currentTime - this.loopStart(k)) < 0.25;
      // 先跳回句首、再恢复速度：反过来的话，恢复速度到跳转生效之间可能从冻住的地方接着放出一小截声音——
      // 后缓冲夹成 0（两句挨着）时冻住的地方就是下一句的开头
      const jump = go && !stay && !!this.lines[k];
      if (jump) this.seekTo(this.loopStart(k));
      this.clearGap();
      if (stay || jump) { this.play(); this.scheduleSegment(); }
      this.tick(true);
    }, gap * 1000);
    // earlyBack（边转边播的片）：冻住的同时就跳回句首，跳转要等的那一会儿藏进留白里。片尾那种（浏览器已经停了）照旧到点再跳
    if (!ended && this.earlyBack && this.lines[this.loopIndex]) {
      this.gapEarly = true;
      this.seekTo(this.loopStart(this.loopIndex));
    }
  }

  back() {
    if (!this.lines[this.loopIndex]) return;
    this.seekTo(this.loopStart(this.loopIndex));
    this.play();
    this.scheduleSegment();
  }

  // 重播一次放完（或中途被暂停）：循环模式开着就回到「循环这句、停着」（再按播放接着循环，由
  // handleVideoPlay → startLoopFromCurrentPosition）；没开就钉住这句等她再按播放。
  // 「继续播放」放行过的这句也只钉住：接着循环的条件里有 cueKey !== skipLoopLatchKey，
  // 再按播放接着往下放、播进下一句照常咬住。钉住而不是回到「等着咬住」：停点常落进下一句，不钉绿框会被下一题顶掉
  finishOnce() {
    const i = this.once;
    this.once = -1;
    clearTimeout(this.segTimer);
    this.segTimer = 0;
    if (this.loopMode && i !== this.skipLatch && this.canLoop(i)) this.loopIndex = i;
    else this.hold = i;
  }

  // 循环模式开着、还没咬住句子时，播到第 i 句里就咬住它（(true, true)）。
  // 顺着播过来、刚过句首一点点：不往回跳（这截刚出过声）。播放头在句子深处（字幕读完、换轨时
  // 循环模式保留了）：跳回句首，不然第一遍只剩半句。让步量取一个 timeupdate 的距离
  // （0.3 秒 × 倍速），短句再封顶到句长的 1/4。
  latch(i, t) {
    const line = this.lines[i];
    this.loopIndex = i;
    this.lastNav = i;
    this.navPin = -1;
    const room = Math.min(0.3 * Math.max(1, this.speed || 1), (line.end - line.start) * 0.25);
    if (t > line.start + room || t >= this.stopAt(i)) this.seekTo(this.loopStart(i));
    this.scheduleSegment();
  }

  // 播放：停住时钉着的那句松开，接着往下放
  onPlay() {
    if (this.hold >= 0) { this.lastNav = this.hold; this.hold = -1; }
    this.autoPaused = false;   // 再放起来了：每句停造成的暂停到此为止（stopDone 留着，停点上再播放不重复触发）
    this.startRaf();
    this.scheduleSegment();
    this.tick();
  }

  // 暂停（空格、单击画面、控制条暂停键都走 video.pause()；留白冻结时 video.paused 是 false，所以都会走到这里）：
  // 只停跳转、不退出循环——循环模式和循环的那句都留着，
  // 但留白定时器必须清掉，否则留白到点（默认 1 秒）后它跳回句首自己开播。
  // 再按播放时播放头还在循环终点，tick 会重新留白、再跳回句首。
  // 重播一次中途暂停：停点作废，按 finishOnce 收尾。
  onPause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.segTimer);
    this.segTimer = 0;
    if (this.once >= 0) {
      this.finishOnce();
      // 一路放到了片尾（'pause' 在 'ended' 之前到，这时 ended 已经是 true）：见 endedHold
      if (this.video.ended && this.loopIndex >= 0) this.endedHold = true;
    }
    if (this.gapActive && !this.gapEnded) this.clearGap();
    this.tick();
  }

  // 播到片尾：循环着就按「到了循环终点」处理。终点被片长截住时，后台标签页 rAF 停了、
  // 只剩约 4 次/秒的 timeupdate，可能没赶在播完前判到终点；浏览器先停了（'pause' 在 'ended' 之前到），
  // 这里接着循环，不然循环悄悄停在片尾、按钮还亮着。
  // 重播一次放到片尾不算：那是「放完就停」（onPause 已经收尾、记了 endedHold）。
  onEnded() {
    if (this.once >= 0) {
      this.finishOnce();
      if (this.loopIndex >= 0) this.endedHold = true;
    } else if (this.loopIndex >= 0 && this.lines[this.loopIndex] && !this.gapActive && !this.endedHold) {
      this.endOfLoop(true);
    }
    this.tick(true);
  }

  onSeeking() {
    if (takeQuietSeek(this.video)) return;
    const t = this.video.currentTime;
    // 片尾留白里她按了播放：浏览器对播完的片子 play() 会先拉回 0（规范），这不是她拖的进度条——
    // 直接跳回本句句首接着循环。落点不是 0 的才算她自己拖。重播一次放到片尾停住的同理（endedHold）
    if ((this.gapEnded || this.endedHold) && this.loopIndex >= 0 && t < 0.05) {
      this.clearGap();
      this.endedHold = false;
      this.back();
      return;
    }
    // 用户拖了进度条 / Shift+←/→
    this.userSeeked = true;
    this.navPin = -1;
    this.hold = -1;
    this.clearStopArm();       // 每句停：拖进度条不触发它；待停的、停过的都作废，拖完在落点上重挑（往回拖能再停一次）
    this.skipLatch = -1;
    this.endedHold = false;
    // 记着「能循环了自己开」（armWanted）的时候拖：同「循环·等待咬住」时拖（下面 A11），作废，不然译文一到又把循环开回来
    this.armWanted = false;
    if (this.once >= 0) {
      // 重播这一遍被她拖进度条打断：停点作废。
      // 循环模式里重播的就是循环句（放完本来会接着循环它），下面按「循环中拖」判：拖出本句退出、本句里拖接着循环
      const i = this.once;
      this.once = -1;
      clearTimeout(this.segTimer);
      this.segTimer = 0;
      if (this.loopMode && this.canLoop(i)) this.loopIndex = i;
    }
    if (this.loopIndex >= 0) {
      const k = this.loopIndex;
      // 落进了别的句子（按画面认句子的口径，indexAt 带容差）也算拖出本句：句子之间常常只隔零点几秒（合并只并 0.3 秒以内的），
      // 光看「循环段前后各放宽 0.5 秒」的话，拖到下一句开头还会被拉回来接着循环这一句
      const into = this.indexAt(t, true);
      if (!this.lines[k] || (into >= 0 && into !== k) || t < this.loopStart(k) - 0.5 || t > this.loopEnd(k) + 0.5) {
        // 拖出本句范围：退出循环
        this.loopMode = false;
        this.stopSegment();
      } else if (this.gapActive) {
        // 在本句范围里拖：解冻接着循环
        this.clearGap();
      }
    } else if (this.loopMode) {
      // 「循环·等待咬住」时还没有「本句」：一拖就彻底退出循环模式，
      // 不然 tick 会咬住落点所在的句子、从半句开始循环
      this.loopMode = false;
    }
    // 不循环了：当前句跟着落点走。落在第一句之前得到 -1，
    // ←/→ 走按时间找邻居的冷启动，→ 去第 0 句，而不是回到拖动前那句的下一句
    if (this.loopIndex < 0) this.lastNav = lastStartedAt(this.lines, t + EDGE);
  }

  onSeeked() {
    if (this.userSeeked) {
      this.userSeeked = false;
      // 拖完一律开始播放，落在片尾的除外：对播完的片子 play() 浏览器会先跳回 0，
      // 等于从头带声音重放。
      // 【改】不搬「页面在后台时不开播」的判断（document.hidden）：画中画小窗里
      // 拖进度条时主页面常常就是 hidden，照搬的话小窗里拖完不会播。要防的「点了任务按钮片子在后台放起来」
      // 由 exitLoopAndPause 清 userSeeked 管住。
      const v = this.video;
      const atEnd = v.ended || (Number.isFinite(v.duration) && v.currentTime >= v.duration - 0.05);
      if (!atEnd) this.play();
    }
    this.scheduleSegment();
    this.tick();
  }

  startRaf() {
    if (this.raf || this.destroyed) return;
    const loop = () => {
      if (this.destroyed) { this.raf = 0; return; }
      this.tick();
      this.raf = this.video.paused ? 0 : requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // 按剩余时长挂定时器，后台标签页也能按时判句尾（循环终点、重播一次的停点）。
  // 以前挂到循环终点之后 30 毫秒，后台时只靠它判，两句挨着、后缓冲夹成 0 时多等的那截直接放进了下一句
  // （1.25 倍速实测跨进 38–53 毫秒）。现在离停点（stopAt）还远就挂到停点前 SEG_NEAR_MS，到了以后紧盯（spinTo）到停点。
  // fired：这次是定时器到点以后接着挂的。到点了播放头却一动没动（卡住等数据），或者已经过了停点还没判（正在跳转），隔 25 毫秒再看，不紧着空转
  scheduleSegment(fired = false) {
    clearTimeout(this.segTimer);
    this.segTimer = 0;
    this.spin = 0;
    if (this.destroyed) return;
    const k = this.segTarget();
    const v = this.video;
    if (!this.lines[k] || this.gapActive || v.paused) return;
    const t = v.currentTime;
    const left = ((this.stopAt(k) - t) / Math.max(0.1, v.playbackRate || this.speed)) * 1000;
    const stuck = left <= 0 || (fired && t === this.segAt);
    this.segAt = t;
    if (!stuck && left <= SEG_NEAR_MS && this.chan) { this.spinTo(left); return; }
    const ms = stuck ? Math.max(25, left) : left > SEG_NEAR_MS ? left - SEG_NEAR_MS : Math.max(1, left);
    this.segTimer = setTimeout(() => { this.segTimer = 0; this.tick(); this.scheduleSegment(true); }, ms);
  }

  // 紧盯停点（见 SEG_NEAR_MS）：每条消息看一眼（tick），到了停点 tick 自己判（留白 / 停）；left 是离停点还有多少毫秒。
  // 盯到该到停点以后 SPIN_GRACE_MS 还没到（卡住等数据），放手回到定时器
  spinTo(left) {
    this.spin = ++this.spinSeq;
    this.spinUntil = performance.now() + left + SPIN_GRACE_MS;
    // 兜底：消息万一不来（浏览器把页面挂起又放出来），到时候照样靠定时器判。判到停点（endOfLoop / finishOnce）、暂停都会清掉它
    this.segTimer = setTimeout(() => { this.segTimer = 0; this.tick(); this.scheduleSegment(true); }, left + SPIN_GRACE_MS);
    this.chan.port2.postMessage(this.spin);
  }
  spinStep(id) {
    if (id !== this.spin || this.destroyed) return;
    this.tick();
    if (id !== this.spin) return;                       // tick 里退出了循环、换了句子，别处已经重新挂过
    const k = this.segTarget();
    if (!this.lines[k] || this.gapActive || this.video.paused) { this.spin = 0; return; }   // 判到了停点（或者停了）
    if (performance.now() > this.spinUntil) { this.scheduleSegment(true); return; }
    this.chan.port2.postMessage(id);
  }

  tick(force) {
    if (this.destroyed) return;
    const v = this.video;
    let t = v.currentTime;

    // 循环模式开着、还没咬住句子：播到一句里就咬住它。放行的那句不咬；播进别的句子就恢复；
    // filter 不收的句子正常放过去，等下一句。重播一次的时候不咬
    // 刚跳过去、播放头还在它前缓冲里（navPin）就认那句，不按时间认成上一句（「继续播放」见 release）
    // 想开循环、刚才这句还不能循环（armWanted）：眼下这句能了就把循环模式开上（同 armLoop 只亮按钮），播着的话下面接着咬住
    if (this.armWanted && !this.loopMode && this.canLoop(this.loopPick(t))) { this.armWanted = false; this.enterLoopMode(); }
    if (this.loopMode && this.loopIndex < 0 && this.once < 0 && !v.paused) {
      const i = this.navPin >= 0 ? this.navPin : this.indexAt(t, true);
      if (i >= 0 && i !== this.skipLatch) {
        this.skipLatch = -1;
        if (this.accepts(i)) {
          if (this.canLoop(i)) { this.latch(i, t); t = v.currentTime; } // 咬住时可能跳回了句首，重新取播放头
          else { this.loopMode = false; this.armWanted = true; }      // 这句还不能循环（loopGate）：关掉、按钮灰着，能循环了自己开
        }
      }
    }

    // 每句停：播着、没在循环 / 重播时盯一个待停的句子。没有、字幕换了、播放头退到了它的句首之前（往回的程序跳转）、
    // 或者远远越过了它的停点（STOP_STALE）才重挑；其余时候一挑中就不改（停点常落在 indexAt 的容差之外，每帧重挑会丢掉它）
    if (this.stopMode && this.loopIndex < 0 && this.once < 0 && !v.paused && !v.seeking) {
      const a = this.stopArm, al = this.lines[a];
      if (!al || t < al.start - EDGE || t > this.stopAt(a) + STOP_STALE) this.armStop(t);
    }

    // 到循环终点：留白，再跳回句首；重播一次到终点：停
    if (!this.gapActive && !v.paused && !v.seeking) {
      if (this.loopIndex >= 0) {
        if (this.lines[this.loopIndex] && t >= this.stopAt(this.loopIndex)) { this.endOfLoop(false); t = v.currentTime; }
      } else if (this.once >= 0) {
        if (this.lines[this.once] && t >= this.stopAt(this.once)) { this.finishOnce(); v.pause(); t = v.currentTime; }
      } else if (this.stopMode && this.lines[this.stopArm] && t >= this.stopAt(this.stopArm)) {
        this.stopHere(); t = v.currentTime;
      }
    }

    // 当前句 / 画面上显示哪句
    let index, active;
    const pin = this.pinned();
    if (pin >= 0) {
      index = pin;
      const line = this.lines[index];
      // 只在这句自己的时间窗里显示；暂停时例外，照常显示（条件是
      // video.paused || 时间窗）——「听完暂停看译文」正好落在后缓冲或留白里。
      // 暂停会清掉留白（onPause），剩下的 gapActive 只有播放中的冻结和片尾留白，这两种都不显示。
      const inWindow = line && t >= line.start - EDGE && t < line.end + EDGE;
      active = line && !this.gapActive && (v.paused || inWindow) ? index : -1;
    } else {
      index = this.cursorAt(t);
      if (this.navPin >= 0) {
        // 钉住时播放头还在前缓冲里：不闪出上一句的字幕（列表已经高亮跳过去的那句，画面别和它对不上）；暂停时照常显示这句
        active = v.paused ? index : -1;
      } else {
        const i = lastStartedAt(this.lines, t + EDGE);
        active = i >= 0 && t < this.lines[i].end ? i : -1;
        // 暂停在空档里：给面板上摆着的那道题（条件 video.paused && cues[selectedIndex]，
        // 她停在句间排这句，画面字幕、答题区中文照常给）；面板空着、播放中的空档都不给
        if (active < 0 && v.paused) active = this.focused();
      }
    }
    const paused = v.paused && !this.gapActive;
    const loopLocked = !this.loopMode && !!this.loopGate && !this.canLoop(this.loopPick(t));
    const playMode = this.playModeNow();
    const s = this.state;
    if (force === true || index !== s.index || active !== s.active || this.loopIndex !== s.loopIndex
      || this.gapActive !== s.waiting || this.loopMode !== s.loopMode || paused !== s.paused
      || this.once !== s.once || this.loops !== s.loops || loopLocked !== s.loopLocked || playMode !== s.playMode) {
      this.state = { index, active, loopIndex: this.loopIndex, waiting: this.gapActive, loopMode: this.loopMode, playMode,
        paused, once: this.once, loops: this.loops, loopLocked };
      for (const fn of this.listeners) fn(this.state);
    }
  }

  emit() { this.tick(true); }
}
