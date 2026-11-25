// 排序题：出题、摆放、判对、提示。全是纯函数——输入旧题目、返回新题目，不碰 DOM、不读时钟，Node 里能直接测。
// 没有变化（被锁挡住、目标不合法、已排对……）一律原样返回同一个对象，界面可以拿 === 判断要不要重画。
// 规则照（C:行号），出处和「为什么」写在每段前面；01-排序练习.md §1.4、§2.2~§2.4 是对照说明。
//
// 题目长这样：
// {
//   id,          // 题目身份 `${字幕指纹}:${句号}`（时间轴不会校准，key 不会变，不会有「key 一变状态全丢」的坑）
//   text,        // 洗过的句子（sortText），界面传进来的是恢复大小写后的文字时就是恢复后的
//   shown, orig, // 出题时传进来的显示文字（没洗）和原文（没恢复大小写；没传就等于 shown）。说话人标签按原文判
//                //   （sortText 第二个参数，s2），重新打乱、换字都拿它俩重洗，和服务端按原文数词逐词对齐
//   parts,       // 句子模板 [{type:'literal', text} | {type:'slot', text, slotIndex}]，literal 里可能有 \n（多人对白；答题区不按它换行）
//   original,    // 按句子顺序的词块 [{id, i, text, preset?}]；i = 第几个词，preset = 预摆的
//   answer,      // 答案区，长度 = 词数，下标 = 空位，空位是 null
//   bank,        // 词块区（打乱的，不含预摆的词）
//   preset,      // 预摆词占住的空位下标（升序数组）
//   solved, touched, hinted,
//   hint,        // 提示那 2 秒里是 {answer, bank}（她自己的排法的快照），平时是 null
// }
// 中文题（学中文第一期 B7）在 puzzleZh.js：buildPuzzle、reshuffle、retext 开头各一行分派过去，题目多一个 zh 字段；
// 摆放、判对、提示、拖放几何中英共用这里。英文题不传 zh，走的还是下面原来的代码，题目对象一个字段都不多。
import { sortText, tokenize, parseTemplate } from '../../../../shared/sortText.js';
import { buildPuzzleZh, reshuffleZh, retextZh } from './puzzleZh.js';
import { presetCountFor, presetSeed, seededRandom } from '../presetRule.js';
import { pickPresets } from '../dictation/prefill.js';
import { layoutOf } from '../dictation/judge.js';

export const DROP_SNAP_RADIUS = 72;      // C:5789 答案区按坐标就近吸附的半径（px）
export const DROP_SNAP_X_WEIGHT = 1.7;   // C:5824 横向距离的权重：宁可吸到同一行，也不跨行
export const ZONE_SNAP_RADIUS = 120;     // C:5872 落在两个区之间的缝隙、标签行上，算进 120px 内最近的那个区

export const puzzleId = (key, i) => `${key}:${i}`;

// ---- 判对 ----
// 逐位比文本、不比是不是同一个词块：一句里两个 the，哪个放前面都算对；预摆了其中一个，另一个照样能填。
// 不分大小写、弯直撇号不分。标点是模板里的固定文字，不参与。
export function normalizeToken(token) {
  return String(token ?? '').replace(/’/g, "'").toLocaleLowerCase('en-US');
}

export function isCorrectOrder(answer, original) {
  return answer.length === original.length
    && answer.every((t, i) => t && normalizeToken(t.text ?? t) === normalizeToken(original[i]?.text ?? original[i]));
}

// ---- 打乱 ----
// Fisher–Yates；打乱完恰好和原顺序逐位相同（比文本、不分大小写）就把前两个对调——所以两个词的句子总是倒着给。
// random 从外面传。
export function shuffleTokens(tokens, random = Math.random) {
  const out = [...tokens];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && isCorrectOrder(out, tokens)) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

// 种子（presetSeed，FNV-1a）和定种子的随机数（seededRandom，mulberry32）挪到了 core/presetRule.js，这里照旧转出（测试、puzzleZh.js 从这里拿）
export { presetSeed, seededRandom };

