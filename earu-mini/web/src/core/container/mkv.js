// Matroska (MKV) 最小读取器：只读轨道信息和文本字幕块，其余元素按长度跳过。
// 字幕块散在整个文件的 Cluster 里，两种取法：
//   1. 按索引（Cues）：读 Cues，得到每句字幕在文件里的位置，只去读那几个小块——读的字节很少；
//   2. 整片扫：顺序扫一遍所有 Cluster（只读元素头，视频数据直接跳过）——只有文件没有索引（或索引对不上）时才用。

import { BlobReader, cutChunk, mergeReads, pool } from './reader.js';
import { mkvCodec, audioInfo, videoInfo, subInfo } from './codecs.js';
import { normalizeLang } from '../lang.js';

const ID = {
  EBML: 0x1a45dfa3, DocType: 0x4282,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489, Title: 0x7ba9,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83,
  FlagEnabled: 0xb9, FlagDefault: 0x88, FlagForced: 0x55aa, FlagHearingImpaired: 0x55ab,
  Name: 0x536e, Language: 0x22b59c, LanguageBCP47: 0x22b59d, CodecID: 0x86,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  ContentEncodings: 0x6d80, ContentEncoding: 0x6240, ContentEncodingScope: 0x5032,
  ContentCompression: 0x5034, ContentCompAlgo: 0x4254, ContentCompSettings: 0x4255, ContentEncryption: 0x5035,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b,
  Cues: 0x1c53bb6b, Chapters: 0x1043a770, Tags: 0x1254c367, Attachments: 0x1941a469,
  CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1, CueRelativePosition: 0xf0,
};
// 未知长度的 Cluster 靠「碰到下一个顶层元素」判断结束
const TOP_LEVEL = new Set([ID.Cluster, ID.Cues, ID.Chapters, ID.Tags, ID.Attachments, ID.Info, ID.Tracks, ID.SeekHead]);
const TRACK_TYPE = { 1: 'video', 2: 'audio', 17: 'subtitle' };

// ---- EBML 变长整数 ----
function vlen(first) {
  return Math.clz32(first) - 23; // 0x80 → 1 … 0x01 → 8；0x00 → 9（非法）
}
function readId(b, o) {
  const n = vlen(b[o]);
  if (n > 4 || o + n > b.length) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
  return { v, n };
}
function readSize(b, o) {
  const n = vlen(b[o]);
  if (n > 8 || o + n > b.length) return null;
  let v = b[o] & (0xff >> n);
  let allOnes = v === (0xff >> n);
  for (let i = 1; i < n; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) allOnes = false;
  }
  return { v: allOnes ? -1 : v, n };
}
function readUint(b, o, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[o + i];
  return v;
}
function readFloat(b, o, len) {
  const dv = new DataView(b.buffer, b.byteOffset + o, len);
  return len === 4 ? dv.getFloat32(0) : len === 8 ? dv.getFloat64(0) : 0;
}
const utf8 = new TextDecoder('utf-8');
const readStr = (b, o, len) => utf8.decode(b.subarray(o, o + len)).replace(/\0+$/, '');

// 内存里的一段 master 元素，同步遍历子元素
function* children(b, start, end) {
  let o = start;
  while (o < end) {
    const id = readId(b, o);
    if (!id) return;
    const sz = readSize(b, o + id.n);
    if (!sz) return;
    const data = o + id.n + sz.n;
    const size = sz.v < 0 ? end - data : Math.min(sz.v, end - data);
    yield { id: id.v, data, size };
    o = data + size;
  }
}

// 从文件读一个元素头
async function header(r, pos) {
  const avail = await r.ensure(pos, 12);
  if (avail < 2) return null;
  const b = r.view(pos, avail);
  const id = readId(b, 0);
  if (!id) return null;
  const sz = readSize(b, id.n);
  if (!sz) return null;
  return { id: id.v, size: sz.v, data: pos + id.n + sz.n };
}

