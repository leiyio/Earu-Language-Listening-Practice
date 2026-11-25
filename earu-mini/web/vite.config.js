import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import overlaySelectors from './postcss-overlay.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const shared = fileURLToPath(new URL('../shared', import.meta.url));

// 'xxx.css?shadow-css': rewrite a page-level stylesheet for use inside a shadow root and export it as a string.
const SHADOW = '?shadow-css';
const VIRTUAL = '\0shadow-css:';
function shadowCss() {
  return {
    name: 'shadow-css',
    enforce: 'pre',
    async resolveId(id, importer, opts) {
      if (!id.endsWith(SHADOW)) return null;
      const r = await this.resolve(id.slice(0, -SHADOW.length), importer, { ...opts, skipSelf: true });
      return r ? `${VIRTUAL}${r.id}.js` : null;
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      const file = id.slice(VIRTUAL.length, -3);
      this.addWatchFile(file);
      const out = await postcss([overlaySelectors()]).process(readFileSync(file, 'utf8'), { from: file });
      return `export default ${JSON.stringify(out.css.replace(/\/\*[\s\S]*?\*\//g, ''))};`;
    },
  };
}

export default defineConfig({
  root,
  base: './',
  plugins: [react(), shadowCss()],
  server: { port: 5183, fs: { allow: [root, shared] } },
});
