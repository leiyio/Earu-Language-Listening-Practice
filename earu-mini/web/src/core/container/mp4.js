// MP4 最小读取器：解析 moov 拿轨道信息；字幕样本按 stbl 样本表直接定位读取，不用扫整个文件。

import { BlobReader, ascii, pool } from './reader.js';
import { mp4Codec, audioInfo, videoInfo, subInfo } from './codecs.js';
import { normalizeLang } from '../lang.js';

const MAX_MOOV = 256 * 1024 * 1024;
const SUB_HANDLERS = new Set(['sbtl', 'text', 'subt', 'clcp']);

class Cur {
  constructor(b, o = 0, end = b.length) {
    this.b = b; this.o = o; this.end = end;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.dv.getUint16(this.o); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o); this.o += 4; return v; }
  i32() { const v = this.dv.getInt32(this.o); this.o += 4; return v; }
  u64() { const hi = this.u32(); return hi * 4294967296 + this.u32(); }
  i64() { const hi = this.i32(); return hi * 4294967296 + this.u32(); }
  str(n) { const s = ascii(this.b.subarray(this.o, this.o + n)); this.o += n; return s; }
  skip(n) { this.o += n; }
}

// 遍历内存中的 box
function* boxes(b, start = 0, end = b.length) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = ascii(b.subarray(o + 4, o + 8));
    let hdr = 8;
    if (size === 1) { size = dv.getUint32(o + 8) * 4294967296 + dv.getUint32(o + 12); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) return;
    yield { type, start: o, data: o + hdr, end: o + size };
    o += size;
  }
}
const find = (b, box, type) => { for (const x of boxes(b, box.data, box.end)) if (x.type === type) return x; return null; };
const path = (b, box, ...types) => types.reduce((cur, t) => cur && find(b, cur, t), box);

function parseTrak(b, trak, movieTs, order) {
  const tkhd = find(b, trak, 'tkhd');
  const mdia = find(b, trak, 'mdia');
  const mdhd = mdia && find(b, mdia, 'mdhd');
  const hdlr = mdia && find(b, mdia, 'hdlr');
  const stbl = mdia && path(b, mdia, 'minf', 'stbl');
  if (!tkhd || !mdhd || !hdlr || !stbl) return null;

  let c = new Cur(b, tkhd.data);
  const tkVer = c.u8(); const tkFlags = (c.u8() << 16) | c.u16();
  c.skip(tkVer === 1 ? 16 : 8);
  const id = c.u32();

  c = new Cur(b, mdhd.data);
  const mdVer = c.u8(); c.skip(3);
  c.skip(mdVer === 1 ? 16 : 8);
  const timescale = c.u32();
  const duration = mdVer === 1 ? c.u64() : c.u32();
  const lp = c.u16();
  let langRaw = (lp & 0x7fff) === 0x7fff || lp === 0 ? 'und'
    : String.fromCharCode(((lp >> 10) & 31) + 0x60, ((lp >> 5) & 31) + 0x60, (lp & 31) + 0x60);
  // 老 QuickTime 的 Mac 语言码（小于 0x400）按 ISO 拆出来是乱码（如 '`ab'）：不是三个小写字母的当没标
  if (!/^[a-z]{3}$/.test(langRaw)) langRaw = 'und';
  const elng = find(b, mdia, 'elng');
  if (elng) langRaw = ascii(b.subarray(elng.data + 4, elng.end)).replace(/\0+$/, '') || langRaw;

  c = new Cur(b, hdlr.data);
  c.skip(8);
  const handler = c.str(4);
  c.skip(12);
  let name = new TextDecoder().decode(b.subarray(c.o, hdlr.end)).replace(/\0+$/, '').replace(/^[\x00-\x1f]/, '').trim();
  if (/^(SoundHandler|VideoHandler|SubtitleHandler|TextHandler|Core Media.*|.*Handler)$/i.test(name)) name = '';
  const udtaName = path(b, trak, 'udta', 'name');
  if (udtaName) name = new TextDecoder().decode(b.subarray(udtaName.data, udtaName.end)).replace(/\0+$/, '').trim() || name;

  const type = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : SUB_HANDLERS.has(handler) ? 'subtitle' : null;
  if (!type) return null;

  // 样本描述：取第一条
  const stsd = find(b, stbl, 'stsd');
  let fourcc = '', oti = 0, width, height, channels, sampleRate;
  if (stsd) {
    const entry = boxes(b, stsd.data + 8, stsd.end).next().value;
    if (entry) {
      fourcc = entry.type;
      c = new Cur(b, entry.data);
      if (type === 'video') { c.skip(24); width = c.u16(); height = c.u16(); }
      if (type === 'audio') {
        c.skip(8); const ver = c.u16(); c.skip(6); channels = c.u16(); c.skip(6); sampleRate = c.u32() / 65536;
        if (fourcc === 'mp4a') {
          const childStart = entry.data + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
          for (const ch of boxes(b, childStart, entry.end)) {
            if (ch.type !== 'esds') continue;
            // 在 ES 描述符里找 DecoderConfigDescriptor(tag 4) 的 objectTypeIndication
            for (let i = ch.data + 4; i < ch.end - 1; i++) if (b[i] === 0x04) {
              let j = i + 1; while (b[j] & 0x80) j++; oti = b[j + 1]; break;
            }
          }
        }
      }
    }
  }
  const codec = mp4Codec(fourcc);
  const realCodec = fourcc === 'mp4a' ? mp4Codec('mp4a', oti) : codec;
  const ci = type === 'audio' ? audioInfo(realCodec, fourcc) : type === 'video' ? videoInfo(realCodec, fourcc) : subInfo(codec, fourcc);

  // 编辑表：只处理常见的「开头空一段 + 从 media_time 开始」
  let offset = 0;
  const elst = path(b, trak, 'edts', 'elst');
  if (elst) {
    c = new Cur(b, elst.data);
    const ver = c.u8(); c.skip(3);
    const n = c.u32();
    let empty = 0;
    for (let i = 0; i < n; i++) {
      const segDur = ver === 1 ? c.u64() : c.u32();
      const mediaTime = ver === 1 ? c.i64() : c.i32();
      c.skip(4);
      if (mediaTime === -1) { empty += segDur; continue; }
      offset = empty / movieTs - mediaTime / timescale;
      break;
    }
  }

  return {
    id, order, type, ...ci, langRaw, lang: normalizeLang(langRaw), name,
    isDefault: !!(tkFlags & 1), isForced: false, isHearingImpaired: false,
    width, height, channels, sampleRate,
    duration: timescale ? duration / timescale : null,
    _stbl: type === 'subtitle' ? { b, stbl, timescale, offset } : null,
  };
}

