// 这部片缺不缺学习语言的声音、字幕，缺了怎么说——开播前那一问（desktop/LocalPlayer.jsx）、控制区（TrackPanel）、右下角气泡（NoSubsBubble）、
// 空的字幕列表（LineList）都从这里取，说法只有一套：
// 「只缺字幕：此视频没有【中文字幕】；只缺声音：此视频没有【中文音轨】；两样都缺：此视频没有【中文音轨】【和】【中文字幕】」。
// 判不准就不算缺：标记含糊（und、没写）的声音和字幕都当「可能是」，只有明说是别的语言才算没有——宁可漏说，不能把有的说成没有。
import { audioDialectOf, audioOffLearn, rankSubtitleTracks } from './lang.js';
import { langsOfSubName, nameMentions, subNameMentions } from './langTags.js';
import { shellDecodes } from './player/shellAudio.js';
import { t } from '../i18n/index.js';

// 放得出声音：浏览器自己能放，或者外部解码解得了（杜比、DTS，core/player/shellAudio.js）
const audible = (a) => a.play !== 'no' || shellDecodes(a.codec);

// 声音缺不缺：放得出声音的轨里没有一条是学习语言（学中文时粤语也不算）。learn：trackLangOf 过的（学中文是 'zh'）。
// 一条都放不出声音是另一回事（控制区另有「放不出声音」那句），不算缺；轨还不知道（平台视频没给）也不算
export function lacksAudio(tracks, learn) {
  if (!learn) return false;
  const audio = (tracks || []).filter((x) => x?.type === 'audio' && audible(x));
  if (!audio.length) return false;
  // 标记写别的语言、名字写着学习语言（eng「Español」、chi「English」）：两样对不上就当可能是；认成方言的（chi「粤语」）不翻案
  return !audio.some((a) => { const d = audioDialectOf(a); return d == null || d === learn || (d.length === 2 && nameMentions(a.name, learn)); });   // 三个字母的是方言（yue、wuu），照方言算
}

// 外挂字幕算不算学习语言的：只看文件名，不看外部给的 lang——那个 lang 也是从文件名里取的，常取错
// （Hindi.Medium.2017.srt 取成印地语、Movie.hi.srt 的 hi 可能是听障版、chs.eng 只取到中文）。
// 文件名写了语言照文件名（写了几种算几种）；写了但认不准、没写的都算「可能是」——这里说「可能有」只是先不问，读出来按内容再判
function extMaybe(s, learn, videoName) {
  const byName = langsOfSubName(s?.name || '', videoName);
  return !byName || !byName.length || byName.includes(learn) || subNameMentions(s?.name || '', learn);
}

// 缺了哪样（声音 / 字幕），一样都不缺是 null。学习会话停练、停翻、不出字幕（study/useStudySession.jsx noLearnGap）、
// 控制区那句（TrackPanel）、右下角气泡都按它：音轨或字幕缺任意一项，就不练习（听写和排序）、不翻译、不显示字幕。
// 声音：放得出声音的轨里没有学习语言的（lacksAudio），或者在放的那条明说是别的语言（audioOffLearn）；
// subsMissing：字幕读完了一条学习语言的都没有（适配器的 noLearnSubs）。轨不知道、判不准的都不算缺
export function noLearnGap(tracks, subsMissing, learn) {
  if (!learn) return null;
  const audio = lacksAudio(tracks, learn) || audioOffLearn(tracks || [], learn);
  return audio || subsMissing ? { audio, subs: !!subsMissing } : null;
}

// 缺了什么的那一句。gap：{ audio, subs } 哪样缺；ask：开播前那一问，后面接「不可用于练习。要继续播放吗？」。{learn} 跟着现在的界面语言和学习语言（i18n t()）
export function noLearnText(gap, ask = false) {
  const msg = t(gap.audio && gap.subs ? 'noLearnBoth' : gap.audio ? 'noLearnAudio' : 'noLearnSub');
  return ask ? t('noLearnAskQ', { msg }) : msg;
}
