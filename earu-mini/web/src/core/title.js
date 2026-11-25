// 从文件名（以及容器里写的标题）猜片名，交给 AI 翻译时当背景：认得这部片，人名和梗就能按通行译法翻。
//   Family.Guy.S20E01.LASIK.Instinct.1080p.HULU.WEB-DL.DD+5.1.H.264-NTb.mkv
//     → { show: 'Family Guy', season: 20, episode: 1, episodeTitle: 'LASIK Instinct' }
//   Inception.2010.1080p.BluRay.x264.mkv → { show: 'Inception', year: 2010 }
// 给界面看的那两种写法（titleLabel、cardTitle）跟着界面语言；交给 AI 当背景的是 parseTitle 的结果本身，不走文案
import { t } from '../i18n/index.js';

// 碰到这些画质/来源/编码标记，后面就都不是片名了
const JUNK = new RegExp('\\b(' + [
  '2160p', '1080[pi]', '720p', '576p', '480p', '4k', 'uhd', 'web[- ]?dl', 'webrip', 'web', 'blu-?ray', 'bdrip', 'brrip',
  'hdrip', 'hdtv', 'dvdrip', 'dvd', 'remux', 'x26[45]', 'h ?26[45]', 'hevc', 'avc', 'aac(\\d\\.\\d)?', 'ac3', 'e-?ac-?3',
  'ddp?\\d?', 'dts(-hd)?', 'truehd', 'atmos', 'hdr(10)?', 'dv', 'sdr', '10 ?bit', 'amzn', 'nf', 'hulu', 'dsnp', 'hmax',
  'atvp', 'max', 'pcok', 'multi', 'french', 'proper', 'repack', 'internal', 'subbed', 'dubbed', 'complete',
  'extended', 'unrated', 'remastered', 'imax',
].join('|') + ')\\b', 'i');

const tidy = (s) => s
  .replace(/\[[^\]]*\]/g, ' ')          // [rartv] [发布组]
  .replace(/[._]+/g, ' ')                // 点和下划线当空格（缩写里的点很少出现在文件名里）
  .replace(/\s+-\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^[-–\s]+|[-–\s]+$/g, '');

function cutJunk(s) {
  const m = s.match(JUNK);
  let out = m ? s.slice(0, m.index) : s;
  out = out.replace(/\(\s*$/, '').replace(/\([^)]*$/, ''); // "(1080p AMZN …" 前半个括号
  return tidy(out);
}

// 中文数字（季数用得到的范围）
const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNum(x) {
  if (/^\d+$/.test(x)) return Number(x);
  if (x.length === 1) return CN_NUM[x];
  if (x[0] === '十') return 10 + (CN_NUM[x[1]] || 0);   // 十二
  return CN_NUM[x[0]] * 10 + (x[2] ? CN_NUM[x[2]] : 0); // 二十 / 二十三
}
const SEASON_RE = /第\s*([\d一二两三四五六七八九十]+)\s*季|\bSeason\s?(\d{1,2})\b|\bS(\d{1,2})\b/i;

// 认集数，返回 { index, length, season, episode }。
// 只有集数、文件名里也读不出季数时 season 留空，不猜第 1 季——宁可留空也不猜：
// 片名要作为背景发给翻译模型，给错比不给更糟。
function findEpisode(s) {
  let m = s.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i) || s.match(/\b(\d{1,2})x(\d{2,3})\b/);
  if (m) return { index: m.index, length: m[0].length, season: Number(m[1]), episode: Number(m[2]) };
  // 第2季 第05集 / 第二季第5话
  m = s.match(/第\s*([\d一二两三四五六七八九十]+)\s*季[\s-–]*第\s*(\d+)\s*[集话話回]/);
  if (m) return { index: m.index, length: m[0].length, season: cnNum(m[1]), episode: Number(m[2]) };
  // 只有集数：第05集 / EP05 / EP 05 / E05 / 动漫的「- 05 -」「- 05 (1080p)」
  // 单个 E 后面不许空格：「WALL-E 2008」的 E 是片名，2008 是年份，不是第 2008 集（复核补）
  m = s.match(/第\s*(\d+)\s*[集话話回]/) || s.match(/\b(?:EP\s?|E)(\d{1,4})\b/i) || s.match(/\s[-–]\s(\d{1,4})(?=\s|$)/);
  if (m) {
    // 季号只在集号前面找：后面是画质、压制组（"x264-S7"），从那里读出来的是瞎猜
    const sm = s.slice(0, m.index).match(SEASON_RE);
    return { index: m.index, length: m[0].length, season: sm ? cnNum(sm[1] || sm[2] || sm[3]) : undefined, episode: Number(m[1]) };
  }
  return null;
}