function parseInfo(b) {
  const info = { timestampScale: 1000000, duration: null, title: null };
  for (const c of children(b, 0, b.length)) {
    if (c.id === ID.TimestampScale) info.timestampScale = readUint(b, c.data, c.size);
    else if (c.id === ID.Duration) info.duration = readFloat(b, c.data, c.size);
    else if (c.id === ID.Title) info.title = readStr(b, c.data, c.size).trim() || null;
  }
  return info;
}

function parseEncodings(b, start, end) {
  // 只关心压缩（字幕常见 zlib；头部剥离也会出现）。加密的轨读不了。
  for (const enc of children(b, start, end)) {
    if (enc.id !== ID.ContentEncoding) continue;
    let scope = 1, comp = null, encrypted = false;
    for (const c of children(b, enc.data, enc.data + enc.size)) {
      if (c.id === ID.ContentEncodingScope) scope = readUint(b, c.data, c.size);
      else if (c.id === ID.ContentEncryption) encrypted = true;
      else if (c.id === ID.ContentCompression) {
        comp = { algo: 0, settings: null };
        for (const cc of children(b, c.data, c.data + c.size)) {
          if (cc.id === ID.ContentCompAlgo) comp.algo = readUint(b, cc.data, cc.size);
          else if (cc.id === ID.ContentCompSettings) comp.settings = b.slice(cc.data, cc.data + cc.size);
        }
      }
    }
    if (encrypted) return { encrypted: true };
    if (comp && (scope & 1)) return comp;
  }
  return null;
}

function parseTracks(b) {
  const tracks = [];
  for (const te of children(b, 0, b.length)) {
    if (te.id !== ID.TrackEntry) continue;
    const t = { id: 0, typeNum: 0, codecId: '', name: '', language: 'eng', bcp47: null,
      isDefault: true, isForced: false, isHearingImpaired: false, enabled: true, comp: null };
    for (const c of children(b, te.data, te.data + te.size)) {
      switch (c.id) {
        case ID.TrackNumber: t.id = readUint(b, c.data, c.size); break;
        case ID.TrackType: t.typeNum = readUint(b, c.data, c.size); break;
        case ID.CodecID: t.codecId = readStr(b, c.data, c.size); break;
        case ID.Name: t.name = readStr(b, c.data, c.size); break;
        case ID.Language: t.language = readStr(b, c.data, c.size); t.langSet = true; break; // 规范默认值是 eng
        case ID.LanguageBCP47: t.bcp47 = readStr(b, c.data, c.size); t.langSet = true; break;
        case ID.FlagDefault: t.isDefault = !!readUint(b, c.data, c.size); break;
        case ID.FlagForced: t.isForced = !!readUint(b, c.data, c.size); break;
        case ID.FlagHearingImpaired: t.isHearingImpaired = !!readUint(b, c.data, c.size); break;
        case ID.FlagEnabled: t.enabled = !!readUint(b, c.data, c.size); break;
        case ID.ContentEncodings: t.comp = parseEncodings(b, c.data, c.data + c.size); break;
        case ID.Video:
          for (const v of children(b, c.data, c.data + c.size)) {
            if (v.id === ID.PixelWidth) t.width = readUint(b, v.data, v.size);
            else if (v.id === ID.PixelHeight) t.height = readUint(b, v.data, v.size);
          }
          break;
        case ID.Audio:
          for (const a of children(b, c.data, c.data + c.size)) {
            if (a.id === ID.Channels) t.channels = readUint(b, a.data, a.size);
            else if (a.id === ID.SamplingFrequency) t.sampleRate = readFloat(b, a.data, a.size);
          }
          break;
      }
    }
    const type = TRACK_TYPE[t.typeNum];
    if (!type) continue;
    const codec = mkvCodec(t.codecId);
    const ci = type === 'audio' ? audioInfo(codec, t.codecId) : type === 'video' ? videoInfo(codec, t.codecId) : subInfo(codec, t.codecId);
    const langRaw = t.bcp47 || t.language;
    const track = {
      id: t.id, type, ...ci, langRaw, lang: normalizeLang(langRaw), name: t.name,
      isDefault: t.isDefault, isForced: t.isForced, isHearingImpaired: t.isHearingImpaired,
      langImplicit: !t.langSet, // 没写语言：按规范记成 eng，但选轨时要先按内容核对（lang.js）
      width: t.width, height: t.height, channels: t.channels, sampleRate: t.sampleRate,
      _comp: t.comp,
    };
    if (t.comp?.encrypted) track.kind = 'other';
    tracks.push(track);
  }
  return tracks;
}