export async function probeMp4(blob) {
  const r = new BlobReader(blob, 64 * 1024);
  let pos = 0, moov = null, fragmented = false;
  while (pos + 8 <= blob.size) {
    await r.ensure(pos, 16);
    const h = r.view(pos, 16);
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = dv.getUint32(0);
    const type = ascii(h.subarray(4, 8));
    if (size === 1) size = dv.getUint32(8) * 4294967296 + dv.getUint32(12);
    else if (size === 0) size = blob.size - pos;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > MAX_MOOV) throw new Error('moov too large');
      moov = await r.read(pos, size);
    } else if (type === 'moof') fragmented = true;
    pos += size;
    if (moov && fragmented) break;
  }
  if (!moov) throw new Error('no moov');
  const root = { data: 8, end: moov.length };
  const mvhd = find(moov, root, 'mvhd');
  let movieTs = 1000, movieDur = null;
  if (mvhd) {
    const c = new Cur(moov, mvhd.data);
    const ver = c.u8(); c.skip(3); c.skip(ver === 1 ? 16 : 8);
    movieTs = c.u32(); movieDur = (ver === 1 ? c.u64() : c.u32()) / movieTs;
  }
  if (find(moov, root, 'mvex')) fragmented = true;
  let title = null;
  const udta = find(moov, root, 'udta');
  if (udta) {
    const meta = find(moov, udta, 'meta');
    // meta 是 full box：前 4 字节是版本和标志
    const ilst = meta && find(moov, { data: meta.data + 4, end: meta.end }, 'ilst');
    const nam = (ilst && find(moov, ilst, '©nam')) || find(moov, udta, '©nam');
    if (nam) {
      const data = find(moov, nam, 'data');
      const bytes = data ? moov.subarray(data.data + 8, data.end) : moov.subarray(nam.data + 4, nam.end);
      title = new TextDecoder().decode(bytes).replace(/\x00+$/, '').trim() || null;
    }
  }
  const tracks = [];
  let order = 0;
  for (const box of boxes(moov, root.data, root.end)) {
    if (box.type !== 'trak') continue;
    const t = parseTrak(moov, box, movieTs, order++);
    if (t) tracks.push(t);
  }
  return { container: 'mp4', duration: movieDur, tracks, fragmented, title };
}

