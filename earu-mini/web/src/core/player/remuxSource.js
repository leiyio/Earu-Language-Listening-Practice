// 浏览器放不了的 MKV（iPhone：iOS 27 / Safari 27 仍不认 MKV 盒子）：纯网页把它拆开，画面和声音原样装进 MP4 的盒子
// （Mediabunny Conversion 复制模式，不重新压缩），一段段喂给浏览器自己的播放器——边转边播。全在这台机器上做，不上传。
// 经过验证的做法（iPhone 实测 1080p H.265 + AAC：0.1 秒起播、跳到中间 0.5 秒、有声音）：
// - iPhone 用 ManagedMediaSource（iOS 17.1 起，要 video.disableRemotePlayback = true，Player 里设），别的浏览器用 MediaSource；
// - 输出分片 MP4（fastStart 'fragmented'，StreamTarget 一块块写），转换跑在播放头前面 60 秒就歇（iPhone 听系统的 startstreaming /
//   endstreaming），播放头后面留 30 秒（循环要跳回句首），装不下就删更早的；
// - 拖到没转的地方（含续播、循环跳回去发现被删了、播着播着卡在被系统收走的地方）：从前一个关键帧重新转，sourceBuffer.abort() 以后
//   timestampOffset = 关键帧时间（库按 trim 起点从 0 写时间）；
// - 从中间转时库给声音写一张长度 0 的剪辑表，iPhone 照办就没声音：喂之前把 moov 里的 edts 抹掉（remuxPlan.js dropEditLists）；
// - 停掉一次转换库会抛「Conversion has been canceled.」，按取消算、不当出错；
// - 这台机器收不了那条声音（电脑 Chrome 的 MediaSource 不收 EAC3，iPhone 收；实验时 5.1 声道 AAC 也喂不进去过）：只放画面，
//   onAudioDropped 告诉界面。声音已经正常放过、后来才出错的不怪声音，先带着声音重接一次（remuxPlan.js errorPlan）。
// 浏览器能直接放的照旧直接放（chooseSource 先拿一个不挂在页面上的 <video> 真试一下，试出第一帧就回文件本身的地址），
// Mediabunny 只在要换盒子时才加载。
// 浏览器能放画面、放不了声音的片子（杜比 / DTS，电脑 Chromium 不带这几种解码器）：可以也换盒子，
// 声音交给外部解码、重新编成 AAC / Opus，画面照旧原样搬（MP4 也一样：盒子本身浏览器认，认不了的是声音）。外部解码不可用时不起作用。
import { internalSeek } from './sentencePlayer.js';
import { dropShellAudio, registerShellAudio, shellCodecs, shellDecodes } from './shellAudio.js';
import { audioDialectOf, normalizeLang } from '../lang.js';
import {
  FORCE_KEY, remuxVerdict, isEbml, boxType, cutIndex, dropEditLists, toRanges, feedNow, trimPlan, quotaPlan, needRestart, isCancel,
  convOptions, errorPlan, HEARD,
} from './remuxPlan.js';

const MMS = typeof window !== 'undefined' ? window.ManagedMediaSource || null : null;
const MS = typeof window !== 'undefined' ? window.MediaSource || null : null;
const SRC = MMS || MS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function forced() {
  try { return localStorage.getItem(FORCE_KEY) === '1'; } catch { return false; }
}

// 等 SourceBuffer 这一下做完：updateend 算完，error 算出错（喂进去的数据浏览器不认）
function updateEnd(sb) {
  return new Promise((resolve, reject) => {
    const ok = () => { sb.removeEventListener('error', bad); resolve(); };
    const bad = () => { sb.removeEventListener('updateend', ok); reject(new Error('browser rejected this chunk')); };
    sb.addEventListener('updateend', ok, { once: true });
    sb.addEventListener('error', bad, { once: true });
  });
}

const TRIAL_MS = 1000; // 试放最多等 1 秒（电脑 Chrome / Edge 读本地 MKV：页面里第一次 160～200 毫秒，以后 20～40 毫秒）
const QUICK_MS = 300; // 试放 0.3 秒还没结果才一边试一边读编码（读的时候才加载 Mediabunny）：电脑上用不着它