// 英文等（不是中文）题固定哪几个词：照听写的词位表（core/dictation/judge.js layoutOf，同一个 sortText + 切词规则，
// 词和词位一一对上）挑，挑出的词位换算回词的下标——一个数字词位（twenty five）占几个词就固定几个词块。
// shown / source 同 buildPuzzle 里的显示文字、原文；wordCount 是这道题的词数，对不上（不该发生）就一个都不摆
export function presetWordIndexes(shown, source, grade, lang = 'en', wordCount) {
  const layout = layoutOf(shown, source, lang);
  const picks = new Set(pickPresets(layout, grade, lang));
  const out = [];
  let w = 0;
  layout.slots.forEach((s, k) => {
    if (picks.has(k)) for (let j = 0; j < s.span; j += 1) out.push(w + j);
    w += s.span;
  });
  return wordCount == null || w === wordCount ? out : [];
}

// ---- 出题 ----
// text 传句子原文就行（可以是恢复大小写后的），里面会先 sortText；剥完没词返回 null（不出题）。
// text 是恢复大小写后的文字时，orig 传这句的原文（rawLines[i].text）：说话人标签按原文判（「Doug's mother:」在原文里是
// 「DOUG'S MOTHER:」才认得出），空位数才和服务端 wordCount(原文) 一样（s2）。
// 预摆的词一开始就坐在 answer 的正确空位上、不进词块区；词块区只打乱她要排的那些。
// 同一句「重新打乱」也走这里（reshuffle）：预摆的位置不变（种子是文字），打乱顺序变。
// zh 为真出中文题（anno = 这一句的标注，没标到不传），见 puzzleZh.js
// grade：难度（primary / middle / high / college），由它定预摆几个、哪些词算「更难」；lang：学的语言（不传＝英语，只有英语看人名和生词）。
// 两个都不放进题目对象里（en-golden 整题哈希，多一个字段全红），由会话记着、每次出题传进来。不传 grade＝基础。中文题不看它们
export function buildPuzzle({ id, text, orig, random = Math.random, zh, anno, grade, lang }) {
  if (zh) return buildPuzzleZh({ id, text, orig, random, anno, lang, grade });
  const shown = String(text ?? '');
  const source = orig == null ? shown : String(orig);
  const clean = sortText(shown, source);
  const words = tokenize(clean);
  if (!words.length) return null;
  const slots = presetWordIndexes(shown, source, grade, lang, words.length);
  const presetSet = new Set(slots);
  // 词块 id 带上题目 id：React 的 key 用它，换句不会撞上一句的词块（01 §4 第 1 条：词块要有稳定的 key）。
  // 同一句重新打乱 id 不变，界面只是挪位置
  const original = words.map((w, i) => (presetSet.has(i)
    ? { id: `${id}#${i}`, i, text: w, preset: true }
    : { id: `${id}#${i}`, i, text: w }));
  const answer = Array(original.length).fill(null);
  for (const s of slots) answer[s] = original[s];
  return {
    id,
    text: clean,
    shown,
    orig: source,
    parts: parseTemplate(clean),
    original,
    bank: shuffleTokens(original.filter((t) => !t.preset), random),
    answer,
    preset: slots,
    solved: false,
    touched: false,
    hinted: false,
    hint: null,
  };
}

// 「重新打乱」：重建这一题，预摆不变。已排对的也能重来。
// 拿存下的显示文字 + 原文重洗，不拿洗过的 p.text 单独再洗：那样标签就只能按显示的文字判了（s2）。
// 中文题照它手上的词块重摆（opts.anno：会话记着的这句最新标注，见 puzzleZh.js reshuffleZh）
// 英文题 opts.grade＝此刻的难度：中途改了难度再点「重新打乱」就按新难度摆（和「下一句起生效」不冲突，这是她自己要重来）；opts.lang 同 buildPuzzle
export function reshuffle(p, random = Math.random, opts) {
  if (p?.zh) return reshuffleZh(p, random, opts);
  return p ? buildPuzzle({ id: p.id, text: p.shown ?? p.text, orig: p.orig, random, grade: opts?.grade, lang: opts?.lang }) : p;
}

