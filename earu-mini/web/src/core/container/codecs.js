// 把容器里的编码标识统一成 { codec, label, ... }，两种容器共用一套判断。
// play: 'yes' 浏览器能播 | 'no' Chrome/Edge 播不了 | 'maybe' 取决于显卡/系统

const AUDIO = {
  aac: { label: 'AAC', play: 'yes' },
  mp3: { label: 'MP3', play: 'yes' },
  opus: { label: 'Opus', play: 'yes' },
  vorbis: { label: 'Vorbis', play: 'yes' },
  flac: { label: 'FLAC', play: 'yes' },
  pcm: { label: 'PCM', play: 'maybe' },
  alac: { label: 'ALAC', play: 'no' },
  ac3: { label: 'AC3 (Dolby Digital)', play: 'no' },
  eac3: { label: 'E-AC3 (Dolby Digital Plus)', play: 'no' },
  dts: { label: 'DTS', play: 'no' },
  truehd: { label: 'TrueHD', play: 'no' },
};

const VIDEO = {
  h264: { label: 'H.264', play: 'yes' },
  hevc: { label: 'H.265 / HEVC', play: 'maybe' },
  vp8: { label: 'VP8', play: 'yes' },
  vp9: { label: 'VP9', play: 'yes' },
  av1: { label: 'AV1', play: 'yes' },
  mpeg2: { label: 'MPEG-2', play: 'no' },
  mpeg4: { label: 'MPEG-4 Part 2 (XviD/DivX)', play: 'no' },
};

// kind: 'text' 能读 | 'image' 图片字幕 | 'other' 其他不支持的格式
const SUB = {
  srt: { label: 'SRT', kind: 'text' },
  ass: { label: 'ASS/SSA', kind: 'text' },
  webvtt: { label: 'WebVTT', kind: 'text' },
  movtext: { label: 'mov_text', kind: 'text' },
  pgs: { label: 'PGS', kind: 'image' },
  vobsub: { label: 'VobSub', kind: 'image' },
  dvbsub: { label: 'DVB', kind: 'image' },
  ttml: { label: 'TTML', kind: 'other' },
  cea608: { label: 'CEA-608', kind: 'other' },
};

// 认不出、容器里也没写名字的编码：label 留空，界面上补「未知」（TrackPanel.jsx codecName）——这里在读视频的后台线程里跑，
// 不知道界面语言，写死哪种话都不对
function info(table, codec, raw) {
  return { codec: codec || 'unknown', ...(table[codec] || { label: raw || '', play: 'maybe', kind: 'other' }), raw };
}

export const audioInfo = (codec, raw) => info(AUDIO, codec, raw);
export const videoInfo = (codec, raw) => info(VIDEO, codec, raw);
export const subInfo = (codec, raw) => info(SUB, codec, raw);

export function mkvCodec(id) {
  const c = id || '';
  if (c.startsWith('A_AAC')) return 'aac';
  if (c === 'A_MPEG/L3') return 'mp3';
  if (c === 'A_OPUS') return 'opus';
  if (c === 'A_VORBIS') return 'vorbis';
  if (c === 'A_FLAC') return 'flac';
  if (c.startsWith('A_PCM')) return 'pcm';
  if (c === 'A_ALAC') return 'alac';
  if (c === 'A_AC3' || c === 'A_AC3/BSID9' || c === 'A_AC3/BSID10') return 'ac3';
  if (c === 'A_EAC3') return 'eac3';
  if (c.startsWith('A_DTS')) return 'dts';
  if (c === 'A_TRUEHD' || c === 'A_MLP') return 'truehd';
  if (c === 'V_MPEG4/ISO/AVC') return 'h264';
  if (c === 'V_MPEGH/ISO/HEVC') return 'hevc';
  if (c === 'V_VP8') return 'vp8';
  if (c === 'V_VP9') return 'vp9';
  if (c === 'V_AV1') return 'av1';
  if (c === 'V_MPEG2' || c === 'V_MPEG1') return 'mpeg2';
  if (c.startsWith('V_MPEG4/ISO/') || c === 'V_MS/VFW/FOURCC') return 'mpeg4';
  if (c === 'S_TEXT/UTF8' || c === 'S_TEXT/ASCII') return 'srt';
  if (/^S_(TEXT\/)?(ASS|SSA)$/.test(c)) return 'ass';
  if (c === 'S_TEXT/WEBVTT' || c === 'D_WEBVTT/SUBTITLES' || c === 'D_WEBVTT/CAPTIONS') return 'webvtt';
  if (c === 'S_HDMV/PGS') return 'pgs';
  if (c === 'S_VOBSUB') return 'vobsub';
  if (c === 'S_DVBSUB') return 'dvbsub';
  return null;
}

// MP4 样本描述 fourcc（音频的 mp4a 还要看 esds 里的 objectTypeIndication）
export function mp4Codec(fourcc, oti) {
  switch (fourcc) {
    case 'avc1': case 'avc3': return 'h264';
    case 'hvc1': case 'hev1': return 'hevc';
    case 'vp08': return 'vp8';
    case 'vp09': return 'vp9';
    case 'av01': return 'av1';
    case 'mp4v': return 'mpeg4';
    case 'mp4a':
      if (oti === 0x69 || oti === 0x6b) return 'mp3';
      if (oti === 0xa5) return 'ac3';
      if (oti === 0xa6) return 'eac3';
      if (oti === 0xa9) return 'dts';
      return 'aac';
    case '.mp3': return 'mp3';
    case 'Opus': return 'opus';
    case 'fLaC': return 'flac';
    case 'alac': return 'alac';
    case 'ac-3': return 'ac3';
    case 'ec-3': return 'eac3';
    case 'dtsc': case 'dtsh': case 'dtsl': case 'dtse': case 'dtsx': return 'dts';
    case 'mlpa': return 'truehd';
    case 'lpcm': case 'sowt': case 'twos': case 'ipcm': return 'pcm';
    case 'tx3g': return 'movtext';
    case 'wvtt': return 'webvtt';
    case 'stpp': return 'ttml';
    case 'c608': return 'cea608';
    default: return null;
  }
}
