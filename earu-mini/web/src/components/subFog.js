// 字幕打码的「雾」：
// 打码的字糊成一团雾（样子在 styles.css 的 .sub-mosaic），鼠标在打码那一行上划过，雾被一层层吹开，停 0.3 秒后约 4.6 秒慢慢合回来。
// 鼠标划过就散，触屏要按着滑。
// 画法：被打码的元素后面插一份清楚的克隆（.fog-clr，绝对定位叠在同一位置），虚字遮罩 =「整块减风团」，克隆遮罩 =「只露风团」。
// 风团先合成一张很小的 alpha 图（一格约 0.16 个字高），遮罩就只剩这一张图，拉伸铺满元素的框（见 TEX 一节）；
// 浏览器不认这种画法时（TEX 一节写了几种情形），退回原来的「一个风团一层径向渐变」。
// 练习时能点开偷看的那句（.mask-text）只换雾的样子、吹不开：偷看要算一次提示；字幕列表里同一道题那份（.fog-lock，点不开的）也吹不开。
// 画面字幕（.overlay-sub）不接鼠标（点击要落到下面的视频上），事件到不了字幕上，
// 所以不等事件落到字幕上：听整个窗口的鼠标，按位置找是哪一行——字幕列表的行接鼠标，elementFromPoint 找得到；画面字幕量它打码那几块的框。

const P = { r: 1.1, peak: .5, inT: .3, hold: .3, rec: 4.6, drift: 0, wind: 0, up: .5, grow: 1, soft: .3, jit: .6 };
const MAXP = 320;
const HOSTS = '.line, .overlay-sub';
const LIVE = '.sub-mosaic:not(.mask-text):not(.fog-lock)';

const sub = typeof CSS !== 'undefined' && CSS.supports?.('mask-composite', 'subtract');

// tiny：遮罩里是一张小图时传「宽px 高px」，让图按这个大小铺在框的左上角、不平铺（和渐变里的 px 坐标一个坐标系，不管盒模型）；
// 渐变不需要这两项，来回切换时才改它们
function setMask(el, img, comp, tiny) {
  const s = el.style;
  s.maskImage = img;
  if (!(tiny && sub)) s.webkitMaskImage = img;   // 铬系和 WebKit 里前缀版都是同一个属性的别名，一长串图片地址不用解析两遍
  if (sub) s.maskComposite = comp || '';
  else s.webkitMaskComposite = comp ? comp.replace('subtract', 'source-out').replace(/add/g, 'source-over') : '';
  if ((el._tiny || '') !== (tiny || '')) {
    el._tiny = tiny || '';
    s.maskSize = s.webkitMaskSize = tiny || '';
    s.maskRepeat = s.webkitMaskRepeat = tiny ? 'no-repeat' : '';
  }
}

