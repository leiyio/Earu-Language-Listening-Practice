// 换盒子边转边播里不碰浏览器的那一半：要不要换盒子、喂不喂、删哪段缓冲、拖到哪要不要重转、
// 抹剪辑表、出错了怪不怪声音。都是纯函数，Node 里能测；浏览器那一半在 remuxSource.js。

// 电脑上测试用：localStorage 里写了 '1'，浏览器能直接放的 MKV 也走换盒子
export const FORCE_KEY = 'earu.forceRemux';

export const AHEAD = 60;      // 转换跑在播放头前面 60 秒就歇一歇
export const LOW = 15;        // 不到 15 秒不管系统说什么都接着喂（实验版 waitRoom）
export const BEHIND = 30;     // 播放头后面留 30 秒：循环要跳回句首，当前句前面的不能删
export const TRIM_SLACK = 10; // 后面攒到 30 + 10 秒才删一次，不每喂一块就删一回

// 文件头是不是 EBML（Matroska / WebM 的开头 1A 45 DF A3）
export function isEbml(head) {
  return !!head && head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
}

// 要不要换盒子。返回：
//   'direct' 浏览器自己放
//   'try'    先拿一个不挂在页面上的 <video> 真试一下这个文件（remuxSource.js tryDirect），试的结果当 plays 再传进来定
//   'remux'  换盒子边转边播
// 不问 canPlayType：它靠不住——Chromium 144（Edge 144）对 video/x-matroska、连带编码串的问法都回 ''，可直接放得了，
// 照它走电脑上也换了盒子（实测）；iPhone 回什么没人量过，回「maybe」的话照它走就直接放、放不了。
// 真试一下电脑上一眨眼就有结果（Chrome、Edge 读本地 MKV 出第一帧：页面里第一次 160～200 毫秒，以后 20～40 毫秒），比猜可靠。
// plays：true 试放读出了第一帧画面；false 报错、到点还没读出来（iPhone 不认 MKV 盒子）
export function remuxVerdict({ ebml, force = false, hasMSE, plays }) {
  if (!ebml || !hasMSE) return 'direct'; // MP4 浏览器都认；连 MediaSource 都没有的换了也放不了
  if (force) return 'remux';
  if (plays === undefined) return 'try';
  return plays ? 'direct' : 'remux';
}

// MP4 一块的头一个盒子是什么（'ftyp' 'moov' 'moof' 'mfra'…）
export function boxType(d) {
  return d && d.length >= 8 ? String.fromCharCode(d[4], d[5], d[6], d[7]) : '';
}

// 一块里的顶层盒子 [{ type, off, size }]。库每写完一个分片整块交出来，块都从盒子边上开始（第一块 ftyp；第二块 moov + 第一个分片；
// 以后 moof + mdat；最后一块分片后面可能还跟着 mfra——片子短的时候整个就一块）。盒子长度不对就停（不认识的不碰）
export function topBoxes(d) {
  const out = [];
  if (!d) return out;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let off = 0;
  while (off + 8 <= d.length) {
    let size = dv.getUint32(off);
    if (size === 1 && off + 16 <= d.length) size = Number(dv.getBigUint64(off + 8)); // 64 位长度
    else if (size === 0) size = d.length - off;                                       // 一直到结尾
    if (size < 8 || off + size > d.length) break;
    out.push({ type: String.fromCharCode(d[off + 4], d[off + 5], d[off + 6], d[off + 7]), off, size });
    off += size;
  }
  return out;
}

// 文件尾巴上的索引（mfra，随机访问用）播放器不要：截掉它和后面的，end = true（这次转换写完了）。没有就原样回
export function cutIndex(d) {
  const m = topBoxes(d).find((b) => b.type === 'mfra');
  return m ? { data: d.subarray(0, m.off), end: true } : { data: d, end: false };
}

// 头信息（moov）里的剪辑表（edts / elst）改名成 free（播放器跳过的空盒子），返回改了几张。从中间某个关键帧重新转时，库会给声音轨写一张
// 「开头 36 毫秒不要、长度 0」的剪辑表：电脑 Chrome 不理它，iPhone 照着办、把整条声音当成不要了——跳到中间就没声音（实测）。
// 抹掉以后声音最多早出来几十毫秒，听不出来。原地改字节，盒子大小不变；一块里有几个顶层盒子（ftyp + moov）也照走
export function dropEditLists(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let n = 0;
  const walk = (off, end) => {
    while (off + 8 <= end) {
      const size = dv.getUint32(off);
      if (size < 8 || off + size > end) return; // 半截盒子、64 位长度：不认识的不动
      const t = String.fromCharCode(d[off + 4], d[off + 5], d[off + 6], d[off + 7]);
      if (t === 'edts') { d[off + 4] = 0x66; d[off + 5] = 0x72; d[off + 6] = 0x65; d[off + 7] = 0x65; n++; }
      else if (t === 'moov' || t === 'trak') walk(off + 8, off + size);
      off += size;
    }
  };
  walk(0, d.length);
  return n;
}

// 浏览器的 TimeRanges 换成 [[起, 止], …]（没有就是空数组）
export function toRanges(tr) {
  const out = [];
  if (!tr) return out;
  for (let i = 0; i < tr.length; i++) out.push([tr.start(i), tr.end(i)]);
  return out;
}

