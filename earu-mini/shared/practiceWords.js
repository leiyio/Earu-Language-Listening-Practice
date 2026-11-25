// 一句台词按「在学语言」数出几个能练的词——「这句能不能练」的唯一出处。
// 起因：网页一直拿英文的 wordCount 判（按空格、拉丁字母切），日语一句话数出来是 0 个词：
//   日语视频 357 句只有 45 句算「能练」→ 排序面板说「这句没有日语词，不出题」、单句循环咬不住句子、练习时字幕全成雾点不开、也就没有词卡。
// 规则按语言档案（shared/langProfile.js wordSegment）分，不按某一门语言写死：
//   'dict'（不靠空格分词：日语、中文）→ 排序题的词块数（和出题同一套切法：中文 zhTiles、日语 tilesJa）；
//     以后再加这类语言，没有专门的词块函数就数切词器切出来的词（segmentWords 的 w:true）；
//   'space'（英德法西葡土俄印阿韩）→ wordCount（洗掉说话人标签、音效以后按 Unicode 字母数，西里尔、天城文、阿拉伯、谚文都认）。
// 用它的地方：练习时哪些句子能出题 / 循环能咬住（useStudySession practicable）、句子解析的词数门槛（shared/analyze.js）。
import { wordCount } from './sortText.js';
import { hasWordsZh } from './zhSort.js';
import { profileOf } from './langProfile.js';
import { tileCountOf, segmentWords, SEGMENT_LANGS } from './segment/index.js';

const base = (learn) => String(learn || 'en').toLowerCase().split('-')[0];

export function practiceWords(learn, text) {
  const l = base(learn);
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (profileOf(l).wordSegment !== 'dict') return wordCount(s);
  if (l === 'zh') return hasWordsZh(s) ? tileCountOf('zh', s) : 0;   // 中文先按排序清洗判有没有字（原来的 hasWordsZh），有才数块
  if (SEGMENT_LANGS.includes(l)) return tileCountOf(l, s);
  return (segmentWords(l, s) || []).filter((x) => x.w).length;
}

export const hasPracticeWords = (learn, text) => practiceWords(learn, text) > 0;