// 读 pos 处的一个顶层元素（id 必须是 wantId）的内容；first 是先读多少字节（一个请求，不够再补一个）。读不出 / id 不对 / 大于 cap 回 null
async function readTopElement(blob, pos, wantId, first, cap = 64 * 1024 * 1024) {
  if (pos == null || pos < 0 || pos + 2 > blob.size) return null;
  let buf = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + first)).arrayBuffer());
  const id = readId(buf, 0);
  if (!id || id.v !== wantId) return null;
  const sz = readSize(buf, id.n);
  if (!sz || sz.v < 0 || sz.v > cap) return null;
  const hdr = id.n + sz.n, need = hdr + sz.v;
  if (need > blob.size - pos) return null;   // 文件被截断、元素没读全：当读不出，不拿半截去解
  if (buf.length < need) {
    const rest = new Uint8Array(await blob.slice(pos + buf.length, pos + need).arrayBuffer());
    const all = new Uint8Array(need);
    all.set(buf);
    all.set(rest, buf.length);
    buf = all;
  }
  return buf.subarray(hdr, need);
}

export async function probeMkv(blob) {
  // 远程文件：256KB 一个请求就放得下 EBML 头 + SeekHead + Info + Tracks；本机文件窗口照旧 1MB
  const r = new BlobReader(blob, 1024 * 1024);
  const ebml = await header(r, 0);
  if (!ebml || ebml.id !== ID.EBML) throw new Error('not matroska');
  const seg = await header(r, ebml.data + ebml.size);
  if (!seg || seg.id !== ID.Segment) throw new Error('no segment');
  const segStart = seg.data;
  const segEnd = seg.size < 0 ? blob.size : Math.min(blob.size, seg.data + seg.size);

  let info = null, tracks = null, firstCluster = null, clusterHead = null, cuesPos = null;
  const seek = {};
  const readMaster = async (e) => r.read(e.data, e.size);
  // SeekHead 的内容 → seek[元素 id] = 它在文件里的绝对位置
  const addSeek = (b) => {
    for (const s of children(b, 0, b.length)) {
      if (s.id !== ID.Seek) continue;
      let sid = 0, spos = 0;
      for (const c of children(b, s.data, s.data + s.size)) {
        if (c.id === ID.SeekID) sid = readUint(b, c.data, c.size);
        else if (c.id === ID.SeekPosition) spos = readUint(b, c.data, c.size);
      }
      seek[sid] = segStart + spos;
    }
  };

  let p = segStart;
  while (p < segEnd) {
    const e = await header(r, p);
    if (!e) break;
    if (e.id === ID.Info) info = parseInfo(await readMaster(e));
    else if (e.id === ID.Tracks) tracks = parseTracks(await readMaster(e));
    else if (e.id === ID.SeekHead && e.size > 0) addSeek(await readMaster(e));
    else if (e.id === ID.Cues) cuesPos ??= p; // 索引放在第一个 Cluster 前面的（SeekHead 没写也认）
    else if (e.id === ID.Cluster) {
      firstCluster = p;
      clusterHead = e.data - p; // Cluster 头长（id + 长度字段），按索引找块时用
      break;
    }
    if (e.size < 0) break;
    p = e.data + e.size;
  }
  // 轨道信息放在 Cluster 之后的少见情况：按 SeekHead 去读
  for (const [want, set] of [[ID.Info, (b) => (info = parseInfo(b))], [ID.Tracks, (b) => (tracks = parseTracks(b))]]) {
    if ((want === ID.Info ? info : tracks) || !seek[want]) continue;
    const e = await header(r, seek[want]);
    if (e && e.id === want && e.size > 0) set(await readMaster(e));
  }
  if (!tracks) throw new Error('no tracks');
  // Cues 在哪：SeekHead 写的，或者走过去时撞见的；SeekHead 里还指着第二个 SeekHead（在 Cluster 后面）的，跟过去看一眼，最多三层
  for (let depth = 0, seen = new Set(); depth < 3 && cuesPos == null && seek[ID.Cues] == null; depth++) {
    const next = seek[ID.SeekHead];
    if (next == null || seen.has(next) || (firstCluster != null && next < firstCluster)) break;
    seen.add(next);
    const b = await readTopElement(blob, next, ID.SeekHead, 4096);
    if (!b) break;
    addSeek(b);
  }
  info ||= { timestampScale: 1000000, duration: null };
  return {
    container: 'mkv',
    duration: info.duration != null ? (info.duration * info.timestampScale) / 1e9 : null,
    tracks,
    title: info.title,
    _mkv: { segStart, segEnd, firstCluster: firstCluster ?? seek[ID.Cluster] ?? null, scale: info.timestampScale,
      cuesPos: cuesPos ?? seek[ID.Cues] ?? null, clusterHead },
  };
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// 块里的原始字节 → 字幕字节：按轨道的 ContentEncoding 解压（algo 0 = zlib）或把 settings 拼在前面（algo 3 = 头部剥离）。
// 解压不出来回 null（这一句不要）。finishSubs 和 checkMkvSubs 共用
async function decodeBlock(comp, data) {
  if (comp && comp.algo === 0) {
    try { return await inflate(data); } catch { return null; }
  }
  if (comp && comp.algo === 3 && comp.settings) {
    const merged = new Uint8Array(comp.settings.length + data.length);
    merged.set(comp.settings);
    merged.set(data, comp.settings.length);
    return merged;
  }
  return data;
}

const CUE_GAP = 64 * 1024;   // 按索引取块：相邻两块间隔不超过这么多字节就并成一个读取（MP4 字幕样本同一个数）
const CUE_SPAN = 1024 * 1024; // 并成一个请求最长跨这么多，免得一个请求太大、并发发不开
const CUE_PEEK = 2048;       // 每块先读这么多（字幕块一般几十到几百字节），不够再按真实长度补读
// 同时读几组
const CUE_CONCURRENCY = 6;

// 索引走不通：调用方接住以后整片扫。reason：no_index（SeekHead 没写 Cues）/ bad_cues（那个位置不是 Cues）/
// no_track（索引里没有要的字幕轨）/ bad_block（索引指的位置不是这条轨的块）
function noCues(reason, msg) {
  const e = new Error(`no_cues: ${msg}`);
  e.code = 'no_cues';
  e.reason = reason;
  return e;
}

// Cues → Map<轨号, { items: [{ time, cluster, rel }], partial }>；只收 want 里的轨。time 是 CueTime（轨道刻度），cluster 是 Cluster 在段内的偏移，
// rel 是块在 Cluster 内的偏移；缺 cluster / rel 的记录标 partial（这条轨的索引不全，没法按它取）
function parseCues(b, want) {
  const out = new Map([...want.keys()].map((id) => [id, { items: [], partial: false }]));
  for (const cp of children(b, 0, b.length)) {
    if (cp.id !== ID.CuePoint) continue;
    let time = 0;
    const tps = [];
    for (const c of children(b, cp.data, cp.data + cp.size)) {
      if (c.id === ID.CueTime) time = readUint(b, c.data, c.size);
      else if (c.id === ID.CueTrackPositions) {
        const o = {};
        for (const x of children(b, c.data, c.data + c.size)) o[x.id] = readUint(b, x.data, x.size);
        tps.push(o);
      }
    }
    for (const o of tps) {
      const t = out.get(o[ID.CueTrack]);
      if (!t) continue;
      if (o[ID.CueClusterPosition] == null || o[ID.CueRelativePosition] == null) t.partial = true;
      else t.items.push({ time, cluster: o[ID.CueClusterPosition], rel: o[ID.CueRelativePosition] });
    }
  }
  return out;
}

// b 从一个 SimpleBlock / BlockGroup 元素的头开始。回 { need }（元素比手上的长，要补读到这么多字节）、null（对不上，不是这条轨的块）、
// { skip: true }（有 lacing，整片扫描也跳过）或 { data, dur }（dur 是 BlockGroup 里的 BlockDuration，没有是 null）
function blockAt(b, track) {
  const id = readId(b, 0);
  if (!id || (id.v !== ID.SimpleBlock && id.v !== ID.BlockGroup)) return null;
  const sz = readSize(b, id.n);
  if (!sz || sz.v < 0) return null;
  const hdr = id.n + sz.n;
  if (hdr + sz.v > b.length) return { need: hdr + sz.v };
  let blk = null, dur = null;
  if (id.v === ID.SimpleBlock) blk = b.subarray(hdr, hdr + sz.v);
  else {
    for (const k of children(b, hdr, hdr + sz.v)) {
      if (k.id === ID.Block) blk = b.subarray(k.data, k.data + k.size);
      else if (k.id === ID.BlockDuration) dur = readUint(b, k.data, k.size);
    }
  }
  if (!blk) return null;
  const tn = readSize(blk, 0);
  if (!tn || tn.v !== track || blk.length < tn.n + 3) return null;
  if ((blk[tn.n + 2] >> 1) & 3) return { skip: true };
  return { data: blk.slice(tn.n + 3), dur };
}

// Cues 元素的内容：同一个 probe 只读一次（checkMkvSubs 抽查完、对不上再按索引取，不用再读一遍）。读不出回 null；
// 读的时候出错（网断一下）不留着，下次重读
function cuesOf(blob, m) {
  if (!m._cues) {
    m._cues = readTopElement(blob, m.cuesPos, ID.Cues, 128 * 1024);
    m._cues.catch(() => { m._cues = null; });
  }
  return m._cues;
}

// 按索引读块用的：read(位置, 长度)、headOf(Cluster 位置) → Cluster 头长、head0 = 第一个 Cluster 的头长
// （各 Cluster 一般一样，用 probe 读第一个时量到的；对不上的 Cluster 再单读它的头校正）。
// heads：Cluster 位置 → 它的头长（Promise；同一个 Cluster 的头只读一次）；seen：量到过的、和 head0 不一样的头长（新的在前）——
// 别的 Cluster 再扑空，先拿它们在手上那段里试，试中了不发请求（见过 4K 片一成多的 Cluster 头比第一个长 1 字节，不这样每组多发 2 个请求）
async function cueReader(blob, m) {
  const read = async (pos, len) => new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + len)).arrayBuffer());
  const measure = async (cl) => {
    const b = await read(cl, 16);
    const id = readId(b, 0), sz = id && readSize(b, id.n);
    return id && id.v === ID.Cluster && sz ? id.n + sz.n : null;
  };
  const heads = new Map(), seen = [];
  const headOf = (cl) => {
    if (!heads.has(cl)) {
      const p = measure(cl);
      heads.set(cl, p);
      p.catch(() => heads.delete(cl)); // 读的时候出错不留着，下次重读
    }
    return heads.get(cl);
  };
  const head0 = m.clusterHead ?? (m.firstCluster != null ? await measure(m.firstCluster) : null) ?? 12;
  return { read, headOf, head0, heads, seen };
}

