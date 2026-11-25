import { useSyncExternalStore } from 'react';
import { getUiLang, onUiLang } from './lang.js';

// React 这一头：订阅界面语言，换了就重画（设置里点了马上全界面换过来，不刷新、不重挂）。
// App 用它整棵树跟着重画；memo 包着的组件（字幕列表的每一行、答题区、词块区）父组件重画了它们也不动，自己再订一次。
// 服务端渲染（测试、预渲染）时一律当前值（没 init 就是简体）
export function useUiLang() {
  return useSyncExternalStore(onUiLang, getUiLang, getUiLang);
}
