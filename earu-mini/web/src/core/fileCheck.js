// 文件格式校验：扩展名和文件头字节必须一致。
// MKV：开头 1A 45 DF A3（EBML）；MP4：第 4~8 字节是 "ftyp"。

const EXT_KIND = { mkv: 'mkv', mp4: 'mp4' };

function sniff(head) {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'mkv';
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4';
  return null;
}

// 返回 { ok: true, kind } 或 { ok: false, error: 'badExt' | 'badHeader' | 'mismatch', ext, sniffed }
export async function checkVideoFile(file) {
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniff(head);
  const kind = EXT_KIND[ext];
  if (!kind) return { ok: false, error: 'badExt', ext, sniffed };
  if (!sniffed) return { ok: false, error: 'badHeader', ext, sniffed };
  if (sniffed !== kind) return { ok: false, error: 'mismatch', ext, sniffed };
  return { ok: true, kind };
}