// 索引里的一项 it（{ track, cl, rel, pos }）处的块 → blockAt 的结果，对不上回 null。buf：从 bufStart 起已经读好的一段（按组读时给），
// 不给就自己读；块比手上的长就补读。位置对不上多半是这个 Cluster 的头长和第一个不一样：先在手上那段里试别的 Cluster 量到过的头长，
// 不中再读这个 Cluster 的头校正（每个 Cluster 只读一次）；对上了改 it.pos
async function blockOf(rd, it, buf = null, bufStart = 0) {
  const inBuf = (pos) => cutChunk(buf, bufStart, pos) != null;
  const at = async (pos) => {
    let blk = blockAt(cutChunk(buf, bufStart, pos) || await rd.read(pos, CUE_PEEK), it.track);
    if (blk?.need) blk = blockAt(await rd.read(pos, blk.need), it.track);
    return blk;
  };
  const known = rd.heads.get(it.cl);
  const h0 = known ? await known : rd.head0;
  const pos0 = h0 == null ? it.pos : it.cl + h0 + it.rel;
  let blk = await at(pos0);
  if (blk || known) { if (blk) it.pos = pos0; return blk; }
  for (const h of rd.seen) {
    const pos = it.cl + h + it.rel;
    if (h === h0 || !inBuf(pos)) continue;
    blk = await at(pos);
    if (blk) { rd.heads.set(it.cl, Promise.resolve(h)); it.pos = pos; return blk; }
  }
  const h = await rd.headOf(it.cl);
  if (h == null || h === h0) return null;
  if (h !== rd.head0 && !rd.seen.includes(h)) rd.seen.unshift(h);
  const pos = it.cl + h + it.rel;
  blk = await at(pos);
  if (blk) it.pos = pos;
  return blk;
}

