// 长句固定显示哪几个词：听写的「预填」、排序的「预摆」同一套。
// 挑几个、挑哪几个都在这一个文件里，两边的会话只问结果；排序那头按词位换算成词块（core/sort/puzzle.js buildPuzzle）。
//
// 几个：core/presetRule.js presetCountFor 那张表——句子超过 free 个词才开始，之后每多 every 个词多 1 个，free / every 看难度档：
//   入门 6/2、基础 8/2、进阶 10/3、挑战 12/4。15 词：入门 5、基础 4、进阶 2、挑战 1。数的是词位数（slots.length，
//   twenty five 这种数字算一个），不是原文词数。最多固定到只剩 1 个词位，总得留点给她做。
// 挑哪几个（先后顺序，数够了就停）：
//   1. 句首、句尾两个词位（名额只有 1 个时只给句首）；
//   2. 人名（句中大写开头的专名，core/dictation/rare.js nameFlags）——听得出来、拼不出来；
//   3. 比当前难度档更难的词（wordBandOf > 难度档的档），越生僻越先；词频表还没加载好时这一步跳过；
//   4. 剩下的往句子里均匀撒：每次挑离已选的词最远的那个。
// 人名、生僻词只对有词频表的语言（langRules.js hasWordRank：英语、西语）：没有表的语言几乎每个词都会被当成生僻词；德语名词都大写开头，会被当成人名。
// 西语：难词表是西语表面形词频（wordRank.es.gen.js），档位按「词次占比」和英语对齐，规则一样；
// 人名按句中大写开头认，称呼 / 缩写 / 引号见 langRules.js。别的语言（法语……排序）只走第 1、4 步。学中文的排序是另一套（core/sort/puzzleZh.js），不走这里。
// 同一句、同一个难度档，每次挑出来的都是同一批：随机只用来在「同样好」的词里分先后，
// 种子是这一句的文字（词位的小写写法连起来，大小写恢复前后一样），presetSeed / seededRandom 在 core/presetRule.js。
import { presetCountFor, presetSeed, seededRandom } from '../presetRule.js';
import { gradeBandOf, wordBandOf, nameFlags } from './rare.js';
import { hasWordRank, namesByCase } from './langRules.js';

// slotCount：词位数；lang：学的语言（不传当英语；听写能做的语言见 shared/langs.js canDictate）
export function prefillCount(slotCount, grade, lang = 'en') {
  const n = Number(slotCount) || 0;
  return Math.max(0, Math.min(presetCountFor(n, grade, lang), n - 1));
}

// layout：layoutOf 的结果 {slots, parts}（core/dictation/judge.js）；grade：primary / middle / high / college，不传按基础；
// lang 同上。返回要固定的词位序号（从小到大）
export function pickPresets(layout, grade, lang = 'en') {
  const slots = layout?.slots || [];
  const n = slots.length;
  const want = prefillCount(n, grade, lang);
  if (!want) return [];

  const rnd = seededRandom(presetSeed(slots.map((s) => s.norm).join(' ')));
  const luck = slots.map(() => rnd());           // 每个词位一个固定的「手气」：同档同类的词按它分先后
  const ranked = hasWordRank(lang);
  const names = namesByCase(lang) ? nameFlags(layout, lang) : slots.map(() => false);   // 句中大写开头认人名（档案 nameByCase；德语、没有大小写的文字不认）
  const gb = gradeBandOf(grade);
  // 数字词位（twenty five、25）不当生僻词
  const band = slots.map((s) => (!ranked ? null : s.value != null ? 1 : wordBandOf(s.text, lang)));

  const all = slots.map((_, k) => k);
  const byLuck = (a, b) => luck[a] - luck[b];

  const picked = [];
  const take = (list) => {
    for (const k of list) {
      if (picked.length >= want) return;
      if (!picked.includes(k)) picked.push(k);
    }
  };
  take([0, n - 1]);
  take(all.filter((k) => names[k]).sort(byLuck));
  take(all.filter((k) => !names[k] && band[k] !== null && band[k] > gb).sort((a, b) => band[b] - band[a] || byLuck(a, b)));

  // 均匀撒：离已选的最远的先（句首一定已经选了）
  while (picked.length < want) {
    let best = -1;
    let bestGap = -1;
    for (const k of [...all].sort(byLuck)) {
      if (picked.includes(k)) continue;
      let gap = Infinity;
      for (const p of picked) gap = Math.min(gap, Math.abs(k - p));
      if (gap > bestGap) { best = k; bestGap = gap; }
    }
    if (best < 0) break;
    picked.push(best);
  }
  return picked.sort((a, b) => a - b);
}