// 展开样本表 → [{pos, size, start, end}]（秒）
function sampleTable({ b, stbl, timescale, offset }) {
  const get = (t) => find(b, stbl, t);
  const stts = get('stts'), stsc = get('stsc'), stsz = get('stsz'), stz2 = get('stz2');
  const stco = get('stco'), co64 = get('co64');
  if (!stts || !stsc || !(stsz || stz2) || !(stco || co64)) return [];

  let c;
  // 样本大小
  const sizes = [];
  if (stsz) {
    c = new Cur(b, stsz.data + 4);
    const fixed = c.u32(), n = c.u32();
    for (let i = 0; i < n; i++) sizes.push(fixed || c.u32());
  } else {
    c = new Cur(b, stz2.data + 4);
    c.skip(3); const field = c.u8(), n = c.u32();
    for (let i = 0; i < n; i++) {
      if (field === 4) { const v = b[c.o + (i >> 1)]; sizes.push(i & 1 ? v & 15 : v >> 4); }
      else sizes.push(field === 8 ? c.u8() : c.u16());
    }
  }
  const n = sizes.length;
  // chunk 偏移
  const chunks = [];
  c = new Cur(b, (stco || co64).data + 4);
  for (let i = 0, cn = c.u32(); i < cn; i++) chunks.push(co64 ? c.u64() : c.u32());
  // 每个 chunk 里的样本数
  c = new Cur(b, stsc.data + 4);
  const sc = [];
  for (let i = 0, en = c.u32(); i < en; i++) { sc.push([c.u32(), c.u32()]); c.skip(4); }
  const pos = new Array(n);
  let s = 0;
  for (let e = 0; e < sc.length && s < n; e++) {
    const firstChunk = sc[e][0] - 1, per = sc[e][1];
    const lastChunk = e + 1 < sc.length ? sc[e + 1][0] - 1 : chunks.length;
    for (let ch = firstChunk; ch < lastChunk && s < n; ch++) {
      let p = chunks[ch];
      for (let k = 0; k < per && s < n; k++) { pos[s] = p; p += sizes[s]; s++; }
    }
  }
  // 时间
  const out = [];
  c = new Cur(b, stts.data + 4);
  let t = 0, i = 0;
  for (let e = 0, en = c.u32(); e < en; e++) {
    const cnt = c.u32(), delta = c.u32();
    for (let k = 0; k < cnt && i < n; k++, i++) {
      out.push({ pos: pos[i], size: sizes[i], start: t / timescale + offset, end: (t + delta) / timescale + offset });
      t += delta;
    }
  }
  return out;
}

const SAMPLE_GAP = 64 * 1024;     // 相邻两个字幕样本间隔不超过这么多字节就并成一次读取（和 MKV 按索引取块同一个数）
const SAMPLE_SPAN = 1024 * 1024;  // 并成一次读取最长跨这么多，免得一个请求太大、并发发不开
const SAMPLE_CONCURRENCY = 6;

// 返回 Map<trackId, [{start, end, data}]>
// 字幕样本小而分散：所有要的轨的样本按文件位置排好，相邻的并成一次读取，最多 6 路并发（远程文件每次读取就是一个 Range 请求）
export async function extractMp4Subs(blob, probe, trackIds, onProgress) {
  const out = new Map();
  const list = probe.tracks.filter((t) => trackIds.includes(t.id) && t._stbl);
  const all = list.map((t) => ({ t, samples: sampleTable(t._stbl).filter((s) => s.size > 2 && Number.isFinite(s.pos)) }));
  const total = all.reduce((a, x) => a + x.samples.length, 0) || 1;
  const items = [];
  for (const { t, samples } of all) {
    const res = new Array(samples.length);
    out.set(t.id, res);
    samples.forEach((s, i) => items.push({ s, res, i }));
  }
  items.sort((a, b) => a.s.pos - b.s.pos);
  const groups = [];
  for (const it of items) {
    const g = groups.at(-1), end = it.s.pos + it.s.size;
    if (g && it.s.pos - g.end <= SAMPLE_GAP && end - g.start <= SAMPLE_SPAN) { g.items.push(it); g.end = Math.max(g.end, end); }
    else groups.push({ start: it.s.pos, end, items: [it] });
  }
  let done = 0;
  await pool(groups, SAMPLE_CONCURRENCY, async (g) => {
    const buf = new Uint8Array(await blob.slice(g.start, g.end).arrayBuffer());
    for (const { s, res, i } of g.items) {
      res[i] = { start: s.start, end: s.end, data: buf.slice(s.pos - g.start, s.pos - g.start + s.size) };
    }
    done += g.items.length;
    onProgress?.(done / total);
  });
  onProgress?.(1);
  return out;
}