// 按索引取字幕：读 Cues → 每句字幕的位置 → 相邻的并成一个读取、并发读 → 和整片扫描一样的 Map（再走同一个 finishSubs）。
// 要的轨必须都有完整索引，否则抛 no_cues（调用方接住，改整片扫）。
async function extractViaCues(blob, probe, trackIds, onProgress) {
  const m = probe._mkv;
  const want = new Map(trackIds.map((id) => [id, []]));
  if (!want.size) return want;
  if (m.cuesPos == null || m.cuesPos >= blob.size) throw noCues('no_index', 'no Cues position in SeekHead');
  const cues = await cuesOf(blob, m);
  if (!cues) throw noCues('bad_cues', 'no Cues element at the SeekHead position');
  const found = parseCues(cues, want);
  const usable = trackIds.filter((id) => found.get(id).items.length && !found.get(id).partial);
  if (usable.length < trackIds.length) throw noCues('no_track', 'Cues has no complete entries for every subtitle track');

  const rd = await cueReader(blob, m);
  const head0 = rd.head0;

  const byPos = new Map(); // 位置 → 项（同一个块被索引了两次只取一次）
  for (const id of usable) {
    for (const it of found.get(id).items) {
      const cl = m.segStart + it.cluster, pos = cl + head0 + it.rel;
      if (!byPos.has(pos)) byPos.set(pos, { track: id, time: it.time, cl, rel: it.rel, pos, res: null });
    }
  }
  const items = [...byPos.values()].sort((a, b) => a.pos - b.pos);
  // 相邻 / 接近的块并成一个较大的读取（reader.js mergeReads），一组一次
  const groups = mergeReads(items, { gap: CUE_GAP, span: CUE_SPAN, peek: CUE_PEEK });

  let done = 0, bad = null;
  await pool(groups, CUE_CONCURRENCY, async (g) => {
    await readGroup(g);
    onProgress?.(++done / groups.length);
  });

  async function readGroup(g) {
    const buf = await rd.read(g.start, g.end - g.start);
    for (const it of g.items) {
      const blk = await blockOf(rd, it, buf, g.start);
      if (!blk) bad ||= it;
      else if (!blk.skip) it.res = blk;
    }
  }
  if (bad) throw noCues('bad_block', `no block of track ${bad.track} at ${bad.pos}`);
  for (const it of items) if (it.res) want.get(it.track).push({ start: it.time, dur: it.res.dur, data: it.res.data }); // 文件顺序，和整片扫描一样
  return finishSubs(want, probe, onProgress);
}