// t 在已经喂进去的那几段里（开头差 0.3 秒也算，离结尾不到 0.5 秒不算：马上就要卡住了；实验版 inBuffered）
export function inRanges(ranges, t) {
  return ranges.some(([s, e]) => s - 0.3 <= t && t < e - 0.5);
}

// 播放头前面连着有几秒（实验版 aheadOf）
export function aheadOf(ranges, t) {
  for (const [s, e] of ranges) if (s - 0.3 <= t && t <= e) return e - t;
  return 0;
}

// 现在喂不喂下一块：ahead = 转换转到哪儿 - 播放头。普通 MediaSource 攒到 60 秒歇；iPhone 的 ManagedMediaSource 由系统说了算
// （streaming 为 false 就是叫停），不过不到 15 秒照样喂（实验版 waitRoom）
export function feedNow({ ahead, mms = false, streaming }) {
  if (ahead < LOW) return true;
  return ahead < AHEAD && (!mms || streaming !== false);
}

// 喂之前顺手删掉播放头 30 秒以前的：返回删到哪（从 0 删到这儿），不用删回 null。后面攒到 40 秒才删，删完留 30 秒
export function trimPlan(ranges, t, { behind = BEHIND, slack = TRIM_SLACK } = {}) {
  if (!ranges.length) return null;
  const cut = t - behind;
  return ranges[0][0] < cut - slack ? cut : null;
}

// 装不下了（QuotaExceededError）：先删播放头 30 秒以前的；没有就删后面另外几段（以前跳来跳去转的、和播放头不连着）；
// 再没有就只留 10 秒；还没有回 null（等播放头往前走）。返回 [起, 止]，止可以是 Infinity（调用的夹到片长）
export function quotaPlan(ranges, t, { behind = BEHIND } = {}) {
  if (!ranges.length) return null;
  if (ranges[0][0] < t - behind - 0.5) return [0, t - behind];
  const cur = ranges.find(([s, e]) => s - 0.3 <= t && t <= e);
  const later = ranges.find(([s]) => s > (cur ? cur[1] : t) + 0.1);
  if (later) return [later[0], Infinity];
  if (ranges[0][0] < t - 10.5) return [0, t - 10];
  return null;
}

// 跳到 t（拖进度条、续播、循环跳回句首），或者播着播着卡住了：要不要从 t 前面的关键帧重新转。
// run：正在跑的这次转换 { start 从哪转起, at 转到哪了, done 转完了没 }（没有就 null）。
// 已经喂进去了的不用；这次转换从 t 前面开始、正好转到 t 附近（8 秒内就到）的也不用，等它喂到（刚开始转、续播紧跟着的那次跳转）；
// 转换早过了 t、t 却不在缓冲里（被删了、被系统收走了）要重转
export function needRestart({ t, ranges, run }) {
  if (inRanges(ranges, t)) return false;
  if (run && !run.done && run.start <= t + 0.05 && t >= run.at - 1 && t - run.at < 8) return false;
  return true;
}

// 一次转换的设置（Mediabunny Conversion.init）：从 start 秒（关键帧）转到片尾；只要那一条画面、那一条声音（声音不要时也丢掉），
// 字幕不进来（自己在 Worker 里读）；只搬不转码——搬不了的轨宁可丢掉，也不在手机上重新压缩。
// 例外 audioCodec：声音交给外部解码（shellAudio.js，杜比 / DTS），解出来重新编成 audioCodec（aac / opus）、双声道 48kHz。
// 这时复制模式只能是 'preferred'（'forced' 会把要转码的声音丢掉）；画面照旧原样搬——调用前确认过 MP4 装得下这种画面编码，不会落到重新压缩
export function convOptions({ input, output, start, vtrack, atrack, audioOn, audioCodec = null }) {
  const sound = audioCodec ? { forceTranscode: true, codec: audioCodec, numberOfChannels: 2, sampleRate: 48000 } : {};
  return {
    input, output, trim: { start },
    video: (tr) => (tr === vtrack ? {} : { discard: true }),
    audio: (tr) => (audioOn && tr === atrack ? sound : { discard: true }),
    copy: { mode: audioCodec ? 'preferred' : 'forced' },
    showWarnings: false,
  };
}

// 停掉一次转换（跳到别处、换片）时冒出来的错：不是真出错。库报的信息是「Conversion has been canceled.」
export const isCancel = (err) => /cancel/i.test(String(err?.message || err));

export const HEARD = 2; // 带着声音正常往前放够 2 秒：这台机器解得了这条声音
export const CALM = 60; // 重接以后又放了 60 秒才出错：和上一次不是一回事，可以再重接

// 边转边播出错了（<video> 报错、喂数据出错、转换出错）怎么办。返回：
//   'dropAudio' 去掉声音、只放画面再来：浏览器明说不收这种格式（refused），或者声音还没正常放出来过（heard 为假）——多半是解不了这条声音；
//   'retry'     带着声音另起一个 MediaSource、回原处重接一次：声音放得好好的突然出错，多半是一块数据坏了、读文件出了岔子，不怪声音；
//   'fail'      放不了（已经没声音了还出错；界面按「画面放不了」提示）。
// 重接过（retried）、重接以后不到 60 秒（played）又错：同一个地方接着坏，不再重接，去掉声音试试
export function errorPlan({ audioOn, refused = false, heard = false, retried = false, played = 0 }) {
  if (!audioOn) return 'fail';
  if (refused || !heard) return 'dropAudio';
  if (retried && played < CALM) return 'dropAudio';
  return 'retry';
}
