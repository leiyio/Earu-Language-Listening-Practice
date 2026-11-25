import { useEffect, useRef, useState } from 'react';
import { SentencePlayer } from '../core/player/sentencePlayer.js';
import { sameSentences } from '../../../shared/subAlign.js';

const INITIAL = { index: -1, active: -1, loopIndex: -1, waiting: false, loopMode: false, playMode: 'continuous', paused: true, once: -1, loops: 0, loopLocked: false };

// 视频元素换了（换文件）就重建 SentencePlayer；句子列表变了就喂进去。
// opts：{ lead, tail, gap, filter, earlyBack }，见 SentencePlayer.setOpts；另有 growing / linesKey 管句子列表怎么换（见下面喂句子那段）。
// - lead / tail / gap 不传（undefined）就用默认 0.2 / 0.2 / 1 秒，传了改了立即生效。
//   前后缓冲精听、排序都最多用到与邻句空档的一半（播放器自己夹，SentencePlayer.loopStart / loopEnd；以前排序模式另传 clamp）。
// - filter：(i, line) => boolean，自动咬住只咬它收的句子；不传 = 全收。要用 useCallback 固定住，
//   不然每次渲染都是新函数、每次都重设一遍（不出错，只是白做）。
// - earlyBack：循环到句尾一开始留白就跳回句首（边转边播的片跳一下要等一会儿，藏进留白里），见 SentencePlayer.setOpts。
// 这句能不能循环（loopGate，远程片边读边出时用）也不走 opts：要等翻译（用到这里返回的 state）出来才知道，useStudySession 另用 useEffect 设（交的是转发函数 gateFwd：渲染时就指向最新闸门，上面喂句子的效果排在它前面，换列表那一拍才不用上一版闸门）。
// 排序面板上摆着哪道题不走 opts：题号要等排序会话（用到这里返回的 player、state）算出来，App 在那之后另用
// useEffect 调 player.setFocus(mode === 'sort' ? 题号 : -1)，见 SentencePlayer.setFocus。
export function useSentencePlayer(videoRef, url, lines, opts) {
  const [player, setPlayer] = useState(null);
  const [state, setState] = useState(INITIAL);

  useEffect(() => {
    if (!url || !videoRef.current) return;
    const p = new SentencePlayer(videoRef.current);
    const unsub = p.subscribe(setState);
    setPlayer(p);
    return () => { unsub(); p.destroy(); setPlayer(null); };
  }, [url, videoRef]);

  // 句子列表变了：同一个播放器、同一份字幕只是时间变了（字幕自动校准换上 / 切回原版）→ 只换时间，循环那句照旧；
  // 同一条轨（linesKey 没变）上一份还在边读边长（growing）→ 按句子本身接过去，循环那句和它的起止照旧（SentencePlayer.swapLines）；
  // 别的（换片、换轨）整份换
  const { lead, tail, gap, filter, earlyBack, growing, linesKey } = opts || {};
  const fed = useRef({ player: null, lines: null, key: undefined, growing: false });
  useEffect(() => {
    if (!player) return;
    const f = fed.current;
    const same = f.player === player && f.lines && f.key === linesKey;
    if (same && sameSentences(f.lines, lines)) player.retime(lines);
    else if (same && f.growing) player.swapLines(lines);
    else player.setLines(lines);
    fed.current = { player, lines, key: linesKey, growing: !!growing };
  }, [player, lines, linesKey, growing]);

  useEffect(() => {
    // 换片新建的播放器也要设一遍：都放在依赖里（player 变了就重设）
    player?.setOpts({ lead, tail, gap, filter: filter || null, earlyBack: !!earlyBack });
  }, [player, lead, tail, gap, filter, earlyBack]);

  return { player, state };
}