// 拿一个不挂在页面上的 <video>（静音、不播）真试一下这个地址，回 { ok, why, ms }：读出了第一帧画面（loadeddata、有画面宽度）ok 为真；
// why 是 'ok' / 'error N'（浏览器报错，N 是错误码）/ 'novideo'（只有声音）/ 'timeout'（到点还没读出来）。
// 要的是第一帧不只是片长：只读出片长、真放时才发现解不了的不算能放——iPhone 上错判成「能放」就整个放不了，错判成「不能放」只是多换一次盒子。
// 实验页 lab/mkv.js 也调它，把结果和用时打出来（真 iPhone 上是秒报错还是不读、要等到点，看那里）
export function tryDirect(url, ms = TRIAL_MS) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    let v;
    try { v = document.createElement('video'); } catch { resolve({ ok: false, why: 'error', ms: 0 }); return; }
    let timer = 0;
    const done = (why) => {
      clearTimeout(timer);
      v.removeEventListener('loadeddata', onData);
      v.removeEventListener('error', onErr);
      try { v.removeAttribute('src'); v.load(); } catch { /* 放掉它 */ }
      resolve({ ok: why === 'ok', why, ms: Math.round(performance.now() - t0) });
    };
    const onData = () => done(v.videoWidth > 0 ? 'ok' : 'novideo');
    const onErr = () => done(`error ${v.error?.code ?? ''}`.trim());
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('loadeddata', onData);
    v.addEventListener('error', onErr);
    timer = setTimeout(() => done('timeout'), ms);
    v.src = url;
  });
}

// 这部片怎么放：返回 { url, remux }。url 给 <video>；remux 不为 null 就是走换盒子，Player 拿到 video 以后 attach，关片 / 换片时 destroy。
// handlers：onAudioDropped() 这台机器放不了这条声音、只放画面；onFail(message) 换盒子也放不了（界面按「画面放不了」提示）。
// MKV 先真试一下（tryDirect）：试出第一帧就直接放。试不出来再换盒子；读不出来、画面编码这台机器的 MediaSource 也不收：
// 回文件本身的地址，交给浏览器自己试（和以前一样，放不了由界面报错）。
// learn：在学的语言（trackLangOf 过的；不给就不按语言挑）：放哪条声音按它挑，片子里在学语言那条不是默认那条也换盒子（wantRemux）
export async function chooseSource(file, handlers = {}, learn = null) {
  const url = URL.createObjectURL(file);
  const direct = () => ({ url, remux: null });
  let head;
  try { head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); } catch { return direct(); } // 读不了：交给浏览器，照旧报错
  const base = { ebml: isEbml(head), force: forced(), hasMSE: !!SRC };
  let verdict = remuxVerdict(base);
  const fromFile = (mb) => new mb.BlobSource(file);
  let probing = null;
  // 外部解码得了杜比 / DTS：先读编码（本机文件只读文件头和索引，很快）——声音要外部解码的、要放的不是默认那条声音的直接换盒子，试放试不出这两样
  if (SRC && verdict !== 'remux' && shellCodecs().length) {
    const probe = await probeFile(fromFile, learn).catch(() => null);
    if (probe && wantRemux(probe)) return remuxOf(probe, url, handlers);
    if (verdict === 'direct' || !probe) { probe?.input.dispose(); return direct(); }
    probing = Promise.resolve(probe);
  }
  if (verdict === 'direct') return direct();
  if (verdict === 'try') {
    const trying = tryDirect(url);
    // 电脑上零点几秒内就试出来了，能放就不读编码、不加载 Mediabunny；试得慢（iPhone 报错慢、或者干脆不读等到点）就一边试一边读，少等一会儿
    if (!probing && !(await Promise.race([trying, sleep(QUICK_MS)]))) probing = probeFile(fromFile, learn).catch(() => null);
    verdict = remuxVerdict({ ...base, plays: (await trying).ok });
    if (verdict === 'direct') { probing?.then((p) => p?.input.dispose()); return direct(); }
  }
  const probe = await (probing || probeFile(fromFile, learn).catch(() => null));
  if (!probe) return direct();
  return remuxOf(probe, url, handlers);
}

