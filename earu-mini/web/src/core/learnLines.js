// 「学习语种代码」的几个小工具。纯函数。
// 学习语种代码 = shared/langs.js learnOf 的结果：en zh de fr ja ko tr ru es pt ar（简繁都归 zh）。
import { LANGS, learnOf } from '../../../shared/langs.js';

export const LEARN_CODES = Object.freeze([...new Set(LANGS.map(learnOf))]);
export const isLearnCode = (x) => LEARN_CODES.includes(x);