// ---- 小图遮罩 ----
// 以前遮罩是「一个风团一层径向渐变」：鼠标来回划时一百多层，每层都要让显卡把整块大小的渐变重画一遍，虚字、克隆各一份，显卡忙得最凶。
// 现在每帧把风团合成一张很小的 alpha 图，遮罩只剩两层（克隆：这张图；虚字：整块减这张图），图拉伸成元素的大小。
// 风团本来就是软边，小图平滑放大后和渐变几乎看不出差别；一格取 0.16 个字高（TEX），跟着字号走，每个风团盖住的格数不随字号变，开销稳定。
// 退路（都是照旧用渐变，也就是原来的画法）：
//  - 没有 Uint8Array / btoa、不认「图片做遮罩」（见 tinyOK），整个不走小图；
//  - 挂载时先让页面真加载一次 1×1 的 data: 小图当探针（见 mountFog），加载成功才开小图。页面强制的内容安全策略不让 data: 图片时探针走 onerror，
//    一直用渐变；探针还没出结果时也用渐变，所以不会有「遮罩图被拦、整块吹不开」的帧；
//  - 拼图那一步抛错：当场关掉小图，下一帧起用渐变。
// 只报告不拦截的策略（Report-Only）图照样能加载，探针成功，不理它。代价：每帧换一个新地址，浏览器每帧在控制台记一条 info 级违规提示
// （约 1.2KB 一条）；report-uri 实测 10 秒只收到 1 份，相同的报告 Chrome 自己去重。
// 不处理的：探针通过之后页面中途换了策略、某一帧的遮罩图单独加载失败——遮罩图有没有加载成功，代码看不到。
const TEX = .16;
const TEX_MAX = 1024;
const LUT = new Float32Array(1025);   // 风团的软边：到圆心距离的平方 / R² → 浓淡（0.3R 以内满浓，往外线性退到 R 处为 0），跟渐变的两个色标一样
for (let i = 0; i <= 1024; i++) { const d = Math.sqrt(i / 1024); LUT[i] = d <= P.soft ? 1 : d >= 1 ? 0 : (1 - d) / (1 - P.soft); }
const tinyOK = typeof document !== 'undefined' && typeof Uint8Array !== 'undefined' && typeof btoa === 'function' && typeof CSS !== 'undefined'
  && !!(CSS.supports?.('mask-image', 'url(x)') || CSS.supports?.('-webkit-mask-image', 'url(x)'));
// 苹果内核（WKWebView / Safari）也用小图。但 WebKit 的 data: 图是异步加载的，遮罩图没加载完之前不画被遮罩的元素：
// 实测：每帧直接换新地址，划着的那行整行看不见（划的时候和之后散开的几秒一直是黑的）。
// 所以铬系以外（Chrome / Electron 的 navigator.vendor 是 'Google Inc.'，data: 图当场就加载好，直接换），
// 换图前先让一张不挂在页面上的 <img> 把新图加载、解码好，再换上（mountFog 的 later）；加载中又来了新帧只留最新那张，旧遮罩先挂着，雾比鼠标慢一两帧。
// 同一次实测：这样字一直在、吹得开，录像里没有一帧变暗；解码一张中位 2ms；划的时候每帧中位 27ms，渐变那条路是 80–99ms。
const lazy = typeof navigator !== 'undefined' && navigator.vendor !== 'Google Inc.';