// 用哪条音轨：语言标记和在学的语言一样的（普通话优先于粤语；解说轨、口述影像轨不要）；都没标就用默认音轨；再没有就第一条。
// tracks：读文件头读出的轨道（{id, type, lang, langRaw, name, isDefault, order}），也可带库读出的 commentary / visuallyImpaired 标记
const VOICE_OVER = /comment|descri|解说|解說|口述/i;
export function pickAudioTrack(tracks, learn) {
  const audio = (tracks || []).filter((t) => t?.type === 'audio' && !t.commentary && !t.visuallyImpaired && !VOICE_OVER.test(t.name || ''));
  if (!audio.length) return null;
  // 同一种语言里，方言轨（学中文时的粤语、闽南语……，lang.js audioDialectOf）排在正经那条后面
  // 换盒子放片那边给的 lang 可能是原样的三字母码（eng、cmn），先归一再比
  const rank = (t) => {
    const base = normalizeLang(t.langRaw ?? t.lang);
    const own = base === learn;
    return (own ? 4 : 0) + (own && audioDialectOf({ ...t, lang: base }) === learn ? 2 : 0) + (t.isDefault ? 1 : 0);
  };
  return [...audio].sort((a, b) => rank(b) - rank(a) || (a.order ?? 0) - (b.order ?? 0))[0];
}

// 没有画面、画面这台机器换了盒子也不收（MPEG-4 Part 2 这类）：换了也白换
const videoFits = (p) => !!p.vtrack && (!p.vc || SRC.isTypeSupported(`video/mp4; codecs="${p.vc}"`));
const nativeAudio = (ac) => !!ac && SRC.isTypeSupported(`audio/mp4; codecs="${ac}"`);
// 这条声音要交给外部解码：这台机器的播放器不认、外部解码认（电脑上的杜比 / DTS；iPhone 收 EAC3，也没有外部解码）
const viaShell = (p) => !!p.atrack && shellDecodes(p.acodec) && !nativeAudio(p.ac);
// 要不要换盒子放（先读编码的那两处）：声音要外部解码；或者要放的那条声音（在学的语言）不是浏览器直接放时会放的那条、而这台机器认它（audioOf swapped）
const wantRemux = (p) => viaShell(p) || (p.swapped && nativeAudio(p.ac));

// 轨道列表里标出换盒子实际在放的那条声音（playing）：音轨面板（TrackPanel）、信息条按它说，不再当默认那条在放。
// 轨号和读文件头读出的一样（calib.worker.js 也这么认）。没换盒子、换了但没带声音：原样
export function markPlaying(tracks, remux) {
  const id = remux?.audioOn ? remux.atrack?.id : null;
  if (!Array.isArray(tracks) || id == null) return tracks;
  return tracks.map((tk) => (tk?.type === 'audio' && tk.id === id ? { ...tk, playing: true } : tk));
}

function remuxOf(probe, url, handlers) {
  if (!videoFits(probe)) { probe.input.dispose(); return { url, remux: null }; }
  URL.revokeObjectURL(url);
  const remux = new RemuxSource(probe, handlers);
  return { url: remux.url, remux };
}

// 外部解码出来的声音编成什么装进 MP4：AAC，这台机器编不了就 Opus，都不行回 null
async function encodable(mb) {
  for (const c of ['aac', 'opus']) {
    if (await mb.canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false)) return c;
  }
  return null;
}

// 读出画面、声音轨和编码串、片长（只读文件头和索引，不读整个文件）。source(mb) 给 Mediabunny 的读法：本机文件 BlobSource。
// learn：在学的语言（trackLangOf 过的），放哪条声音按它挑（audioOf）；不给就是主声音轨
async function probeFile(source, learn = null) {
  const mb = await import('mediabunny');
  registerShellAudio(mb);
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: source(mb) });
  try {
    const vtrack = await input.getPrimaryVideoTrack();
    const { atrack, swapped } = await audioOf(input, learn);
    const duration = await input.computeDuration();
    const vc = vtrack ? await vtrack.getCodecParameterString().catch(() => null) : null;
    const ac = atrack ? await atrack.getCodecParameterString().catch(() => null) : null;
    return { mb, input, vtrack, atrack, swapped, duration, vc, ac, acodec: atrack?.codec || null };
  } catch (err) {
    input.dispose();
    throw err;
  }
}

