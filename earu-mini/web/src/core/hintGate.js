// 「提示一下」的读秒闸门：排序、听写共用一处。
// 答题区（排序的词块、听写的答案框）真的摆在她眼前满 HINT_GATE_MS 以后才给点「提示」「眼睛」、偷看译文；按钮上读秒「提示 · 还有 N 秒」。
// 不依赖 React、不碰 DOM；时钟从外面注入（{now}），Node 里用假的测。
//
// 计时规矩（排序原有细节，听写照搬）：
//   · 从「答题区真的在她眼前」那一刻起算——不是从出题、也不是从选中句子：正常看片时答题区收着，从选中起算等于白送。
//     「在眼前」由界面判断后告诉会话的 visible（面板展开、标签页在前台、不是只剩画中画小窗、词块 / 答案框摆出来了）。
//   · 每句只打一次时间戳：同一句收起再展开不重新计时，重新打乱也不重新计时；换句重新起算；起算之后就不再管看不看得见。
//   · 这一句还没露过面 = 一秒都还没走，回满。
export const HINT_GATE_MS = 10000;

export function createHintGate(clock) {
  let key = '';
  let at = 0;

  // 看得见、有题、这一句还没打过时间戳就打一次。会话在「新出题」「可见性变了」两处调
  function stamp(visible, id) {
    if (visible && id && key !== id) {
      key = id;
      at = clock.now();
    }
  }

  // 还要等多久（毫秒）。没有题或这一句没露过面回满
  function leftMs(id) {
    if (!id || key !== id) return HINT_GATE_MS;
    return Math.max(0, HINT_GATE_MS - (clock.now() - at));
  }

  // 只管「读秒」这一段：{state: 'waiting', leftSec}（向上取整）或 {state: 'ready', leftSec: 0}。
  // none / solved / showing / hidden 这几种由各会话自己先判，再来问这里
  function status(id) {
    const left = leftMs(id);
    return left > 0 ? { state: 'waiting', leftSec: Math.ceil(left / 1000) } : { state: 'ready', leftSec: 0 };
  }

  // 距下一次秒数变化还有多少毫秒（会话据此定个定时器重画：她做题时视频多半暂停，没有 timeupdate 驱动）
  function nextTickMs(id) {
    return leftMs(id) % 1000 || 1000;
  }

  return { stamp, leftMs, status, nextTickMs };
}
