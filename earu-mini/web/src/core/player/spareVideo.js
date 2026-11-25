// 选好文件自动播在 iPhone 上不灵（选了文件不播，要再点播放）——这里给 Player 备一个「点过的」<video>。
//
// 为什么不灵：iPhone 的浏览器内核（WebKit；iPhone 上的 Chrome 也是它，Mac 的 Safari 同理）出声播放要「这个 video 在手指点按里 play() 过」，
// 是记在每个 video 元素身上的。Player 的 video 在选好文件以后才建，那时候早过了点按：选文件框、换盒子都要时间，
// App 等到 loadedmetadata 再 play()，被拒（NotAllowedError，静静地 catch 掉了）。
// 怎么办：页面上每点一下（click / touchend，捕获阶段，先于按钮自己的处理），手上没有备用的就建一个 video，
// 在这一下里 play() 一次再马上 pause()——没有地址，什么都不会播，但 WebKit 从此把它当成点过的；Player 建 video 时先拿这个。
// 点「选择视频文件」「最近播放」那一下就备好了，选完文件再 play() 就让播。
// 谷歌浏览器 / Edge 是按整页算「点过没有」，本来就能自动播，main.jsx 只在 WebKit 上装这个（installVideoPrimer）
let spare = null;

// 在点按里调：备一个点过的 video（已经备着就不动）
export function primeSpareVideo(doc = globalThis.document) {
  if (spare || !doc) return;
  try {
    const v = doc.createElement('video');
    v.playsInline = true;
    const p = v.play();
    v.pause();   // 不留在「播放中」：不然等地址给上，它会自己播起来，播放器以为是用户点的
    p?.catch?.(() => { /* 没有地址、又马上暂停：一定被拒，正常 */ });
    spare = v;
  } catch { /* 建不了就算了，Player 自己建 */ }
}

// Player 建 video 时调：有备好的拿备好的，没有就新建一个
export function takeVideo(doc = globalThis.document) {
  const v = spare || doc.createElement('video');
  spare = null;
  v.playsInline = true;
  return v;
}

// 页面打开时装一次（main.jsx）：每次点按都看看要不要备一个。返回卸掉的函数（测试用）
export function installVideoPrimer(win = globalThis.window) {
  const doc = win?.document;
  if (!doc) return () => {};
  const f = () => primeSpareVideo(doc);
  doc.addEventListener('click', f, true);
  doc.addEventListener('touchend', f, true);
  return () => { doc.removeEventListener('click', f, true); doc.removeEventListener('touchend', f, true); };
}

