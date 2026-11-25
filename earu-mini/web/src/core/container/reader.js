// 按需从 Blob/File 读字节。顺序扫描时用一块窗口缓存，避免每个小元素都发一次异步读取。

const DEFAULT_WINDOW = 4 * 1024 * 1024;

export class BlobReader {
  constructor(blob, windowSize = DEFAULT_WINDOW) {
    this.blob = blob;
    this.size = blob.size;
    this.windowSize = windowSize;
    this.winStart = 0;
    this.win = new Uint8Array(0);
  }

  // 保证 [pos, pos+len) 已在窗口内；返回实际可用长度（文件末尾可能不足 len）
  async ensure(pos, len) {
    const end = Math.min(pos + len, this.size);
    if (pos >= this.winStart && end <= this.winStart + this.win.length) return end - pos;
    const loadEnd = Math.min(this.size, pos + Math.max(len, this.windowSize));
    this.win = new Uint8Array(await this.blob.slice(pos, loadEnd).arrayBuffer());
    this.winStart = pos;
    return end - pos;
  }

  // 调用前必须 ensure 过
  view(pos, len) {
    const o = pos - this.winStart;
    return this.win.subarray(o, o + len);
  }

  // 单独读一段（适合 MP4 里零散的小样本），回拷贝，不动窗口；这一段整个在当前窗口里时直接从窗口拷，不再发请求（远程文件省一次往返）
  async read(pos, len) {
    const end = Math.min(pos + len, this.size);
    if (pos >= this.winStart && end <= this.winStart + this.win.length) return this.win.slice(pos - this.winStart, end - this.winStart);
    return new Uint8Array(await this.blob.slice(pos, pos + len).arrayBuffer());
  }
}

const utf8 = new TextDecoder('utf-8');
const utf16be = new TextDecoder('utf-16be');

export function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes.subarray(2));
  return utf8.decode(bytes);
}

export function ascii(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

// 把一串小读并成较大的 Range（远程文件按块读：一个请求读一大块、再切回给各个读者，请求数少几倍）。
// items 按 pos 从小到大，每项要从 pos 起读 peek 字节；和上一组的末尾隔不超过 gap、并上以后这组跨度不超过 span 就并进去，不然另起一组。
// 回 [{ start, end, items }]：[start, end) 就是要发的那一个 Range（end 可能超出文件末尾，读的时候夹住）。
// gap / span 给 64KB / 1MB 就是原来 mkv.js 按索引取块的分组，一字不差。
export function mergeReads(items, { gap, span, peek }) {
  const groups = [];
  for (const it of items) {
    const g = groups.at(-1);
    if (g && it.pos - g.end <= gap && it.pos + peek - g.start <= span) { g.items.push(it); g.end = it.pos + peek; }
    else groups.push({ start: it.pos, end: it.pos + peek, items: [it] });
  }
  return groups;
}

// 并起来读到的一块 buf（文件里从 bufStart 起）→ 其中从 pos 起的那一段（不拷贝，给读者的字节就是文件里的字节）；pos 不在这块里回 null
export function cutChunk(buf, bufStart, pos, len = Infinity) {
  if (!buf || pos < bufStart || pos - bufStart >= buf.length) return null;
  return buf.subarray(pos - bufStart, len === Infinity ? undefined : pos - bufStart + len);
}

// 最多 n 个同时跑：对 items 里每一项调 fn(item, index)，全部做完才返回；一项抛错，整个抛出（别的已经在路上的跑完为止）
export async function pool(items, n, fn) {
  let next = 0, failed = null;
  const worker = async () => {
    while (next < items.length && !failed) {
      const k = next++;
      try { await fn(items[k], k); } catch (e) { failed ||= { e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failed) throw failed.e;
}

