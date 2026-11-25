// 无头 Chrome + 静态服务器的小工具（不装 puppeteer，自己连 DevTools）
import { spawn, spawnSync } from 'node:child_process';
import { createServer, createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = new Set([6000, 6665, 6666, 6667, 6668, 6669, 10080, 5060, 5061]);

export function freePort(from) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (BAD.has(p)) return tryPort(p + 1);
      const s = createServer();
      s.once('error', () => tryPort(p + 1));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)));
    };
    tryPort(from);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };

// 只读静态服务器：托管 root，只绑 127.0.0.1
// over(路径)：测试用，返回字符串就当这个路径的内容（例如按用例换 /config.json），返回 null 走磁盘上的文件
export async function staticServer(root, fromPort, over = null) {
  const port = await freePort(fromPort);
  const srv = httpServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const o = over ? over(u) : null;
    if (o != null) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(o); return; }
    let f = normalize(join(root, u === '/' ? 'index.html' : u));
    if (!f.startsWith(normalize(root)) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return { srv, port, origin: `http://127.0.0.1:${port}` };
}

export class Browser {
  constructor({ chrome, profile, fromPort = 9333, width = 1280, height = 800, locale = 'zh-CN', openShadow = true }) {
    Object.assign(this, { chrome, profile, fromPort, width, height, locale, openShadow });
    this.reqs = []; this.errors = []; this.logs = []; this.mid = 0; this.pend = new Map();
  }
  send(method, params = {}) {
    return new Promise((res, rej) => { const n = ++this.mid; this.pend.set(n, { res, rej }); this.ws.send(JSON.stringify({ id: n, method, params })); });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expr, ms = 20000, what = expr) {
    const t0 = Date.now();
    for (;;) {
      const v = await this.ev(expr).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`等了 ${ms / 1000} 秒还没有：${what}`);
      await sleep(100);
    }
  }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async launch() {
    this.port = await freePort(this.fromPort);
    this.proc = spawn(this.chrome, ['--headless=new', '--mute-audio', `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`,
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let wsUrl = null;
    this.proc.stderr.on('data', (d) => { wsUrl ||= String(d).match(/DevTools listening on (ws:\/\/\S+)/)?.[1] || null; });
    for (let k = 0; k < 150 && !wsUrl; k++) await sleep(100);
    if (!wsUrl) throw new Error('Chrome 没起来');
    const list = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
    this.ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pend.has(m.id)) { const p = this.pend.get(m.id); this.pend.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); return; }
      const p = m.params;
      try { this.onEvent?.(m); } catch { /* 测试自己的监听出错不挡别的 */ }
      if (m.method === 'Runtime.consoleAPICalled') this.logs.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      else if (m.method === 'Log.entryAdded') this.logs.push(`${p.entry.level}: ${p.entry.text} ${p.entry.url || ''}`);
      if (m.method === 'Network.requestWillBeSent') this.reqs.push({ url: p.request.url, method: p.request.method });
      else if (m.method === 'Runtime.exceptionThrown') this.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      else if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') this.errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      else if (m.method === 'Network.loadingFailed' && !p.canceled) this.errors.push(`loadingFailed: ${p.errorText}`);
    };
    await this.send('Runtime.enable'); await this.send('Page.enable'); await this.send('Network.enable'); await this.send('Log.enable');
    // 播放页画在 closed 的 shadow root 里：测试时让它变成 open，才能从页面脚本里查元素（只改测试用的浏览器，不改成品）
    if (this.openShadow) await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const o=Element.prototype.attachShadow;Element.prototype.attachShadow=function(i){return o.call(this,{...i,mode:'open'})}})()` });
    await this.send('Emulation.setDeviceMetricsOverride', { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setLocaleOverride', { locale: this.locale });
  }
  async typeText(text) { await this.send('Input.insertText', { text }); }
  async pressKey(key, code, vk, text) {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async setFile(selector, files) {
    const { result } = await this.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
    if (!result.objectId) throw new Error(`找不到 ${selector}`);
    await this.send('DOM.setFileInputFiles', { objectId: result.objectId, files });
  }
  close() { try { this.ws?.close(); } catch { /* 无 */ } try { if (this.proc?.pid) spawnSync('taskkill', ['/PID', String(this.proc.pid), '/T', '/F']); } catch { /* 无 */ } try { this.proc?.kill(); } catch { /* 无 */ } }
}
