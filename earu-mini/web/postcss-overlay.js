// 叠加层样式改写（PostCSS 插件，只在 vite.overlay.config.js 里用）：网站的 styles.css 是写给整个页面的（:root、html、body、#root），
// 叠加层的界面挂在 B 站页面里一个 closed 的 shadow root 里，这几个选择器要改写成 shadow DOM 里认得的写法：
//   :root / html（含 :lang()、[dir]、[data-tr]、.is-mobile 等）→ :host(…)    —— 宿主元素上由 OverlayApp 写 lang / dir / data-tr
//   body / #root                                                              → .ov-root  —— 叠加层根容器
//   :lang(x)                                                                  → [lang|="x"]（宿主元素上的 lang 属性）
//   .stage:fullscreen                                                         → .ov-fs .stage（全屏的是 B 站播放器容器，不是舞台；叠加层根在全屏时带 ov-fs）
// 其余选择器原样。网站里的样式表不动，改写在构建时做。
const COMPOUND_PART = '(?:\\[[^\\]]*\\]|:[\\w-]+(?:\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\))?|\\.[\\w-]+)';
const HEAD_RE = new RegExp(`^(html|:root)(${COMPOUND_PART}*)`);

// :lang(zh-TW) → [lang|="zh-TW"]（括号里可以是多个、逗号隔开，在 :is() 里）
function langPseudo(s) {
  return s.replace(/:lang\(([^)]*)\)/g, (_, list) => list.split(',').map((x) => `[lang|="${x.trim().replace(/^"|"$/g, '')}"]`).join(', '));
}

export function rewriteSelector(sel) {
  let s = sel.trim();
  // 1) 开头的 html… / :root…
  const m = HEAD_RE.exec(s);
  if (m) {
    const compound = langPseudo(m[2]);
    s = `${compound ? `:host(${compound})` : ':host'}${s.slice(m[0].length)}`;
  }
  // 2) body / #root（元素名、id，不是 .body-x 这种类名里的字）
  s = s.replace(/(^|[\s>+~(,])(body|#root)(?![\w-])/g, '$1.ov-root');
  // 3) 舞台自己全屏的样式
  s = s.replace(/(\.[\w-]+):fullscreen/g, '.ov-fs $1');
  return s;
}

const plugin = () => ({
  postcssPlugin: 'earu-overlay-selectors',
  Rule(rule) {
    const p = rule.parent;
    if (p && p.type === 'atrule' && /keyframes$/i.test(p.name)) return;
    if (rule.__earuDone) return;
    rule.__earuDone = true;
    rule.selectors = rule.selectors.map(rewriteSelector);
  },
});
plugin.postcss = true;
export default plugin;