// 取字幕轨。返回 Map<trackId, [{start, end, data: Uint8Array}]>（秒）
// 有完整索引走索引，没有照旧整片扫。opts.via：'cues' 只走索引（不退回整片扫）/ 'scan' 只整片扫
export async function extractMkvSubs(blob, probe, trackIds, onProgress, opts = {}) {
  const via = opts.via || 'auto';
  if (via !== 'scan') {
    try {
      return await extractViaCues(blob, probe, trackIds, onProgress);
    } catch (e) {
      if (e.code !== 'no_cues' || via === 'cues') throw e;
    }
  }
  return scanMkvSubs(blob, probe, trackIds, onProgress);
}

// 整片扫描：顺序读所有 Cluster 的元素头，视频数据直接跳过
async function scanMkvSubs(blob, probe, trackIds, onProgress) {
  const { segEnd, firstCluster } = probe._mkv;
  const want = new Map(trackIds.map((id) => [id, []]));
  if (firstCluster == null || !want.size) return want;
  const r = new BlobReader(blob, 8 * 1024 * 1024);

  // 读一个 Block/SimpleBlock，属于要的轨就记下来
  async function block(pos, size, clusterTs) {
    const n = await r.ensure(pos, Math.min(size, 16));
    let b = r.view(pos, n);
    const tn = readSize(b, 0);
    if (!tn || !want.has(tn.v)) return null;
    const hl = tn.n + 3;
    if (size < hl) return null;
    const rel = (b[tn.n] << 24 >> 16) | b[tn.n + 1]; // int16
    const lacing = (b[tn.n + 2] >> 1) & 3;
    if (lacing) return null; // 字幕基本不用 lacing，遇到就跳过
    await r.ensure(pos, size);
    b = r.view(pos, size);
    return { track: tn.v, start: clusterTs + rel, data: b.slice(hl) };
  }

  const total = segEnd - firstCluster;
  let lastReport = 0;
  let p = firstCluster;
  while (p < segEnd) {
    const e = await header(r, p);
    if (!e) break;
    if (e.id !== ID.Cluster) {
      if (e.size < 0) break;
      p = e.data + e.size;
      continue;
    }
    const end = e.size < 0 ? segEnd : Math.min(segEnd, e.data + e.size);
    let q = e.data, ts = 0;
    while (q < end) {
      const c = await header(r, q);
      if (!c) { q = end; break; }
      if (e.size < 0 && TOP_LEVEL.has(c.id)) break;
      if (c.size < 0) { q = end; break; }
      if (c.id === ID.Timestamp) {
        await r.ensure(c.data, c.size);
        ts = readUint(r.view(c.data, c.size), 0, c.size);
      } else if (c.id === ID.SimpleBlock) {
        const blk = await block(c.data, c.size, ts);
        if (blk) want.get(blk.track).push({ start: blk.start, dur: null, data: blk.data });
      } else if (c.id === ID.BlockGroup) {
        let blk = null, dur = null;
        let g = c.data;
        const gEnd = c.data + c.size;
        while (g < gEnd) {
          const gc = await header(r, g);
          if (!gc || gc.size < 0) break;
          if (gc.id === ID.Block) blk = await block(gc.data, gc.size, ts);
          else if (gc.id === ID.BlockDuration) {
            await r.ensure(gc.data, gc.size);
            dur = readUint(r.view(gc.data, gc.size), 0, gc.size);
          }
          g = gc.data + gc.size;
        }
        if (blk) want.get(blk.track).push({ start: blk.start, dur, data: blk.data });
      }
      q = c.data + c.size;
    }
    p = e.size < 0 ? q : end;
    if (onProgress && p - lastReport > total / 100) {
      lastReport = p;
      onProgress((p - firstCluster) / total);
    }
  }

  return finishSubs(want, probe, onProgress);
}

// 取出来的块（Map<轨号, [{start, dur, data}]>，start / dur 是轨道刻度）→ 排序、解压、换算成秒、补齐结束时间。整片扫描和按索引取共用，输出一字不差
async function finishSubs(want, probe, onProgress) {
  const toSec = (ticks) => (ticks * probe._mkv.scale) / 1e9;
  const tracksById = new Map(probe.tracks.map((t) => [t.id, t]));
  const out = new Map();
  for (const [id, blocks] of want) {
    const comp = tracksById.get(id)?._comp;
    blocks.sort((a, b) => a.start - b.start);
    const samples = [];
    for (let i = 0; i < blocks.length; i++) {
      const bl = blocks[i];
      const data = await decodeBlock(comp, bl.data);
      if (!data) continue;
      const start = toSec(bl.start);
      const end = bl.dur != null ? toSec(bl.start + bl.dur)
        : Math.min(start + 5, i + 1 < blocks.length ? toSec(blocks[i + 1].start) : start + 5);
      samples.push({ start, end, data });
    }
    out.set(id, samples);
  }
  if (onProgress) onProgress(1);
  return out;
}
