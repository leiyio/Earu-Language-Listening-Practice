import { createRoot } from 'react-dom/client';
import '../styles.css';
import '../desktop/desktop.css';
import './lite.css';
import { mountFog } from '../components/subFog.js';
import LiteApp from './LiteApp.jsx';
import { initUiLang, onUiLang, uiDir } from '../i18n/lang.js';
import { loadUiPack } from '../i18n/index.js';
import { loadConfig } from '../core/ai/index.js';

// 本机练习版的入口：先定界面语言（本机记的 > 浏览器语言）、拉那种语言的文案再画首页。纯静态，不联网。
loadConfig(); // 开发者在 config.json 里填了 AI 接口才有译文；没填、读不到都当没开
const uiLang = initUiLang();
document.documentElement.lang = uiLang;
document.documentElement.dir = uiDir(uiLang);
onUiLang((l) => {
  document.documentElement.lang = l;
  document.documentElement.dir = uiDir(l);
});
loadUiPack(uiLang).catch(() => null).finally(() => {
  mountFog();
  createRoot(document.getElementById('root')).render(<LiteApp />);
});