// 放哪条声音：按在学的语言挑，规则和对时选轨同一个（calib/index.js pickAudioTrack：
// 标着在学语言的优先、不要解说轨和口述影像轨，都没标就默认那条）。没给语言、只有一条、挑不出：照旧主声音轨。
// swapped：挑的不是浏览器直接放时会放的那条（标了默认的，没标就第一条，和音轨面板 TrackPanel 同一个算法）——直接放就听不到它，要换盒子（wantRemux）
async function audioOf(input, learn) {
  const all = await input.getAudioTracks();
  const primary = () => input.getPrimaryAudioTrack();
  if (!learn || all.length < 2) return { atrack: await primary(), swapped: false };
  const infos = await Promise.all(all.map(async (track, order) => {
    const d = await track.getDisposition().catch(() => ({}));
    return {
      type: 'audio', track, order, langRaw: await track.getLanguageCode().catch(() => 'und'), name: await track.getName().catch(() => null),
      isDefault: !!d.default, commentary: !!d.commentary, visuallyImpaired: !!d.visuallyImpaired,
    };
  }));
  const pick = pickAudioTrack(infos, learn);
  if (!pick) return { atrack: await primary(), swapped: false };
  return { atrack: pick.track, swapped: pick !== (infos.find((x) => x.isDefault) || infos[0]) };
}

// 停掉一次转换。已经停了、转完了的不再停（库会在控制台警告「Conversion already canceled.」）
function cancelConv(conv) {
  if (conv && conv.state !== 'canceled' && conv.state !== 'done') conv.cancel().catch(() => {});
}

class RemuxSource {
  constructor(probe, handlers) {
    Object.assign(this, probe);
    this.handlers = handlers;
    // 这台机器认不认这条声音：不认（电脑 Chrome 遇到 EAC3）就一开始只放画面。认、但真喂进去又不收的，见 dropAudio。
    // 不认、外部解码得了（shell）：照样带着声音，转的时候声音交给外部解码、重新编码（shellOut）
    this.shell = viaShell(probe);
    this.audioOn = !!this.atrack && (this.shell || !this.ac || nativeAudio(this.ac));
    this.outCodec = null;  // 外部解码的声音编成什么（encodable，第一次转时问一次）
    this.acfg = null;      // 声音轨的解码配置：停转时按它关掉留下的解码进程
    this.audioTold = false;
    this.heard = false;    // 声音正常放出来过（带着声音往前放够 2 秒）：以后再出错先不怪声音（remuxPlan.js errorPlan）
    this.retried = false;  // 带着声音重接过一次
    this.played = 0;       // 这次接上（newSource）以后带着声音正常往前放了几秒
    this.lastT = null;
    this.seq = 0;          // 每开始转一次加一；旧的那次看到号码变了就停手
    this.conv = null;
    this.run = null;       // 正在跑的这次 { start, at, done }
    this.sb = null;
    this.video = null;
    this.dead = false;
    this.failed = false;
    this.packets = null;   // 找关键帧用（EncodedPacketSink）
    this.listeners = [
      ['seeking', () => this.check()],
      ['waiting', () => this.check()],
      ['timeupdate', () => this.onTime()],
      ['error', () => this.onVideoError()],
    ];
    this.newSource();
  }

  // 带着声音正常往前放（跳转、卡住、留白冻住都不算）：放够 2 秒就算这台机器解得了这条声音
  onTime() {
    const v = this.video;
    const t = v.currentTime;
    const d = this.lastT == null ? 0 : t - this.lastT;
    this.lastT = t;
    if (!this.audioOn || v.paused || v.seeking || !(d > 0 && d < 2)) return;
    this.played += d;
    if (this.played >= HEARD) this.heard = true;
  }

  // 建 MediaSource 和给 <video> 的地址；重新接（去掉声音重来、video 搬到画中画小窗里）时也走这里。
  // MediaSource 只能接在建它的那个页面里：用 video 眼下所在页面的那一套（还没拿到 video 就是本页）
  newSource() {
    const W = this.video?.ownerDocument?.defaultView || window;
    const Ctor = W.ManagedMediaSource || W.MediaSource || MMS || MS;
    const ms = new Ctor();
    this.win = W;
    this.mms = !!W.ManagedMediaSource && Ctor === W.ManagedMediaSource;
    this.ms = ms;
    this.sb = null;
    this.played = 0;
    this.lastT = null;
    this.url = W.URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', () => { if (ms === this.ms) this.onOpen(); });
    // 被摘下来了（video 换了地址、搬家重新加载）：停转，sourceBuffer 跟着没了；再接上会再来一次 sourceopen
    ms.addEventListener('sourceclose', () => { if (ms === this.ms) { this.stop(); this.sb = null; } });
  }

  revoke() {
    try { this.win.URL.revokeObjectURL(this.url); } catch { /* 小窗已经关了 */ }
  }