export function parseTitle(fileName, containerTitle) {
  const base = String(fileName || '').replace(/\.(mkv|mp4|webm|m4v|mov)$/i, '');
  const s = tidy(base.replace(/\[[^\]]*\]/g, ' '));
  const r = {};

  // 剧集：S01E02 / 1x02 / 第2季第05集 / 第05集 / EP05 / 动漫的「- 05」
  const ep = findEpisode(s);
  if (ep) {
    if (ep.season != null) r.season = ep.season;
    r.episode = ep.episode;
    // 片名里别带上「第二季」「Season 2」
    let show = s.slice(0, ep.index).replace(new RegExp(SEASON_RE.source, 'gi'), '').replace(/[-–\s]+$/, '');
    const after = s.slice(ep.index + ep.length).replace(/^[-–\s]+/, '');
    // 年份前面要有空格或括号隔开，「请回答1988」的 1988 是片名的一部分
    const year = show.match(/(?:^|[\s(])\(?(19\d{2}|20\d{2})\)?\s*$/);
    if (year) { r.year = Number(year[1]); show = show.slice(0, year.index); }
    r.show = tidy(show);
    const epTitle = cutJunk(after);
    if (epTitle && !/^[-–]/.test(epTitle)) r.episodeTitle = epTitle;
  } else {
    // 电影：片名 + 年份
    const m = s.match(/^(.*?)[\s(]+(19\d{2}|20\d{2})\b/);
    if (m && m[1].trim()) { r.show = tidy(m[1]); r.year = Number(m[2]); }
    else r.show = cutJunk(s);
  }

  // 文件名看不出来（比如 "video01"）而容器里写了像样的标题，就用容器的
  const generic = (x) => !x || /^(video|movie|vid|clip|file|output|untitled|新建)?[\s_-]*\d*$/i.test(x);
  const ct = containerTitle && cutJunk(String(containerTitle));
  if (ct && generic(r.show) && !generic(ct)) return { ...parseTitle(ct + '.mkv'), fromContainer: true };
  // video01 这种名字不算片名，交给 AI 反而误导
  if (generic(r.show)) return {};
  return r;
}

// 最近播放卡片上的短片名：Family Guy · S20E01 LASIK Instinct（卡片窄，「第 20 季第 1 集」太长）；电影带年份。
// 文件名认不出来（video01 这种）就用去掉扩展名的文件名，总比空着强
export function cardTitle(fileName) {
  const p = parseTitle(fileName);
  if (!p?.show) return String(fileName || '').replace(/\.(mkv|mp4|webm|m4v|mov)$/i, '');
  const pad = (n) => String(n).padStart(2, '0');
  let s = titleShow(p);
  if (p.season != null && p.episode != null) s += ` · S${pad(p.season)}E${pad(p.episode)}`;
  else if (p.episode != null) s += ` · ${t('titleEp', { e: p.episode })}`;
  if (p.episodeTitle) s += ` ${p.episodeTitle}`;
  return s;
}

// 剧名（带年份）：Family Guy（2019）。顶栏上这一截加粗（App.jsx barTitle 按它的长度从 titleLabel 里切开）
export function titleShow(p) {
  if (!p?.show) return '';
  return p.year ? t('titleShowYear', { show: p.show, year: p.year }) : p.show;
}

// 给界面看的：Family Guy · 第 20 季第 1 集「LASIK Instinct」；没有季号时只写「第 N 集」
export function titleLabel(p) {
  if (!p?.show) return '';
  let s = titleShow(p);
  if (p.season != null && p.episode != null) s += ` · ${t('titleSE', { s: p.season, e: p.episode })}`;
  else if (p.episode != null) s += ` · ${t('titleEp', { e: p.episode })}`;
  if (p.episodeTitle) s += t('titleEpName', { name: p.episodeTitle });
  return s;
}
