// 杜比 / DTS 声音交给外部解码（浏览器里没有对应能力时不起作用）。
// 浏览器的 WebCodecs 解不了 AC3 / E-AC3 / DTS（Chromium 不带），片子里只有这种声音就没声音。外部解码器只会解这三种：
// 这里给 Mediabunny 注册一个自定义声音解码器（CustomAudioDecoder），换盒子（remuxSource.js）转换时库把拆出来的声音包交给它，
// 它经外部通道送进 ffmpeg，拿回 48kHz 双声道 f32 交错 PCM 做成 AudioSample 还给库，库再编成 AAC（编不了就 Opus）装进 MP4。画面照旧原样搬、不重新压缩。
// 一个解码器对应一个 ffmpeg 进程：时间接不上（库跳到别处接着要）就先把这一段收完（flush），下一包另开一个。
// 60 秒没人理的进程会被杀（暂停太久）：再送时重开一个，把还没出声的那几包补送一遍，声音不断。
const SHELL_CODECS = ['ac3', 'eac3', 'dts'];
const RATE = 48000;
const FRAME = 8;       // 双声道 × 4 字节
const LAG = 1;         // 送进去的比拿回来的多出 1 秒以上就等一等（ffmpeg 正常只差两帧）
const WAIT_MS = 200;
const STALL = 25;      // 等了 25 次（约 5 秒）还一点没出来：算解不了
const GAP = 0.1;       // 新来的包和上一包的结尾差 0.1 秒以上：库跳到了别处

const shellAudio = () => (typeof window !== 'undefined' ? window.earuShell?.audio || null : null);
const live = new Set();   // 开着 ffmpeg 进程 的解码器

// 换盒子停掉一次转换（跳转、关片）时调：库停转时解码泵常卡在等队列腾位、走不到 close（Mediabunny 1.61），ffmpeg 进程要空等 60 秒才被收。
// 按这条声音轨的解码配置（同一条轨库每次给的是同一个对象）把留下的都关掉；之后这些解码器再被调只报错、不重开
export function dropShellAudio(config) {
  for (const d of live) if (d.config === config) d.drop();
}

// 能解的声音编码（没有外部解码能力、版本太旧、没带 ffmpeg：空的）
export function shellCodecs() {
  const a = shellAudio();
  return Array.isArray(a?.codecs) ? a.codecs.filter((c) => SHELL_CODECS.includes(c)) : [];
}
export const shellDecodes = (codec) => !!codec && shellCodecs().includes(codec);

// 内部错误，不给人看（转换出错经 remuxSource onFail 交给 App，App 只认「画面放不了」）：说明一律写英文，代码里不留中文
class ShellError extends Error {}
function check(r) {
  if (r && r.pcm) return r.pcm;
  throw new ShellError(`shell audio decode failed (${r?.error || 'no reply'})`);
}

let registered = false;
export function registerShellAudio(mb) {
  if (registered || !shellCodecs().length) return;
  registered = true;
  mb.registerDecoder(class extends mb.CustomAudioDecoder {
    static supports(codec) { return shellDecodes(codec); }

    init() {
      this.id = null;
      this.base = 0;     // 这个 ffmpeg 收到的第一包的时间：拿回来的声音从这里接着往后排
      this.out = 0;      // 这个 ffmpeg 已经拿回来的帧数
      this.next = 0;     // 送进去的最后一包的结尾
      this.sent = [];    // 送进去还没完全出声的包（ffmpeg 被杀掉时补送）
      this.skip = 0;     // 补送时重出来的、前面已经拿到过的帧数：扔掉
      this.dropped = false;   // 转换停了（dropShellAudio）：不再开进程
    }

    edge() { return this.base + this.out / RATE; }

    async open(t) {
      const r = await shellAudio().open(this.codec);
      if (!r?.id) throw new ShellError(`shell audio open failed (${r?.error || 'no reply'})`);
      if (this.dropped) { shellAudio().close(r.id); throw new ShellError('conversion stopped'); }
      live.add(this);
      this.id = r.id;
      this.base = t;
      this.out = 0;
      this.skip = 0;
    }

    emit(pcm) {
      if (this.dropped) return;
      let n = Math.floor(pcm.byteLength / FRAME);
      const drop = Math.min(this.skip, n);
      if (drop) { this.skip -= drop; this.out += drop; n -= drop; }
      if (!n) return;
      const data = new Float32Array(n * 2);
      new Uint8Array(data.buffer).set(new Uint8Array(pcm.buffer, pcm.byteOffset + drop * FRAME, n * FRAME));
      this.onSample(new mb.AudioSample({ data, format: 'f32', numberOfChannels: 2, sampleRate: RATE, timestamp: this.edge() }));
      this.out += n;
      const done = this.edge() - 0.001;
      while (this.sent.length && this.sent[0].t + this.sent[0].d <= done) this.sent.shift();
    }

    // 调外部解码；进程没了（60 秒没人理被杀）就重开一个、把没出声的包补送进去再来一次
    async call(fn) {
      const r = await fn();
      if (r?.error !== 'audio-gone') return check(r);
      if (this.dropped) throw new ShellError('conversion stopped');
      const keep = this.sent.slice();   // 补送时 emit 会修剪 this.sent，这里另拷一份按原样送
      const had = this.edge();
      await this.open(keep.length ? keep[0].t : this.next);
      if (had > this.base) this.skip = Math.round((had - this.base) * RATE);
      for (const p of keep) this.emit(check(await shellAudio().decode(this.id, p.data, 0)));
      return check(await fn());
    }

    async decode(packet) {
      if (this.dropped) throw new ShellError('conversion stopped');
      const t = packet.timestamp;
      if (this.id && Math.abs(t - this.next) > GAP) await this.flush();
      if (!this.id) await this.open(t);
      const data = packet.data.slice();   // 只送这一包：子数组经 IPC 会把整块底层缓冲一起拷过去
      this.sent.push({ t, d: packet.duration, data });
      this.next = t + packet.duration;
      this.emit(await this.call(() => shellAudio().decode(this.id, data, 0)));
      for (let i = 0; this.next - this.edge() > LAG; i++) {
        if (i >= STALL) throw new ShellError('shell audio decoder stalled');
        this.emit(await this.call(() => shellAudio().decode(this.id, null, WAIT_MS)));
      }
    }

    // 收尾：关掉输入，把剩下的都拿回来，这个 ffmpeg 就没了
    async flush() {
      if (!this.id) return;
      const pcm = await this.call(() => shellAudio().flush(this.id));
      this.id = null;
      live.delete(this);
      this.emit(pcm);
      this.sent = [];
    }

    close() {
      live.delete(this);
      if (this.id) shellAudio()?.close(this.id);
      this.id = null;
      this.sent = [];
    }

    drop() {
      this.dropped = true;
      this.close();
    }
  });
}