  // Player 把地址交给 <video> 以后调（同一轮里，sourceopen 是异步来的）
  attach(video) {
    if (this.dead || video === this.video) return;
    if (this.video) this.unlisten();
    this.video = video;
    for (const [ev, fn] of this.listeners) video.addEventListener(ev, fn);
  }

  unlisten() {
    for (const [ev, fn] of this.listeners) this.video.removeEventListener(ev, fn);
  }

  // Player 把 video 搬到了别的页面里（进出画中画小窗）：浏览器会重新加载它，可 MediaSource 只能接在建它的那个页面里——
  // 在 video 现在的页面里另建一个接上（位置、播放状态 Player 搬家时自己记了、自己恢复）。小窗先关、video 后搬回来时，
  // 浏览器连 error 都不发，所以不能等报错再接
  moved() {
    if (this.dead || this.failed || !this.video) return;
    const W = this.video.ownerDocument?.defaultView;
    if (W && W !== this.win) this.reattach(false);
  }

  // 关片、换片：停转、解绑。不动 <video> 的地址：关片后进度保存（useProgressSaver 收尾）还要读播放头和片长，
  // 摘掉会把它们清零。换片时下一部片换地址，浏览器自己把这个 MediaSource 摘掉；关片时等存完由 Player 卸载调 release 摘
  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.stop();
    if (this.video) this.unlisten();
    this.revoke();
    try { this.input.dispose(); } catch { /* 已经关了 */ }
  }

  // 关片以后（Player 卸载、进度最后一次存完）：把 <video> 上的地址摘掉，MediaSource 跟着关、攒着的缓冲（前 60 秒、后 30～40 秒）才放得掉。
  // 不摘的话 App 的 videoRef 还指着这个 video，缓冲一直占着内存到开下一部片（iPhone 上几十 MB）。还在用的（没 destroy）、已经换了地址的不动
  release() {
    const v = this.video;
    if (!this.dead || !v || v.src !== this.url) return;
    v.removeAttribute('src');
    v.load();
  }

  stop() {
    this.seq++;
    this.run = null;
    cancelConv(this.conv);
    this.conv = null;
    if (this.acfg) dropShellAudio(this.acfg);   // 停掉的这次转换留下的解码进程（shellAudio.js）
  }

  onOpen() {
    if (this.dead || this.sb) return; // 转完 endOfStream 以后再喂会再来一次 sourceopen：不是新接上，不管
    if (this.duration > 0 && !(this.ms.duration > 0)) this.ms.duration = this.duration;
    this.restart(this.video?.currentTime || 0);
  }

  // 跳转、卡住：要不要从前一个关键帧重新转（remuxPlan.js needRestart）
  check() {
    if (this.dead || this.failed || !this.video || this.ms.readyState === 'closed') return;
    const t = this.video.currentTime;
    if (!needRestart({ t, ranges: this.ranges(), run: this.run })) return;
    this.restart(t);
  }

  // 从 t 前面的关键帧开始转（t ≤ 0.5 就从头）
  async restart(t) {
    this.stop();
    const my = this.seq;
    this.run = { start: t, at: t, done: false };
    let start = 0;
    try {
      if (t > 0.5) {
        this.packets ||= new this.mb.EncodedPacketSink(this.vtrack);
        const key = await this.packets.getKeyPacket(t);
        start = key ? key.timestamp : 0;
      }
      if (my !== this.seq) return;
      this.run = { start, at: start, done: false };
      await this.runFrom(start, my);
    } catch (err) {
      if (my !== this.seq || this.dead || isCancel(err)) return;
      this.onError(err, !!err?.refused);
    }
  }

  async runFrom(start, my) {
    const { mb } = this;
    // error：这次喂的时候出的错。写的那一步不往外抛（抛了库里的流就「出错、关不上」，库自己停转换时冒出没人接的报错），
    // 记下来、停掉转换，等 execute 停下来再按这个错处理
    const st = { first: true, done: false, moov: false, error: null, conv: null };
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
      target: new mb.StreamTarget(new WritableStream({
        write: async (chunk) => {
          try { await this.onChunk(chunk, my, start, st, output); } catch (err) {
            if (my !== this.seq || st.error) return;
            st.error = err;
            cancelConv(st.conv);
          }
        },
      })),
    });
    const audioCodec = this.shell && this.audioOn ? await this.shellOut(output) : null;
    if (my !== this.seq) return;
    const conv = await mb.Conversion.init(convOptions({
      input: this.input, output, start, vtrack: this.vtrack, atrack: this.atrack, audioOn: this.audioOn, audioCodec,
    }));
    st.conv = conv;
    if (my !== this.seq) { cancelConv(conv); return; }
    if (!conv.isValid || !conv.utilizedTracks.includes(this.vtrack)) { cancelConv(conv); throw new Error('video track cannot be converted'); }
    if (this.audioOn && !conv.utilizedTracks.includes(this.atrack)) this.audioOn = false; // 声音搬不进 MP4：只放画面
    this.conv = conv;
    conv.onProgress = (_p, ts) => { if (my === this.seq && this.run) this.run.at = start + ts; };
    try { await conv.execute(); } catch (err) { throw st.error || err; }
    if (st.error) throw st.error;
    if (my !== this.seq) return;
    this.run.done = true;
    await this.idle();
    if (my === this.seq && this.ms.readyState === 'open' && this.sb && !this.sb.updating) this.ms.endOfStream();
  }

  // 外部解码的声音编成什么（remuxPlan.js convOptions 的 audioCodec）。编不了、或者 MP4 装不下这种画面（复制模式 'preferred' 会落到重新压缩画面）：只放画面
  async shellOut(output) {
    if (!output.format.getSupportedVideoCodecs().includes(this.vtrack.codec)) { this.audioOn = false; return null; }
    this.outCodec ||= encodable(this.mb);
    this.acfg ||= await this.atrack.getDecoderConfig();
    const c = await this.outCodec;
    if (!c) this.audioOn = false;
    return c;
  }

  async onChunk(chunk, my, start, st, output) {
    if (my !== this.seq || st.done || st.error || this.dead) return;
    // 文件尾巴上的索引（mfra）播放器不要：常和最后一个分片在同一块里（实验版只认单独一块的，短片会把它也喂进去）
    const { data: d, end } = cutIndex(chunk.data);
    if (end) st.done = true;
    if (!d.length) return;
    const type = boxType(d);
    if (!st.moov && (type === 'ftyp' || type === 'moov')) { if (dropEditLists(d) || type === 'moov') st.moov = true; }
    if (st.first) {
      st.first = false;
      await this.prepare(output, start);
    } else if (!(await this.waitRoom(my))) return;
    if (my !== this.seq) return;
    await this.append(d, my);
  }

  // 这次转换的第一块：第一次建 SourceBuffer；以后先把上一次喂了一半的作废（abort），再把时间对回关键帧
  async prepare(output, start) {
    if (!this.sb) {
      const mime = await output.getMimeType();
      // 明说不收（refused）的多半是声音（画面的编码 chooseSource 问过了）：出错时直接去掉声音，不重接
      if (!SRC.isTypeSupported(mime)) throw Object.assign(new Error(`this device does not accept ${mime}`), { refused: true });
      try { this.sb = this.ms.addSourceBuffer(mime); } catch (err) {
        if (err?.name === 'NotSupportedError') err.refused = true;
        throw err;
      }
      if (this.mms) this.sb.addEventListener('bufferedchange', () => {}); // 实验版照样挂着（系统收走缓冲时发）
      if (!this.audioOn && this.atrack && !this.audioTold) { this.audioTold = true; this.handlers.onAudioDropped?.(); }
    } else {
      await this.idle();
      if (this.ms.readyState === 'open') this.sb.abort();
    }
    this.sb.timestampOffset = start;
  }

  async idle() {
    while (this.sb?.updating) await updateEnd(this.sb).catch(() => {});
  }

  // 前面攒够了就等一等（remuxPlan.js feedNow）。被叫停（跳到别处、关片）回 false
  async waitRoom(my) {
    for (;;) {
      if (my !== this.seq) return false;
      const ahead = (this.run?.at ?? 0) - (this.video?.currentTime ?? 0);
      if (feedNow({ ahead, mms: this.mms, streaming: this.ms.streaming })) return true;
      await sleep(250);
    }
  }

  // 已经喂进去的几段（SourceBuffer 被摘掉以后读 buffered 会抛错，当成空的）
  ranges() {
    try { return toRanges(this.sb?.buffered); } catch { return []; }
  }

  async removeRange(from, to) {
    const end = Math.min(to, Number.isFinite(this.ms.duration) ? this.ms.duration : to);
    if (!(end > from)) return;
    await this.idle();
    if (!this.sb || this.ms.readyState === 'closed') return;
    this.sb.remove(from, end);
    await updateEnd(this.sb).catch(() => {});
  }

  async append(data, my) {
    for (;;) {
      if (my !== this.seq || !this.sb) return;
      await this.idle();
      if (my !== this.seq || !this.sb) return;
      const t = this.video?.currentTime ?? 0;
      const cut = trimPlan(this.ranges(), t);
      if (cut != null) { await this.removeRange(0, cut); if (my !== this.seq || !this.sb) return; }
      try {
        this.sb.appendBuffer(data);
        await updateEnd(this.sb);
        return;
      } catch (err) {
        if (my !== this.seq || this.dead || this.ms.readyState === 'closed') return;
        if (err.name !== 'QuotaExceededError') throw err;
        // 装不下了：删播放头 30 秒以前的、和播放头不连着的几段；都没有就等播放头往前走
        const r = quotaPlan(this.ranges(), t);
        if (r) await this.removeRange(r[0], r[1]); else await sleep(500);
      }
    }
  }

  // 另起一个 MediaSource 重新接到 <video> 上。restore：接好以后回到原来的位置、原来的速度，原来在播就接着播
  // （去掉声音重来、带着声音重接时要；video 搬家重新加载的，Player 搬家时自己记了位置、速度，自己恢复）。
  // 换地址时浏览器把速度重置成 defaultPlaybackRate（1），控制条上还写着她的速度：要写回去。循环留白里冻住的 0 不照搬（同 Player 搬家），
  // 留白结束 SentencePlayer 自己恢复她的速度
  reattach(restore) {
    const v = this.video;
    const t = v?.currentTime || 0;
    const playing = !!v && !v.paused;
    const rate = v?.playbackRate || 0;
    this.stop();
    this.revoke();
    this.newSource();
    if (!v) return;
    if (restore) {
      v.addEventListener('loadedmetadata', () => {
        if (this.dead || v.src !== this.url) return;
        if (rate > 0 && v.playbackRate !== rate) v.playbackRate = rate;
        if (t > 0.5) internalSeek(v, t);
        if (playing) v.play().catch(() => {});
      }, { once: true });
    }
    v.src = this.url;
  }

  // 出错了：按 remuxPlan.js errorPlan 去掉声音、带着声音原地重接一次、或者算放不了。refused：浏览器明说不收这种格式
  onError(err, refused = false) {
    if (this.dead || this.failed) return;
    const plan = errorPlan({ audioOn: this.audioOn, refused, heard: this.heard, retried: this.retried, played: this.played });
    if (plan === 'retry') { this.retried = true; this.reattach(true); }
    else if (plan === 'dropAudio') this.dropAudio();
    else this.fail(err);
  }

  // 带声音喂不进去（这台机器的播放器不收这条声音）：去掉声音、只放画面再来一次（实验版）。
  // 还没建 SourceBuffer 就在原地重转；建了（声音已经写进它的格式里）或者 <video> 已经报错：另起一个 MediaSource，接回原来的位置
  dropAudio() {
    if (this.dead) return;
    this.audioOn = false;
    if (!this.sb && !this.video?.error && this.ms.readyState === 'open') { this.restart(this.video?.currentTime || 0); return; }
    this.reattach(true);
  }

  // <video> 报错。换地址时浏览器会把排着队的旧 error 丢掉、error 清空，所以只认现在这个地址上、真有 error 的：
  // - video 搬到了别的页面（画中画小窗）里、重新加载接不上（MediaSource 只能接在建它的页面里）：在它现在的页面里另建一个接上；
  // - 别的按 onError：声音还没正常放出来过就去掉声音，放得好好的先带着声音重接一次，没声音了还错算放不了
  onVideoError() {
    const v = this.video;
    if (this.dead || this.failed || !v?.error || v.src !== this.url) return;
    const W = v.ownerDocument?.defaultView;
    if (!W) return; // 小窗已经关了、video 还没搬回来：搬回来重新加载时再接
    if (W !== this.win) { this.reattach(false); return; }
    this.onError(new Error(v.error.message || 'player error'));
  }

  fail(err) {
    if (this.dead || this.failed) return;
    this.failed = true;
    this.stop();
    this.handlers.onFail?.(String(err?.message || err));
  }
}
