import { useCallback, useState } from 'react';

// 本机练习版的设置：循环的留白、排序 / 听写的显示开关、难度档，全存本机 localStorage，没有账号、没有服务器。
const SORT_KEY = 'earu.sortPrefs.v1';
const LOOP = Object.freeze({ lead: 0.2, tail: 0.2, gap: 1 });
const SORT_DEFAULTS = Object.freeze({ showZh: false, subtitle: 'sentence', mask: true, kind: 'sort' });

function load() {
  try { return { ...SORT_DEFAULTS, ...JSON.parse(localStorage.getItem(SORT_KEY) || '{}') }; }
  catch { return { ...SORT_DEFAULTS }; }
}

export function useLocalSettings() {
  const [sort, setSort] = useState(load);
  const setSortPref = useCallback((key, value) => {
    setSort((p) => {
      const n = { ...p, [key]: value };
      try { localStorage.setItem(SORT_KEY, JSON.stringify(n)); } catch { /* 存不了就只在这一页有效 */ }
      return n;
    });
  }, []);
  return { values: { loop: LOOP, sort, grade: 'middle' }, setSortPref };
}
