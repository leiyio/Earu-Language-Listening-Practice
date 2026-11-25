// 把容器里取出的字幕样本（字节）按编码解成纯文本句子 {start, end, text}。
// 与容器无关，也与语种无关。

import { decodeText, ascii } from '../container/reader.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };
const decodeEntities = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

// 统一收尾：去行首尾空白、去空行、压缩空格
function tidy(s) {
  return s.replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// SRT / 纯文本：去 HTML 样式标签，顺带去掉混进来的 ASS 定位标签 {\an8}
export function cleanSrt(s) {
  return tidy(decodeEntities(s.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\{\\[^}]*\}/g, '')));
}

// ASS 行：MKV 里的块格式是 ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
export function cleanAssEvent(s, fieldsBeforeText = 8) {
  let text = s;
  for (let i = 0; i < fieldsBeforeText; i++) {
    const k = text.indexOf(',');
    if (k < 0) return '';
    text = text.slice(k + 1);
  }
  // 绘图模式（\p1 …\p0）里是矢量路径，不是文字
  if (/\{[^}]*\\p[1-9]/.test(text)) {
    text = text.replace(/\{[^}]*\\p[1-9][^}]*\}[\s\S]*?(\{[^}]*\\p0[^}]*\}|$)/g, '');
  }
  text = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
  return tidy(text);
}

// ASS 卡拉 OK 标记（{\k23}、\kf、\K、\ko，单位百分之一秒，是这一小段念多久）：逐词时间（
// AI 识别做的字幕把每个词的时间写成这种标记）。返回 [{ text, start, end }]（秒，相对这一条开始），没有 \k 返回 null。
// 每段的文字照 cleanAssEvent 一样去标签、\N 当空格；只有空白的段（纯停顿）不要
export function assKaraoke(s, fieldsBeforeText = 8) {
  let text = s;
  for (let i = 0; i < fieldsBeforeText; i++) {
    const k = text.indexOf(',');
    if (k < 0) return null;
    text = text.slice(k + 1);
  }
  if (!/\{[^}]*\\[kK][fo]?\d/.test(text)) return null;
  const out = [];
  let at = 0;
  // 按 {…} 切：每个带 \k 的块开一段新的，后面跟着的文字归这一段
  const re = /\{([^}]*)\}|([^{]+)/g;
  let dur = null, start = 0, buf = '';
  const flush = () => {
    const t = buf.replace(/\\N|\\n|\\h/g, ' ').replace(/\s+/g, ' ');
    if (dur != null && t.trim()) out.push({ text: t, start, end: start + dur });
    buf = '';
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] != null) {
      const k = m[1].match(/\\[kK][fo]?(\d+)/);
      if (k) { flush(); start = at; dur = Number(k[1]) / 100; at += dur; }
    } else buf += m[2];
  }
  flush();
  return out.length ? out : null;
}

export function cleanVtt(s) {
  return tidy(decodeEntities(s.replace(/<[^>]*>/g, '')));
}

// mov_text (tx3g)：2 字节长度 + 文本（UTF-8，或带 BOM 的 UTF-16）+ 样式盒子
function movText(data) {
  if (data.length < 2) return '';
  const len = (data[0] << 8) | data[1];
  return cleanSrt(decodeText(data.subarray(2, 2 + len)));
}

// MP4 里的 WebVTT 样本：若干 vttc 盒子，各含 payl
function mp4Vtt(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lines = [];
  const walk = (s, e) => {
    let o = s;
    while (o + 8 <= e) {
      const size = dv.getUint32(o);
      const type = ascii(data.subarray(o + 4, o + 8));
      if (size < 8 || o + size > e) break;
      if (type === 'vttc') walk(o + 8, o + size);
      else if (type === 'payl') lines.push(decodeText(data.subarray(o + 8, o + size)));
      o += size;
    }
  };
  walk(0, data.length);
  return cleanVtt(lines.join('\n'));
}

// codec: srt | ass | webvtt | movtext；container: mkv | mp4
export function decodeSamples(samples, codec, container) {
  const out = [];
  for (const s of samples) {
    let text = '';
    let kara = null;
    if (codec === 'movtext') text = movText(s.data);
    else if (codec === 'webvtt' && container === 'mp4') text = mp4Vtt(s.data);
    else {
      const raw = decodeText(s.data);
      if (codec === 'ass') {
        text = cleanAssEvent(raw);
        // 逐词时间：换成片子里的绝对时间
        kara = assKaraoke(raw)?.map((w) => ({ text: w.text, start: s.start + w.start, end: s.start + w.end })) || null;
      } else if (codec === 'webvtt') text = cleanVtt(raw);
      else text = cleanSrt(raw);
    }
    if (text) out.push(kara ? { start: s.start, end: s.end, text, kara } : { start: s.start, end: s.end, text });
  }
  return out;
}
