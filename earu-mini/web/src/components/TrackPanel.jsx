import { t } from '../i18n/index.js';
import { renderLang } from '../i18n/lang.js';
import { trackIsLang, detectTextLang, playingAudio } from '../core/lang.js';
import { noLearnGap, noLearnText } from '../core/noLearn.js';

// 语言名按界面语言写（简体「法语」、繁體「法文」、English「French」，浏览器自己有这几张表）；每种界面语言建一个、记住
const langNames = new Map();
function namesFor(lang) {
  if (!langNames.has(lang)) {
    let d = null;
    try { d = new Intl.DisplayNames([lang], { type: 'language' }); } catch { /* 老浏览器 */ }
    langNames.set(lang, d);
  }
  return langNames.get(lang);
}
export function langLabel(raw) {
  if (!raw || raw === 'und') return t('langUnlabeled');
  try { return namesFor(renderLang())?.of(raw) || raw; } catch { return raw; }
}
// 编码的名字：认不出、容器里也没写的是空的（core/container/codecs.js），这里补「未知」
const codecName = (x) => x?.label || t('codecUnknown');

// learnLang：在学的语言（学习线 'en' | 'zh' | 'de' | 'fr' | 'ja' | 'ko' | 'tr' | 'ru' | 'es' | 'pt' | 'ar' | 'hi'，trackIsLang 认）。学中文时 subs 要传中文视图那份（App 的 viewSubs = {...subs, ...zhSubs}）。
// 没有能用的在学语言字幕、或者没有在学语言的声音（core/noLearn.js noLearnGap：lacksAudio，或者在放的那条明说是别的语言 audioOffLearn），都只说一句，缺哪样说哪样
// 播放中不给换声音、字幕
// note：手机上 App 另外要说的那一句（安卓放不了杜比 / DTS 的声音，core/mobile.js phoneAudio 的 mNoSound，传进来的是文字）：
// 排在最前面，和别的提示（没有英文字幕……）放在同一张卡片里——App 自己另画一张的话，手机上一屏摞两张红框
export default function TrackPanel({ tracks, meta, subs, subId, learnLang, videoError, videoOk, subsError, note = '' }) {
  if (!tracks) {
    if (!subsError) return null;
    // 视频结构读不出来（probe 失败：没下完的 MP4 报 no moov、截断的 MKV、Worker 崩了）：轨道信息永远等不来，
    // 不能一直写「正在读取视频信息…」，顶部横幅被点 × 关掉以后就只剩这句假话
    return (
      <div className="panel">
        {videoError && <div className="notice error">{t('errVideo')}</div>}
        <div className="notice error" title={subsError}>{t('probeFailed')}</div>
      </div>
    );
  }

  const video = tracks.find((x) => x.type === 'video');
  const audios = tracks.filter((x) => x.type === 'audio');
  const subTracks = tracks.filter((x) => x.type === 'subtitle');
  const notices = [];

  if (note) notices.push(['error', note]);
  if (videoError) notices.push(['error', video ? t('errVideoCodec', { codec: codecName(video) }) : t('errVideo')]);
  else if (video?.play === 'maybe' && !videoOk) notices.push(['warn', t('videoMaybe', { codec: codecName(video) })]);

  if (!audios.length) notices.push(['warn', t('noAudio')]);
  else {
    const def = playingAudio(audios);
    if (def.play === 'no') {
      const anyOk = audios.some((a) => a.play !== 'no');
      notices.push(['error', t(anyOk ? 'audioDefaultNoSound' : 'audioNoSound', { codec: codecName(def) })]);
    } else if (def.play === 'maybe') notices.push(['warn', t('audioMaybe', { codec: codecName(def) })]);
  }

  if (meta?.fragmented && subTracks.length) notices.push(['warn', t('errFragmented')]);
  // 读失败不能说成「没有在学语言的字幕」：读不了 ≠ 没有
  let noSubs = false;
  if (subs && !subsError) {
    // 按内容核对语种（lang.js trackIsLang）：标着 eng 的中文轨不算，没标语言的英文轨算
    // unread：远程片没读的轨（desktop/remoteMedia.js 只读学习语言的候选）——不算能用
    const texts = subTracks.filter((s) => s.kind === 'text' && (s.cueCount > 0 || s.unread));
    noSubs = !texts.some((s) => !s.unread && trackIsLang(s, subs[s.id], learnLang, true));
  }
  // 缺了哪样说哪样（core/noLearn.js）：声音是放得出声音的轨里没有学习语言的，或者在放的那条明说是别的语言
  const gap = noLearnGap(audios, noSubs, learnLang);
  if (gap) notices.push([noSubs ? 'error' : 'warn', noLearnText(gap)]);
  if (noSubs) {
    const images = subTracks.filter((s) => s.kind === 'image');
    if (images.length && images.length === subTracks.length) {
      notices.push(['warn', t('imageSubsOnly', { codecs: [...new Set(images.map(codecName))].join(' / ') })]);
    }
  }

  // 手动选到非英文轨：只显示原文、不翻译
  const cur = subTracks.find((s) => s.id === subId);
  if (cur && subs?.[cur.id] && !trackIsLang(cur, subs[cur.id], learnLang)) {
    const lang = detectTextLang(subs[cur.id]);
    notices.push(['warn', t('notLearnLangTrack', { lang: lang === 'und' ? t('unknownLang') : langLabel(lang) })]);
  }
  if (subsError) notices.push(['error', t('subsReadFailed'), subsError]);

  // 片名 / 字幕轨 / 音轨 / 画面四行不再显示：字幕轨照旧自动选，
  // 只在出问题时（解不了、没声音、没有在学语言的声音或字幕、读不出来）出提示，平时这一块什么都没有
  if (!notices.length) return null;
  return (
    <div className="panel">
      {notices.map(([level, text, tip], k) => <div key={k} className={`notice ${level}`} title={tip}>{text}</div>)}
    </div>
  );
}