// 手拼 PNG：调色板 256 级（全黑，tRNS 里第 i 项透明度 = i），像素就是一个字节的透明度，压缩用「不压缩」的块——小图几 KB，拼起来比画布编码快得多
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc32 = (b, s, e) => { let c = -1; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
const put32 = (b, o, v) => { b[o] = v >>> 24; b[o + 1] = v >>> 16; b[o + 2] = v >>> 8; b[o + 3] = v; };
const tag = (b, o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
// 一个尺寸一份整文件的模子：签名、IHDR、PLTE、tRNS、IDAT 的头和 zlib 块头、IEND 都是定死的，每帧只填像素行、adler、CRC
function pngMold(w, h) {
  const raw = h * (w + 1), nb = Math.ceil(raw / 65535), idat = 2 + raw + nb * 5 + 4, head = 8 + 25 + 780 + 268;
  const b = new Uint8Array(head + 12 + idat + 12);
  b.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  put32(b, 8, 13); tag(b, 12, 'IHDR'); put32(b, 16, w); put32(b, 20, h); b.set([8, 3, 0, 0, 0], 24); put32(b, 29, crc32(b, 12, 29));
  put32(b, 33, 768); tag(b, 37, 'PLTE'); put32(b, 41 + 768, crc32(b, 37, 41 + 768));
  put32(b, 813, 256); tag(b, 817, 'tRNS'); for (let i = 0; i < 256; i++) b[821 + i] = i; put32(b, 821 + 256, crc32(b, 817, 821 + 256));
  const o = 1081;   // 8 + 25 + 780 + 268 = head
  put32(b, o, idat); tag(b, o + 4, 'IDAT'); b[o + 8] = 0x78; b[o + 9] = 0x01;
  for (let p = 0, q = o + 10; p < raw; p += 65535) {
    const n = Math.min(65535, raw - p);
    b[q] = p + n >= raw ? 1 : 0; b[q + 1] = n & 255; b[q + 2] = n >> 8; b[q + 3] = ~n & 255; b[q + 4] = (~n >> 8) & 255;
    q += 5 + n;
  }
  const e = o + 8 + idat + 4;   // IDAT 的 CRC 之后
  put32(b, e, 0); tag(b, e + 4, 'IEND'); put32(b, e + 8, 0xAE426082);
  return b;
}
function pngUrl(k, raw, w, h) {
  const b = k.png, o = 1081, d = o + 10, rawLen = raw.length;
  for (let p = 0, q = d; p < rawLen; p += 65535) { const n = Math.min(65535, rawLen - p); b.set(raw.subarray(p, p + n), q + 5); q += 5 + n; }
  // adler32
  let a = 1, s2 = 0; for (let i = 0; i < rawLen; i++) { a += raw[i]; s2 += a; } a %= 65521; s2 %= 65521;
  const ad = o + 8 + 2 + rawLen + Math.ceil(rawLen / 65535) * 5;
  put32(b, ad, ((s2 << 16) | a) >>> 0);
  put32(b, ad + 4, crc32(b, o + 4, ad + 4));
  let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return 'data:image/png;base64,' + btoa(s);
}

// 画一张小图，返回图片地址；画不出来返回 null（调用方退回渐变）。vis：一串 x, y, R, a（框内 CSS 像素），W × H：框的大小
function fogUrl(c, W, H, fs, vis) {
  if (!(W > 0 && H > 0)) return null;
  const k = c._k || (c._k = {});
  const tx = Math.max(1, fs * TEX), w = Math.min(TEX_MAX, Math.ceil(W / tx)), h = Math.min(TEX_MAX, Math.ceil(H / tx)), sx = w / W, sy = h / H;
  if (k.w !== w || k.h !== h) { k.w = w; k.h = h; k.acc = new Float32Array(w * h); k.raw = new Uint8Array(h * (w + 1)); k.png = pngMold(w, h); }
  const acc = k.acc, raw = k.raw;
  acc.fill(0);
  for (let n = 0; n < vis.length; n += 4) {
    const cx = vis[n] * sx, cy = vis[n + 1] * sy, Rx = vis[n + 2] * sx, Ry = vis[n + 2] * sy, a = vis[n + 3];
    const x0 = Math.max(0, Math.floor(cx - Rx)), x1 = Math.min(w - 1, Math.ceil(cx + Rx)), y0 = Math.max(0, Math.floor(cy - Ry)), y1 = Math.min(h - 1, Math.ceil(cy + Ry));
    const ix = 1 / (Rx * Rx), iy = 1 / (Ry * Ry);
    for (let j = y0; j <= y1; j++) {
      const dy = j + .5 - cy, vy = dy * dy * iy, row = j * w;
      for (let i = x0; i <= x1; i++) {
        const dx = i + .5 - cx, u = dx * dx * ix + vy;
        if (u >= 1) continue;
        acc[row + i] += (1 - acc[row + i]) * LUT[(u * 1024) | 0] * a;   // 一层压一层：和遮罩 add（source-over）一样
      }
    }
  }
  for (let j = 0, p = 0; j < h; j++) { const q = j * (w + 1) + 1; for (let i = 0; i < w; i++) raw[q + i] = (acc[p++] * 255 + .5) | 0; }
  return pngUrl(k, raw, w, h);
}
function useTiny(c, el, url, sz) {
  const u = `url("${url}")`;
  setMask(c, u, '', sz);
  setMask(el, 'linear-gradient(#000,#000),' + u, 'subtract, add', sz);
}
// 原来的画法：一个风团一层径向渐变
const gradients = (vis) => {
  const g = [];
  for (let i = 0; i < vis.length; i += 4) g.push(`radial-gradient(circle ${vis[i + 2].toFixed(1)}px at ${vis[i].toFixed(1)}px ${vis[i + 1].toFixed(1)}px, rgba(0,0,0,${vis[i + 3].toFixed(3)}) ${Math.round(P.soft * 100)}%, transparent 100%)`);
  return g;
};

function puffPos(p, age) { const e = .6 * (1 - Math.exp(-age / .6)); return [p.x + p.vx * e + p.wx * age, p.y + p.vy * e + p.wy * age]; }
function puffState(p, age) {
  const k = Math.min(age / P.inT, 1);
  const thin = p.a0 + (p.A - p.a0) * (1 - (1 - k) * (1 - k));
  const f = Math.min(1, Math.max(0, (age - P.hold) / P.rec));
  return [thin * (1 - f * f * (3 - 2 * f)), f];
}

// root：document，或播放器的 shadow root；win：听鼠标的那个窗口。返回拆掉用的函数
export function mountFog(root = document, win = window) {
  const fog = new Map();   // 宿主（一行字幕）→ { ps: 风团, last: 上一个鼠标点, els: Map(打码元素 → 克隆) }
  let raf = 0, swiped = -Infinity, down = null, tiny = false;
  const now = () => performance.now() / 1000;
  // 探针：页面的内容安全策略不让 data: 图片时（嵌在别人页面里时可能碰到）遮罩图加载不出来，遮罩就等于没有，整块打码吹不开。
  // 所以挂载时先用 root 所在的 document 加载一张 1×1 的 data: 小图（用 fogUrl 拼的，顺带验了拼图和解码），onload 才开小图；
  // 被拦会走 onerror，什么都不用做，tiny 一直是 false、用渐变；结果出来之前也是 false，所以不会有被拦的帧。
  const doc = root.ownerDocument || root;
  if (tinyOK) {
    const probe = doc.createElement('img');
    probe.onload = () => { tiny = true; };
    try { probe.src = fogUrl({}, 1, 1, 1, []); } catch { /* 拼不出来就一直用渐变 */ }
  }

  function blowAt(host, x, y, t, fs) {
    let st = fog.get(host);
    if (!st) fog.set(host, st = { ps: [], last: null, els: new Map() });
    const r0 = fs * P.r, gap = r0 * .4, L = st.last && t - st.last.t < .15 ? st.last : null;
    let vx = 0, vy = 0;
    if (L) { const dt = Math.max(t - L.t, .008); vx = (x - L.x) / dt; vy = (y - L.y) / dt; }
    const sp = Math.hypot(vx, vy), cap = sp > r0 * 10 ? r0 * 10 / sp : 1;
    vx *= cap * P.drift; vy *= cap * P.drift;
    const lim = r0 * .5, vl = Math.hypot(vx, vy) * .6; if (vl > lim) { vx *= lim / vl; vy *= lim / vl; }
    const wind = (vx < 0 ? -1 : 1) * r0 * P.wind, up = -r0 * P.up;
    const n = L ? Math.min(24, Math.max(1, Math.ceil(Math.hypot(x - L.x, y - L.y) / gap))) : 1;
    for (let i = 1; i <= n; i++) {
      const f = i / n, px = L ? L.x + (x - L.x) * f : x, py = L ? L.y + (y - L.y) * f : y;
      let near = null, nd = gap;
      for (const p of st.ps) {
        if (p.frag) continue;
        const [qx, qy] = puffPos(p, t - p.t0), d = Math.hypot(qx - px, qy - py);
        if (d < nd) { nd = d; near = p; }
      }
      if (near) {
        near.hit = t;
        if (t - near.t0 < .2) continue;
        const age = t - near.t0, [qx, qy] = puffPos(near, age), [a] = puffState(near, age);
        Object.assign(near, { x: qx, y: qy, t0: t, a0: a, A: 1 - (1 - a) * (1 - P.peak) });
        continue;
      }
      st.ps.push({ x: px, y: py, r: r0, t0: t, hit: t, a0: 0, A: P.peak, vx, vy, wx: wind, wy: up });
      if (Math.random() < P.jit) st.ps.push({ frag: true, x: px + (Math.random() - .5) * r0, y: py + (Math.random() - .5) * r0 * .6, r: r0 * (.4 + Math.random() * .3),
        t0: t, hit: t, a0: 0, A: P.peak * .8, vx: vx * 1.3, vy: vy * 1.3, wx: wind * 1.6, wy: up * 1.4 });
    }
    if (st.ps.length > MAXP) { st.ps.sort((a, b) => b.hit - a.hit); st.ps.length = MAXP; }
    st.last = { x, y, t };
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // 铬系以外换小图（见 lazy）：新图先在 <img> 里解码好再挂上；这一行吹完、克隆拆了，或者中途退回了渐变，就不挂了
  function later(c, el, url, sz) {
    const k = c._k;
    k.next = [url, sz];
    if (k.img) return;
    const [u, s] = k.next, img = k.img = doc.createElement('img');
    k.next = null;
    img.src = u;
    img.decode().then(() => {
      k.img = null;
      if (!c.isConnected || !tiny) return;
      useTiny(c, el, u, s);
      if (k.next) later(c, el, ...k.next);
    }, () => { k.img = null; tiny = false; });
  }

  function clear(st) {
    for (const [el, c] of st.els) { c.remove(); setMask(el, '', ''); }
    st.els.clear();
  }

  function cloneOf(st, el) {
    let c = st.els.get(el);
    if (c && c.isConnected) return c;
    c = el.cloneNode(true);
    c.classList.remove('sub-mosaic', 'mask-text', 'fog-lock');
    c.classList.add('fog-clr');
    c.removeAttribute('id'); c.setAttribute('aria-hidden', 'true'); c.removeAttribute('role'); c.removeAttribute('tabindex');
    c._txt = el.textContent;
    const par = el.parentNode;
    if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
    par.insertBefore(c, el.nextSibling);
    st.els.set(el, c);
    return c;
  }

  function tick() {
    raf = 0;
    const t = now();
    let alive = false;
    for (const [host, st] of fog) {
      st.ps = st.ps.filter((p) => t - p.t0 < P.hold + P.rec);
      if (!host.isConnected || !st.ps.length) { clear(st); fog.delete(host); continue; }
      alive = true;
      const hr = host.getBoundingClientRect();
      const live = [...host.querySelectorAll(LIVE)];
      for (const [el, c] of st.els) if (!live.includes(el)) { c.remove(); setMask(el, '', ''); st.els.delete(el); }
      for (const el of live) {
        const r = el.getBoundingClientRect(), ox = r.left - hr.left, oy = r.top - hr.top, vis = [];   // 看得见的风团：x, y, R, 浓淡 四个一组
        for (const p of st.ps) {
          const age = t - p.t0, [a, f] = puffState(p, age);
          if (a < .02) continue;
          const [px, py] = puffPos(p, age), x = px - ox, y = py - oy, R = p.r * (1 + P.grow * f);
          if (x < -R || y < -R || x > r.width + R || y > r.height + R) continue;
          vis.push(x, y, R, a);
        }
        if (!vis.length) { const c = st.els.get(el); if (c) { c.remove(); st.els.delete(el); } setMask(el, '', ''); continue; }
        // 宽高用小数（全站 border-box，cs.width 就是整块的宽；行内元素是 auto，退回量到的框）：offsetWidth 取整，少零点几像素最后一个词就折到第二行、被遮罩裁掉
        const c = cloneOf(st, el), cs = getComputedStyle(el), w = parseFloat(cs.width), h = parseFloat(cs.height);
        if (c._txt !== el.textContent) { c.replaceChildren(...[...el.cloneNode(true).childNodes]); c._txt = el.textContent; }
        const bw = w > 0 ? w : r.width, bh = h > 0 ? h : r.height;
        Object.assign(c.style, { left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: bw + 'px', height: bh + 'px', padding: cs.padding });
        let url = null;
        if (tiny) { try { url = fogUrl(c, bw, bh, parseFloat(cs.fontSize) || 15, vis); } catch { tiny = false; } }
        if (url) {
          const sz = `${bw}px ${bh}px`;
          if (lazy) later(c, el, url, sz); else useTiny(c, el, url, sz);
        } else {
          const g = gradients(vis).join(',');
          setMask(c, g, '');
          setMask(el, 'linear-gradient(#000,#000),' + g, 'subtract' + ', add'.repeat(vis.length / 4));
        }
      }
    }
    if (alive) raf = requestAnimationFrame(tick);
  }

  // 鼠标下面是哪一行、字多大：打码那几块合起来的框（.sub-mosaic 往外扩了 0.8 个字），左右再多给 0.7 个风团
  const near = (host, x, y, vert) => {
    const live = host.querySelectorAll(LIVE);
    if (!live.length) return null;
    let l = Infinity, r = -Infinity, tp = Infinity, b = -Infinity;
    for (const el of live) {
      const q = el.getBoundingClientRect();
      if (!q.width) continue;
      l = Math.min(l, q.left); r = Math.max(r, q.right); tp = Math.min(tp, q.top); b = Math.max(b, q.bottom);
    }
    const fs = parseFloat(getComputedStyle(live[0]).fontSize) || 15, r0 = fs * P.r;
    if (x < l - r0 * .7 || x > r + r0 * .7) return null;
    if (vert && (y < tp || y > b)) return null;
    return { host, fs };
  };
  const hostAt = (x, y) => {
    if (!root.querySelector(LIVE)) return null;
    const el = root.elementFromPoint?.(x, y);
    const line = el && root.contains(el) ? el.closest(HOSTS) : null;
    if (line) return near(line, x, y, false);
    for (const o of root.querySelectorAll('.overlay-sub')) {
      const hit = near(o, x, y, true);
      if (hit) return hit;
    }
    return null;
  };

  const onMove = (e) => {
    if (e.pointerType !== 'mouse' && !(e.buttons & 1) && !down) return;
    const hit = hostAt(e.clientX, e.clientY);
    if (!hit) return;
    // 按着在打码那一行上横着拖过：松手那下别再当成「点这一句跳过去」
    if (down && Math.abs(e.clientX - down.x) > 10) swiped = e.timeStamp;
    const hr = hit.host.getBoundingClientRect();
    blowAt(hit.host, e.clientX - hr.left, e.clientY - hr.top, now(), hit.fs);
  };
  const onDown = (e) => {
    down = { x: e.clientX, y: e.clientY };
    const hit = hostAt(e.clientX, e.clientY);
    if (!hit) return;
    // 触屏按下会被默认「抓」在按到的那个元素上，放开才能一路划过别的行（只放打码那一行上的，别动页面自己的拖动）
    const tg = e.composedPath()[0]; if (tg?.hasPointerCapture?.(e.pointerId)) tg.releasePointerCapture(e.pointerId);
    const st = fog.get(hit.host); if (st) st.last = null;
    onMove(e);
  };
  const onUp = () => { down = null; };
  // 只吞真按下去的那一下（键盘回车、空格触发的 click 的 detail 是 0，不算）
  const onClick = (e) => { if (e.detail > 0 && e.timeStamp - swiped < 500) { e.stopPropagation(); e.preventDefault(); swiped = -Infinity; } };

  const on = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['click', onClick]];
  for (const [type, fn] of on) win.addEventListener(type, fn, true);
  return () => {
    cancelAnimationFrame(raf);
    for (const st of fog.values()) clear(st);
    fog.clear();
    for (const [type, fn] of on) win.removeEventListener(type, fn, true);
  };
}
