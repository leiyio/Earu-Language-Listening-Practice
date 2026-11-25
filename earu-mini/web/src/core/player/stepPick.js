// 上一句 / 下一句挑目标句的纯函数（首尾不环绕；练习里先找下一个可练的句子，找不到就不动）。
// 不碰播放器、不碰界面，只做一件事：从 start 起（含 start）沿 dir 方向，在 [lo, hi] 里找第一个 ok(i) 为真的下标，
// 找不到返回 -1。start 本身在 [lo, hi] 外（已经走到头）也是 -1——不绕到另一头。
// ok 不传 = 每句都行。永远不会返回 ok 说不行的句子（练习里不会停在剥完没词的句子上）。
export function pickStep(start, dir, lo, hi, ok) {
  if (!Number.isInteger(start)) return -1;
  const d = dir < 0 ? -1 : 1;
  for (let i = start; i >= lo && i <= hi; i += d) {
    if (!ok || ok(i)) return i;
  }
  return -1;
}