// 同一题换显示文字（恢复大小写的结果晚到）：她的排法、预摆、提示状态原样保留，只换每个词块上的字。
// orig 不传就用出题时存下的原文（先按原文出题、恢复后的文字晚到，正是这种情况）。
// 新文字切出来的词和原来的对不上（不只是大小写不同）就返回 null，调用方应该当成新题重出。
// 例外：她还没碰过（没动过、没看过提示、没排对）的题，预摆跟听写一样按新文字重挑——全大写时一个人名都认不出，
// 恢复大小写以后才认得出来，不重挑的话这一句排序和听写固定的词就不一样了。opts {grade, lang, random} 同 buildPuzzle。
// 中文题（或这回要的是中文题，opts.zh）：看词块签名，见 puzzleZh.js retextZh
export function retext(p, text, orig, opts) {
  if (p?.zh || opts?.zh) return retextZh(p, text, orig, opts);
  if (!p) return p;
  const shown = String(text ?? '');
  const source = orig == null ? (p.orig ?? shown) : String(orig);
  const clean = sortText(shown, source);
  if (clean === p.text) return p;
  const words = tokenize(clean);
  if (words.length !== p.original.length
    || words.some((w, k) => normalizeToken(w) !== normalizeToken(p.original[k].text))) return null;
  const re = (t) => (t && t.text !== words[t.i] ? { ...t, text: words[t.i] } : t);
  const next = {
    ...p,
    text: clean,
    shown,
    orig: source,
    parts: parseTemplate(clean),
    original: p.original.map(re),
    // 排对之后答案区按空位显示原句写法（见 finish），所以按空位换，不按词块
    answer: p.solved ? p.answer.map((t, k) => (t && t.text !== words[k] ? { ...t, text: words[k] } : t)) : p.answer.map(re),
    bank: p.bank.map(re),
    hint: p.hint && { answer: p.hint.answer.map(re), bank: p.hint.bank.map(re) },
  };
  if (p.touched || p.solved || p.hint || p.hinted) return next;
  const slots = presetWordIndexes(shown, source, opts?.grade, opts?.lang, words.length);
  if (slots.length === p.preset.length && slots.every((k, j) => k === p.preset[j])) return next;
  return represet(next, slots, opts?.random ?? Math.random);
}

// 没碰过的题换一批预摆（retext 用）：新固定的词从词块区拿走、坐到它的空位上；原来固定、现在要她排的词插进词块区的随机位置；
// 别的词块在词块区里的先后不动——她看着的那一排不整个重新打乱。词块 id 不变
function represet(p, slots, random) {
  const set = new Set(slots);
  const original = p.original.map((t) => (set.has(t.i) ? { id: t.id, i: t.i, text: t.text, preset: true } : { id: t.id, i: t.i, text: t.text }));
  const bank = p.bank.filter((t) => !set.has(t.i)).map((t) => original[t.i]);
  for (const t of original) {
    if (!set.has(t.i) && p.original[t.i].preset) bank.splice(Math.floor(random() * (bank.length + 1)), 0, t);
  }
  const rest = original.filter((t) => !t.preset);
  if (bank.length > 1 && isCorrectOrder(bank, rest)) [bank[0], bank[1]] = [bank[1], bank[0]];
  return { ...p, original, answer: original.map((t) => (t.preset ? t : null)), bank, preset: slots };
}

// ---- 摆放 ----
// 能不能动：已排对（C:5670 puzzle.solved 早退）、提示那 2 秒都动不了。
const frozen = (p) => !p || p.solved || Boolean(p.hint);

function locate(p, tokenId) {
  for (const zone of ['bank', 'answer']) {
    const index = p[zone].findIndex((t) => t?.id === tokenId);
    if (index >= 0) return { zone, index, token: p[zone][index] };
  }
  return null;
}

// 每次移动之后：记「动过」，判一次对。没有提交按钮，最后一个词放对的那一刻自动判对；
// 排错不提示（没有红色、不晃）。
// 【有意改动 4】判对后答案区按空位换成原句的写法：她排的那一套 the / The 位置反了也判对，显示就会是反的
// 判对规则本身不变；词块的 id 不变（她的词块原地不动，只换上面的字）。
function finish(p, answer, bank) {
  const next = { ...p, answer, bank, touched: true };
  if (!isCorrectOrder(answer, p.original)) return next;
  next.solved = true;
  next.answer = answer.map((t, k) => (t.text === p.original[k].text ? t : { ...t, text: p.original[k].text }));
  return next;
}

// 放进某个空位（moveTokenToAnswerSlot）。目标位有词就交换；预摆的位置顶不掉，预摆的词拿不起来。
export function placeInSlot(p, tokenId, slotIndex) {
  if (frozen(p) || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= p.answer.length) return p;
  if (p.preset.includes(slotIndex)) return p;
  const src = locate(p, tokenId);
  if (!src || (src.zone === 'answer' && src.index === slotIndex)) return p;
  if (src.token.preset) return p;
  const occupied = p.answer[slotIndex];
  if (occupied) return swapTokens(p, tokenId, occupied.id);
  const answer = [...p.answer];
  let bank = p.bank;
  if (src.zone === 'bank') bank = p.bank.filter((_, k) => k !== src.index);
  else answer[src.index] = null;
  answer[slotIndex] = src.token;
  return finish(p, answer, bank);
}

