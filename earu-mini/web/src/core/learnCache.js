// 在学的语言：存本机 localStorage（首页「在学语言」选了就写），没选过 = 英语。
// 首页和播放页共用这一份；订阅 onLocalLearn 可以在别处切了之后跟着变。
import { isLearnCode } from './learnLines.js';

export const LEARN_LOCAL_KEY = 'earu.learnLang';
const readLocalLearn = () => {
  try { const v = localStorage.getItem(LEARN_LOCAL_KEY); return isLearnCode(v) ? v : 'en'; } catch { return 'en'; }
};
const writeLocalLearn = (code) => {
  if (!isLearnCode(code)) return false;
  try { localStorage.setItem(LEARN_LOCAL_KEY, code); } catch { /* 无痕模式：只在这一页有效 */ }
  return true;
};
const listeners = new Set();
let current = null;
export const getLocalLearn = () => (current ??= readLocalLearn());
export function setLocalLearn(code) {
  if (!writeLocalLearn(code)) return;
  if (code === current) return;
  current = code;
  for (const f of [...listeners]) { try { f(code); } catch { /* 一个订阅者出错不挡别的 */ } }
}
export function onLocalLearn(fn) { listeners.add(fn); return () => listeners.delete(fn); }
