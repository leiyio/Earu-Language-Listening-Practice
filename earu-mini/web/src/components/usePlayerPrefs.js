import { useCallback, useState } from 'react';
import { RATES } from './ControlBar.jsx';
import { SUB_SCALES } from './subSize.js';

// 本机记住的播放偏好（速度、精听的字幕开关：开着照常出、关着打码；播放方式、字幕大小另走下面的访问器），键 earu.playerPrefs.v1。
// 浮动模式的控制区也要改速度和字幕开关，所以放在 App 里。
// 读写都包 try：无痕模式等情况下 localStorage 会抛错
const PREF_KEY = 'earu.playerPrefs.v1';
const DEFAULTS = { speed: 1, subEn: false, subZh: true };

// 记住的速度不在现在这几档里就回到 1
export function loadPrefs(storage = globalThis.localStorage) {
  let p;
  try { p = { ...DEFAULTS, ...JSON.parse(storage?.getItem(PREF_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
  if (!RATES.includes(p.speed)) p.speed = DEFAULTS.speed;
  return p;
}

// 播放方式：只记「连续播放 / 每句停」两种，单句循环不记（每部片都从没开循环开始，R 开着循环再开片不接着循环）。同样【不进 DEFAULTS】，走访问器：
//   没存过 / 存了不认识的值 → 'continuous'。只在她动手的那一下写（菜单点选、Q、R），不订阅播放器状态写盘——换片、练习里被 armLoop 顶掉的循环、
//   换字幕这些程序自己造成的变化不碰偏好；开了循环不写（偏好还是进循环之前的那个方式），从循环退出来（R / 菜单）写退出后的方式
export const playModeOf = (p) => (p?.playMode === 'stop' ? 'stop' : 'continuous');
// 字幕大小档位：控制区「字幕大小」一行选的那一档，五档 0.7 / 0.85 / 1 / 1.15 / 1.35（subSize.js 的 SUB_SCALES）。同样【不进 DEFAULTS】，走访问器：
//   没存过 / 存的不在五档里 → 1（标准）。屏幕大小、眼睛不同，字幕大小是跟着这台电脑走的，所以存在本机；
//   本地播放器的偏好只存这一份，和速度、字幕开关一样
export const subScaleOf = (p) => (SUB_SCALES.includes(p?.subScale) ? p.subScale : 1);
// 用户操作（菜单、Q、R）之后调：看播放器现在是哪种方式，连续 / 每句停就记下来，循环不记。
// locked（练习里，practiceMode.playModeLocked）一律不记：练习里只许单句循环，R 开关的只是答题用的循环、不是她挑的「播放方式」，
// 记了的话在练习里关一下循环，就把记着的「每句停」冲成「连续播放」
export function rememberPlayMode(player, setPref, locked = false) {
  if (locked) return;
  const m = player?.playModeNow?.();
  if (m === 'continuous' || m === 'stop') setPref?.('playMode', m);
}

// 返回 [prefs, setPref]；setPref(key, value | (old) => value)
export function usePlayerPrefs() {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const setPref = useCallback((k, v) => setPrefs((p) => {
    const n = { ...p, [k]: typeof v === 'function' ? v(p[k]) : v };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(n)); } catch { /* 存不了就算了 */ }
    return n;
  }), []);
  return [prefs, setPref];
}