// 退回词块区、排到最后（moveTokenToBank）。词块区里的词拖到词块区空白处也走这里（挪到最后）。
export function returnToBank(p, tokenId) {
  if (frozen(p)) return p;
  const src = locate(p, tokenId);
  if (!src || src.token.preset) return p;
  if (src.zone === 'bank' && src.index === p.bank.length - 1) return p;   // 本来就在最后，什么都没变
  const answer = src.zone === 'answer' ? p.answer.map((t, k) => (k === src.index ? null : t)) : p.answer;
  const bank = [...p.bank.filter((t) => t.id !== tokenId), src.token];
  return finish(p, answer, bank);
}

// 两个词交换（swapPuzzleTokens）：答案区↔答案区互换；词块区的词拖到答案区的词上，
// 答案区那个词回词块区、占拖出来那个词原来的位置；词块区里两个词换序（也算动过题）。预摆的词不参与交换。
export function swapTokens(p, firstId, secondId) {
  if (frozen(p) || !firstId || !secondId || firstId === secondId) return p;
  const a = locate(p, firstId);
  const b = locate(p, secondId);
  if (!a || !b || a.token.preset || b.token.preset) return p;
  const lists = { bank: [...p.bank], answer: [...p.answer] };
  lists[a.zone][a.index] = b.token;
  lists[b.zone][b.index] = a.token;
  return finish(p, lists.answer, lists.bank);
}

// 落进某个区但没对准任何位置（movePuzzleToken）：词块区 → 退回最后；答案区 → 第一个空位（没空位就不动）。
export function moveToZone(p, tokenId, zone) {
  if (frozen(p)) return p;
  if (zone === 'bank') return returnToBank(p, tokenId);
  if (zone !== 'answer') return p;
  const first = p.answer.findIndex((t) => !t);
  return first >= 0 ? placeInSlot(p, tokenId, first) : p;
}

// 点一下（moveTokenByClick）：词块区的词 → 答案区从左数第一个空位（没空位就什么都不发生）；
// 答案区的词 → 退回词块区最后。点答案区的空位什么都不发生（界面别调这里）。
export function clickToken(p, tokenId) {
  if (frozen(p)) return p;
  const src = locate(p, tokenId);
  if (!src) return p;
  if (src.zone === 'answer') return returnToBank(p, tokenId);
  const first = p.answer.findIndex((t) => !t);
  return first >= 0 ? placeInSlot(p, tokenId, first) : p;
}

// 拖完松手（handleTokenDrop 的后半）。drop 是 resolveDrop 的结果 {zone, target}：
//   target.blocked      正对着预摆的词松手 → 什么都不发生（她没要求的事不能替她做）
//   target.slotIndex    空位 → 放进去
//   target.tokenId      某个词 → 交换（落在自己身上什么都不发生）
//   没有 target         按区处理（moveToZone）
export function dropToken(p, tokenId, drop) {
  if (frozen(p) || !drop) return p;
  const { zone, target } = drop;
  if (target?.blocked) return p;
  if (target?.slotIndex != null) return placeInSlot(p, tokenId, Number(target.slotIndex));
  if (target?.tokenId) return target.tokenId === tokenId ? p : swapTokens(p, tokenId, target.tokenId);
  return moveToZone(p, tokenId, zone);
}

// ---- 拖放的几何计算：只算数，DOM 留给界面 ----
// rect 就是 getBoundingClientRect() 那几个字段 {left, top, right, bottom}。宽高都是 0 的（没显示出来的）跳过。
// 词位只有 20 多 px 高、行高 38px，上下都是死区，只看 event.target 的话松手偏几像素
// 就落到外层、被塞进第一个空位（表现为经常拖不进去 / 拖错位置）。所以按坐标就近吸附，拖动中实时高亮落点。
export const BLOCKED = Object.freeze({ blocked: true });

function outside(r, x, y) {
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
  return [dx, dy];
}
const shown = (r) => r && (r.right - r.left || r.bottom - r.top);
const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

