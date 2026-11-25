// 听写答案框里空格、退格、左右键往哪一格走。纯函数，不碰 DOM、不碰会话：
// DictPanel 拿会话里各格的字（cells）和对错（verdict，session.getVerdict）来问，dictation-test 直接测。
//
// 两个阶段，看 verdict 里有没有错的格子（fixing）：
//   打字（还没回车判过）：空格跳到「从当前格起第一个空着的格子」；当前格本身空着，就找它后面的空格子，没有就去下一格（不会的词先空着往后打）。
//     在最后一格、或者格子全填满了，按空格 = 交卷（一起判）
//   改错（判过、没全对）：光标只在错的格子之间走，对的格子进不去。刚判完的第一下按键清空第一个错的格子（空格、退格只清空，字母直接打进去，
//     DictPanel 的 fresh）；之后空格清空下一个错的格子并跳过去，已经是最后一个错的格子就再判；退格在空格子里回上一个错的格子；左右键只在错的格子之间跳
// 错的格子 = 'bad'（打错）/ 'empty'（没打）/ 'fixed'（判错以后重打过、还没再判，蓝色）

export const isWrong = (v) => !!v && v !== 'ok';
export const fixing = (verdict, n = verdict.length) => {
  for (let i = 0; i < n; i++) if (isWrong(verdict[i])) return true;
  return false;
};

// 从第 k 格往 dir（+1 / -1）方向找下一个错的格子；没有是 -1
export function wrongFrom(verdict, k, dir, n = verdict.length) {
  for (let i = k + dir; i >= 0 && i < n; i += dir) if (isWrong(verdict[i])) return i;
  return -1;
}

// 打字阶段按空格：{check: true} 交卷，或 {to} 跳到第几格
// locked(i)：这一格锁着（预填的、回车判对的）光标进不去；不传就是都不锁。锁着的格子里有字，所以「找空格子」本来就绕开它们，
// 只有「当前格后面都不是空的、顺手去下一格」这条退路要自己绕开；后面没有能去的格子就交卷
export function typingSpace(cells, k, n, locked) {
  const empty = (i) => !cells[i];
  if (k >= n - 1) return { check: true };
  let first = -1;
  for (let i = 0; i < n && first < 0; i++) if (empty(i)) first = i;
  if (first < 0) return { check: true };
  let to = -1;
  if (empty(k)) {
    for (let i = k + 1; i < n && to < 0; i++) if (empty(i)) to = i;
    if (to < 0) {
      for (let i = k + 1; i < n && to < 0; i++) if (!locked?.(i)) to = i;
      if (to < 0) return { check: true };
    }
  } else {
    for (let i = k; i < n && to < 0; i++) if (empty(i)) to = i;
    if (to < 0) to = first;
  }
  return { to };
}

// 改错阶段按空格：已经是最后一个错的格子 → {check: true} 再判；否则 {to: 下一个错的格子, clear: true}（清空再跳过去）
export function fixSpace(verdict, k, n) {
  const to = wrongFrom(verdict, k, 1, n);
  return to < 0 ? { check: true } : { to, clear: true };
}
