// 排序 / 听写题目编号用的字幕指纹：同一份字幕（同一个合句版本、同一种原文语言）永远算出同一个编号。纯本机计算。
import { MERGE_VER, MERGE_VER_M5, MV_M5 } from './subtitle/sentences.js';
import { MERGE_VER_ZH } from '../../../shared/zhText.js';
import { isZhSrc } from '../../../shared/langs.js';

// 合句版本按原文语种分开：中文是 zm2；别的原文看第一句的 mv（m5 / m4）
export const mergeVerOf = (srcLang, lines = null) => (isZhSrc(srcLang) ? MERGE_VER_ZH : lines?.[0]?.mv === MV_M5 ? MERGE_VER_M5 : MERGE_VER);

// items：整句列表（{text, mv?}）或整句原文数组（字符串）
export const subsKey = (srcLang, items) => subsKeyOf(
  mergeVerOf(srcLang, typeof items?.[0] === 'string' ? null : items),
  srcLang,
  items.map((x) => (typeof x === 'string' ? x : x.text)),
);

export async function subsKeyOf(mergeVer, srcLang, texts) {
  const data = new TextEncoder().encode(`${mergeVer}\n${srcLang}\n${texts.join('\n')}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