// 答案区里吸到哪（dropTargetAt）。targets 按 DOM 顺序：空位 {rect, slotIndex}、词 {rect, tokenId, preset?}。
// 返回命中的那个 target、BLOCKED（正对着预摆的词）、或 null（72px 内什么都没有）。
// 预摆的词分两种：坐标正落在它框里 → BLOCKED，松手什么都不发生——不这么写就会就近吸到旁边的空位、
// 左右都摆满时还会和邻居交换，把她排好的词踢回词块区；只是路过 → 跳过它，吸到旁边真能放的位置，
// 不跳过的话拖过去会高亮「要落这儿」、松手却什么都不发生，比拖不动还糟。
export function snapTarget(targets, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const t of targets || []) {
    const r = t?.rect;
    if (!shown(r)) continue;
    const hit = inside(r, x, y);
    if (t.preset) {
      if (hit) return BLOCKED;
      continue;
    }
    if (hit) return t;
    const [dx, dy] = outside(r, x, y);
    const distance = Math.hypot(dx * DROP_SNAP_X_WEIGHT, dy);
    if (distance < bestDistance) { bestDistance = distance; best = t; }
  }
  return bestDistance <= DROP_SNAP_RADIUS ? best : null;
}

// 落在哪个区（zoneAt）：zones = [{zone: 'answer' | 'bank', rect}]。在框里直接算；否则 120px 内最近的（不加权）。
// 拖动途中划过标签行、两区之间的缝隙时也要算进最近的区，不然光标一路显示「禁止」（M§10 L2356）。
export function nearestZone(zones, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const z of zones || []) {
    const r = z?.rect;
    if (!shown(r)) continue;
    if (inside(r, x, y)) return z.zone;
    const [dx, dy] = outside(r, x, y);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) { bestDistance = distance; best = z.zone; }
  }
  return bestDistance <= ZONE_SNAP_RADIUS ? best : null;
}

// 拖动中 / 松手时的落点（handleTokenDragOver + handleTokenDrop 的判定部分）。
//   under：指针正下方的元素归属（界面用 elementFromPoint 取，要先排除跟着手走的那个拖影）：
//          {zone, slotIndex?, tokenId?, preset?}，不在任何区里就传 null
//   zones、targets：见 nearestZone、snapTarget（targets 只要答案区的）
// 返回 {zone, target} 或 null（离两个区都太远：松手什么都不做，拖动中显示「禁止」）。
// 先按区：指针下就是某个区就用它，否则就近；答案区里按坐标吸附，吸不到再退回「正下方那个空位 / 词」。
// 拖动中的高亮：zone === 'answer' 且 target 不是 BLOCKED 时高亮 target（空位变绿框、词变绿底表示要交换），词块区不高亮。
export function resolveDrop({ x, y, zones, targets, under }) {
  const zone = under?.zone || nearestZone(zones, x, y);
  if (!zone) return null;
  let target = zone === 'answer' ? snapTarget(targets, x, y) : null;
  if (!target && under && (under.slotIndex != null || under.tokenId)) target = under.preset ? BLOCKED : under;
  return { zone, target };
}

// ---- 提示 2 秒 ----
// 整句正确答案直接摆进答案区的空位，2 秒后原样还原她自己的排法。快照只在进入提示时拍一次（提示中不能再进），
// 跟着这一道题走：换句、重新打乱都是新题目，没有快照，到点也就不会把上一句的排法糊到新句上。
// 提示期间不判对，也不许动（frozen）。预摆的词在快照里还在原位、还锁着（标记在词块上）。
// 冷却、计时、记 hints 在 session.js。
export function startHint(p) {
  if (!p || p.solved || p.hint) return p;
  return { ...p, hinted: true, hint: { answer: p.answer, bank: p.bank }, answer: [...p.original], bank: [] };
}

export function endHint(p) {
  if (!p || !p.hint) return p;
  return { ...p, answer: p.hint.answer, bank: p.hint.bank, hint: null };
}

// 她是不是正在排这一句（selectCueAtCurrentTime 的 workInProgress）：答案区里有她自己放的词、还没排对。
// 预摆的词不算——不然 >8 词的句子恒为「在排」，播放头进了空档面板永远不清。
// 提示那 2 秒里算在排（那时答案区是整句，也按「在排」算）。
export function isInProgress(p) {
  if (!p || p.solved) return false;
  return Boolean(p.hint) || p.answer.some((t) => t && !t.preset);
}
