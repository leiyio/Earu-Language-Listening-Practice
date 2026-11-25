// 本机练习版端到端：打包 → 只读静态服务器托管 dist → 无头 Chrome（自己连 DevTools）→ 断言。
//   node scripts/e2e.mjs            先打包再测
//   node scripts/e2e.mjs --nobuild  不打包，直接测现有 dist
// 测试视频放在环境变量 FIXTURES 指的目录（titled.mkv、titled.mp4、zh.mkv，仓库不带）；截图存 ../shots；
// 日志、全程请求清单和临时浏览器配置写在系统临时目录下的 earu-mini-e2e（可用 E2E_TMP 改）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Browser, staticServer, sleep, freePort } from './lib-cdp.mjs';
import { sortText, tokenize } from '../../shared/sortText.js';

const WEB = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/');
const SHOTS = `${WEB}../shots/`;
const slash = (d) => `${d.replace(/\\/g, '/').replace(/\/$/, '')}/`;
const FIX = slash(process.env.FIXTURES || `${WEB}../fixtures`);
const TMP = slash(process.env.E2E_TMP || `${tmpdir()}/earu-mini-e2e`);
const LOGS = `${TMP}logs/`;
const PROFILE = `${TMP}chrome-profile-e2e`;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(SHOTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });

if (!process.argv.includes('--nobuild')) {
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: WEB, encoding: 'utf8' });
  writeFileSync(`${LOGS}build-e2e.log`, `${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) { console.log('打包失败，见 build-e2e.log'); process.exit(1); }
}
for (const f of ['titled.mkv', 'titled.mp4', 'zh.mkv']) if (!existsSync(FIX + f)) { console.log(`缺测试片 ${FIX}${f}（用环境变量 FIXTURES 指定测试片目录）`); process.exit(1); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '通过' : '失败'}  ${name}${detail ? `  （${detail}）` : ''}`); };

// /config.json 按用例换：默认是空的（和仓库里提交的一样）；翻译用例里换成指向本机假接口的
let cfgBody = JSON.stringify({ ai: { baseUrl: '', apiKey: '', model: '' } });
const { srv, origin } = await staticServer(`${WEB}dist`, 5184, (u) => (u === '/config.json' ? cfgBody : null));
rmSync(PROFILE, { recursive: true, force: true });
let b = new Browser({ chrome: CHROME, profile: PROFILE, fromPort: 9333, width: 1280, height: 800, locale: 'zh-CN' });
const R = `document.querySelector('[data-earu-demo]').shadowRoot`;
const Q = (sel) => `${R}.querySelector(${JSON.stringify(sel)})`;
const QA = (sel) => `[...${R}.querySelectorAll(${JSON.stringify(sel)})]`;
const clickBtn = (sel, text) => b.ev(`(()=>{const x=${QA(sel)}.find((e)=>!${JSON.stringify(text)}||e.textContent.includes(${JSON.stringify(text)}));if(!x)return false;x.click();return true})()`);
const pauseVideo = () => b.ev(`(()=>{const v=${Q('video')};v&&v.pause();return 1})()`);
const masked = () => b.ev(`${QA('.lines .line .text .sub-mosaic')}.length>0 || !!${Q('.overlay-sub .sub-mosaic')}`);
let fail = null;
let segEmpty = 0;

// 打开一部片：回首页（若在播放页）→（可选）改在学语言 → 选文件 → 等字幕列表有行
async function openFilm(file, learn) {
  if (await b.ev(`!!document.querySelector('[data-earu-demo]')`)) {
    await b.ev(`${Q('.top-back')}.click()`);
    await b.waitFor(`!document.querySelector('[data-earu-demo]')`, 10000, '回首页');
  }
  if (learn) {
    await b.ev(`localStorage.setItem('earu.learnLang', ${JSON.stringify(learn)}); 1`);
    await b.send('Page.navigate', { url: `${origin}/` });
    await b.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]')`, 15000, '首页');
  }
  await b.setFile('input[type=file]', [FIX + file]);
  await b.waitFor(`!!document.querySelector('[data-earu-demo]') && ${QA('.lines .line .text')}.length>0`, 30000, `${file} 字幕列表`);
  await pauseVideo();
  await sleep(500);
}
const lineTexts = () => b.ev(`${QA('.lines .line .text')}.map((e)=>e.textContent.trim())`);
const letters = (s) => String(s).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
// 词块 id 末尾的数字是这个词在原句里的位置（英文 `题号#i`、中文 `题号#标记:i`）
const tokId = (x) => `Number(${x}.dataset.tokenId.match(/(\\d+)$/)[1])`;

async function clickTok(id) {
  await b.ev(`(()=>{const x=${QA('.sort-bank .sort-tok')}.find((e)=>e.dataset.tokenId===${JSON.stringify(id)});x&&x.click();return 1})()`);
  await sleep(60);
}
// 排序：当前句按词块 id 末尾的原位序号点完（同一句内顺序随机打乱，id 里的序号才是原位），再核对排出来的字和字幕行一致
async function solveSort(expectText) {
  await b.waitFor(`${QA('.sort-answer .sort-slot, .sort-answer .sort-tok')}.length>0 && ${QA('.sort-bank .sort-tok')}.length>0`, 15000, '排序出题');
  const order = await b.ev(`${QA('.sort-bank .sort-tok')}.map((x)=>[${tokId('x')},x.dataset.tokenId]).sort((a,b)=>a[0]-b[0]).map((p)=>p[1])`);
  for (const id of order) await clickTok(id);
  const solved = await b.waitFor(`!!${Q('.sort-answer.is-correct')}`, 5000, '排对').catch(() => false);
  const got = await b.ev(`${Q('.sort-answer')}?.textContent||''`);
  return { solved: !!solved, same: [expectText, sortText(expectText), expectText.replace(/^[^：:]{1,8}[：:]/, '')].some((x) => letters(x) === letters(got)), got, order: order.join('|') };
}
// 故意排反：词块按原位序号倒着点，不该判对
async function sortWrong() {
  await b.waitFor(`${QA('.sort-bank .sort-tok')}.length>1`, 15000, '排序出题(反)');
  const order = await b.ev(`${QA('.sort-bank .sort-tok')}.map((x)=>[${tokId('x')},x.dataset.tokenId,x.textContent]).sort((a,b)=>b[0]-a[0])`);
  const distinct = new Set(order.map((o) => o[2])).size > 1;
  for (const [, id] of order) await clickTok(id);
  await sleep(600);
  return { distinct, judgedCorrect: !!(await b.ev(`!!${Q('.sort-answer.is-correct')}`)) };
}
const stepNext = () => clickBtn('.lm-btn', '跳过');
const pos = () => b.ev(`${Q('.lm-pos')}?.textContent||''`);
const enterPractice = async (kind = '排序', pill = '练') => {
  await b.ev(`${QA('.lines .line')}[0].click()`);
  await sleep(500);
  await pauseVideo();
  const ok = await clickBtn('.lm-pill', pill);
  await b.waitFor(`!!${Q('.sort-panel')}`, 10000, '练习面板');
  await clickBtn('.lm-seg button', kind);   // 练习种类会记在本机，每次都显式选
  await sleep(400);
  return ok;
};

// 听写：一格一个词，空格跳格，回车判分；预摆的格子跳过
async function typeSentence(text, wrongAt) {
  const cells = await b.ev(`${QA('.dict-cell')}.map((c)=>c.classList.contains('is-preset'))`);
  const words = tokenize(sortText(text));
  if (cells.length !== words.length) return { err: `格数 ${cells.length} 不等于词数 ${words.length}` };
  await b.ev(`${Q('.dict-input')}.focus(); 1`);
  let n = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) continue;
    await b.typeText(wrongAt === n ? 'zzqx' : words[i]);
    await sleep(40);
    n++;
    if (i < cells.length - 1) { await b.pressKey(' ', 'Space', 32, ' '); await sleep(40); }
  }
  await b.pressKey('Enter', 'Enter', 13, '\r');
  await sleep(500);
  return { err: null };
}

try {
  await b.launch();
  await b.send('Page.navigate', { url: `${origin}/` });
  await b.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]')`, 15000, '首页');
  check('首页：标题是「耳如 Earu」', (await b.ev('document.title')) === '耳如 Earu');
  const homeText = await b.ev('document.body.innerText');
  const WORDS = /登录|会员|价格|订阅|片库|YouTube|B 站|B站|ChatGPT|OpenAI/;
  check('首页：界面里没有登录、会员、价格、片库、YouTube 字样', !WORDS.test(homeText), homeText.match(WORDS)?.[0] || '');


  // ===== 14 种界面语言：标题、方向、有没有露出键名 / 没替换的 {@xxx} 记号 =====
  const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'tr', 'ar', 'hi', 'vi'];
  mkdirSync(`${SHOTS}lang/`, { recursive: true });
  const langBad = [];
  for (const lg of LANGS) {
    await b.ev(`localStorage.setItem('earu.uiLang', ${JSON.stringify(lg)}); 1`);
    await b.send('Page.navigate', { url: `${origin}/` });
    await b.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]') && document.documentElement.lang===${JSON.stringify(lg)}`, 15000, `${lg} 首页`);
    await sleep(300);
    const info = await b.ev(`(()=>{
      const attrs=[...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((e)=>['aria-label','title','placeholder'].map((a)=>e.getAttribute(a)).filter(Boolean));
      const all=[document.body.innerText,...attrs].join('\\n');
      return {title:document.title, dir:document.documentElement.dir, all, textLen:document.body.innerText.length};
    })()`);
    const want = lg === 'zh-CN' || lg === 'zh-TW' ? '耳如 Earu' : 'Earu';
    const rawKeys = info.all.match(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g) || [];
    const marks = info.all.match(/\{@[^}]*\}/g) || [];
    const dirOk = lg === 'ar' ? info.dir === 'rtl' : info.dir !== 'rtl';
    if (info.title !== want || !dirOk || rawKeys.length || marks.length || info.textLen < 10) langBad.push(`${lg}：标题「${info.title}」方向 ${info.dir} 键名 ${rawKeys.slice(0, 3)} 记号 ${marks.slice(0, 3)}`);
    await b.shot(`${SHOTS}lang/home-${lg}.png`);
  }
  check('14 种界面语言：标题对、阿拉伯语从右到左、没有露出键名或 {@} 记号', langBad.length === 0, langBad.join('；'));
  await b.ev(`localStorage.setItem('earu.uiLang', 'zh-CN'); 1`);
  await b.send('Page.navigate', { url: `${origin}/` });
  await b.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]') && document.title==='耳如 Earu'`, 15000, '回简体首页');

  // 首页没有说明文字：拖放区只有一个标题，没有段落；整页不出现 <p>
  const dropInfo = await b.ev(`(()=>{const d=document.querySelector('.dk-drop-text');return {kids:d?[...d.children].map((e)=>e.tagName):null, p:document.querySelectorAll('main p, .dk-drop p').length}})()`);
  check('首页：拖放区只有标题、没有说明段落', !!dropInfo.kids && dropInfo.kids.join() === 'H2' && dropInfo.p === 0, JSON.stringify(dropInfo));

  // ===== 影片一：titled.mkv（英文字幕 MKV）=====
  await openFilm('titled.mkv');
  const texts = await lineTexts();
  check('titled.mkv：出现字幕列表', texts.length >= 3 && texts.every(Boolean), `${texts.length} 行`);
  check('titled.mkv：在学语言（英语）字幕默认遮盖', await masked());
  const noTr = await b.ev(`${QA('.lines .line .zh, .overlay-sub .zh, .tr-status, .zh.pending')}.length`);
  check('配置为空：字幕列表和画面上没有译文行、占位、状态图标', noTr === 0, String(noTr));
  check('配置为空：只读了本站的 config.json，没有请求别的站', b.reqs.some((r) => r.url === `${origin}/config.json`) && b.reqs.every((r) => r.url.startsWith(origin) || /^(blob|data):/.test(r.url)));
  await b.shot(`${SHOTS}player.png`);

  check('titled.mkv：「练这句」能点开', await enterPractice());
  check('配置为空：排序面板里没有译文行', (await b.ev(`${QA('.sort-zh')}.length`)) === 0);
  const wrong = await sortWrong();
  check('排序：故意排反不判对', wrong.distinct && !wrong.judgedCorrect, `词有不同=${wrong.distinct}`);
  await clickBtn('.sort-tool', '重新打乱');
  await sleep(500);
  let sortOk = true;
  const sortDetail = [];
  for (let i = 0; i < texts.length; i++) {
    const p = await pos();
    const r = await solveSort(texts[i]);
    sortDetail.push(`${p.trim()}:${r.solved ? '对' : '错'}/${r.same ? '字同' : `字不同「${r.got.slice(0, 30)}」`}`);
    if (!r.solved || !r.same) sortOk = false;
    if (i === 0) await b.shot(`${SHOTS}sort.png`);
    if (i < texts.length - 1) { await sleep(300); await stepNext(); await sleep(600); }
  }
  check('排序：每句按正确词序点完都判对、排出的字和字幕一致', sortOk, sortDetail.join('；'));

  // 听写：回到第一句再切到听写
  await b.ev(`${Q('.lm-grab')}.click()`);
  await sleep(400);
  await enterPractice('听写');
  await b.waitFor(`!!${Q('.dict-panel')}`, 10000, '听写面板');
  await sleep(500);
  const d1 = await typeSentence(texts[0], -1);
  const dictOk = !d1.err && !!(await b.ev(`!!${Q('.dict-answer.is-correct')}`));
  check('听写：填对判对', dictOk, d1.err || '');
  if (dictOk) await b.shot(`${SHOTS}dictate.png`);
  await stepNext();
  await sleep(700);
  const d2 = await typeSentence(texts[1], 0);
  const bad = await b.ev(`${QA('.dict-cell.is-bad')}.length`);
  const cellInfo = await b.ev(`${QA('.dict-cell')}.map((c)=>c.className.replace('dict-cell','').trim()||'-').join(',')`);
  const note = await b.ev(`${Q('.dict-note.is-warn')}?.textContent||''`);
  check('听写：故意填错一个词，错词被标出', !d2.err && bad === 1 && /is-bad/.test(cellInfo.split(',')[0]) && cellInfo.split(',').slice(1).every((c) => /is-ok/.test(c)) && !(await b.ev(`!!${Q('.dict-answer.is-correct')}`)), d2.err || `bad=${bad}` + `格 [${cellInfo}]；提示「${note}」`);
  await b.shot(`${SHOTS}dictate-wrong.png`);

  // ===== 影片二：titled.mp4（英文字幕 MP4）=====
  await openFilm('titled.mp4');
  const t2 = await lineTexts();
  check('titled.mp4：出现字幕列表', t2.length >= 1 && t2.every(Boolean), `${t2.length} 行`);
  check('titled.mp4：在学语言字幕默认遮盖', await masked());
  // 倍速、单句循环、点字幕行跳转（听的状态下，还没进练习）
  const secOf = (txt) => { const m = String(txt).trim().match(/(?:(\d+):)?(\d+):(\d+)/); return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : NaN; };
  const rowTimes = await b.ev(`${QA('.lines .line .time')}.map((e)=>e.textContent)`);
  const rowSec = rowTimes.map(secOf);
  const openSettings = async () => { await b.ev(`${Q('.lm-ctl .lm-ib:last-child')}.click()`); await sleep(300); };
  await openSettings();
  segEmpty = await b.ev(`${QA('.lm-set .lm-seg')}.length`);
  const speedPicked = await clickBtn('.lm-set .lm-seg button', '1.25');
  await sleep(400);
  const rate = await b.ev(`${Q('video')}.playbackRate`);
  check('倍速：选 1.25 后视频 playbackRate 跟着变', speedPicked && Math.abs(rate - 1.25) < 0.001, `rate=${rate}`);
  await b.shot(`${SHOTS}settings.png`);
  await clickBtn('.lm-set .lm-seg button', '1×');
  await sleep(300);
  check('倍速：改回 1× 后 playbackRate 回到 1', (await b.ev(`${Q('video')}.playbackRate`)) === 1);
  await b.ev(`${Q('.lm-dim')}.click()`);
  await sleep(300);
  // 点字幕行：行少于 2 行的片没法测
  await b.ev(`${QA('.lines .line')}[1].click()`);
  await sleep(600);
  const seekT = await b.ev(`${Q('video')}.currentTime`);
  check('字幕列表：点第 2 行，视频跳到第 2 句附近', rowSec.length >= 2 && Math.abs(seekT - rowSec[1]) <= 2.5, `第 2 行 ${rowTimes[1]}，当前 ${seekT.toFixed(2)} 秒`);
  // 单句循环：开了以后播放时间回到句首
  await b.ev(`${Q('.lm-ctl .lm-ib')}.click()`);
  await sleep(200);
  const loopOn = await b.ev(`${Q('.lm-ctl .lm-ib')}.getAttribute('aria-pressed')`);
  await b.ev(`${QA('.lines .line')}[0].click()`);
  await b.ev(`(()=>{const v=${Q('video')};v.play();return 1})()`);
  let jumped = false, lastT = 0, maxT = 0;
  for (let k = 0; k < 150 && !jumped; k++) {
    const t = await b.ev(`${Q('video')}.currentTime`);
    if (t < lastT - 0.3) jumped = true;
    lastT = t; maxT = Math.max(maxT, t);
    await sleep(100);
  }
  check('单句循环：开着循环，播到句尾后时间回到句首', loopOn === 'true' && jumped, `aria-pressed=${loopOn}，最大 ${maxT.toFixed(2)} 秒，回跳到 ${lastT.toFixed(2)}`);
  await b.ev(`${Q('.lm-ctl .lm-ib')}.click()`);
  await pauseVideo();

  await enterPractice();
  const s2 = await solveSort(t2[0]);
  check('titled.mp4：排序排对判对', s2.solved && s2.same, s2.got.slice(0, 30));

  // ===== 影片三：zh.mkv（中文字幕，在学语言切成中文）=====
  await openFilm('zh.mkv', 'zh');
  const t3 = await lineTexts();
  check('zh.mkv：出现中文字幕列表', t3.length >= 1 && t3.every(Boolean) && /[\u4e00-\u9fff]/.test(t3.join('')), `${t3.length} 行`);
  check('zh.mkv：在学语言（中文）字幕默认遮盖', await masked());
  await enterPractice();
  const s3 = await solveSort(t3[0]);
  check('zh.mkv：中文排序排对判对', s3.solved && s3.same, `solved=${s3.solved} same=${s3.same} 排出「${s3.got.slice(0, 30)}」字幕「${t3[0]}」 ids=${s3.order}`);

  // ===== 最近播放 =====
  await b.ev(`${Q('.top-back')}.click()`);
  await b.waitFor(`!document.querySelector('[data-earu-demo]') && document.querySelectorAll('.recent-card, .recent-row').length>0`, 10000, '回首页');
  await sleep(1200);
  const names = await b.ev(`[...document.querySelectorAll('.recent-name')].map((e)=>e.textContent.trim())`);
  check('最近播放：出现刚打开的视频，共 3 条（mkv、mp4、zh 各一）、最新打开的 zh 排第一', names.join() === 'zh,titled,titled', names.join('、'));
  await b.shot(`${SHOTS}home.png`);
  await sleep(1000);

  // ===== 点「选择视频文件」那条路：上面的用例是直接往隐藏 input 里塞文件，这里真点按钮、等浏览器弹出选文件框，
  // 再把文件交给弹出来的那个框（DevTools 接管系统选文件框）。新式选文件接口换成只记次数：按钮不该再用它 =====
  await b.ev(`(()=>{window.__pickerCalls=0;window.showOpenFilePicker=async()=>{window.__pickerCalls++;throw new DOMException('x','AbortError')};return 1})()`);
  await b.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = new Promise((res) => { b.onEvent = (m) => { if (m.method === 'Page.fileChooserOpened') res(m.params); }; setTimeout(res, 8000, null); });
  await b.ev(`(()=>{document.querySelector('.dk-pick-btn').click();return 1})()`);
  const opened = await chooser;
  b.onEvent = null;
  if (opened?.backendNodeId) await b.send('DOM.setFileInputFiles', { backendNodeId: opened.backendNodeId, files: [`${FIX}zh.mkv`] });
  await b.send('Page.setInterceptFileChooserDialog', { enabled: false });
  const pickedIn = await b.waitFor(`!!document.querySelector('[data-earu-demo]') && ${QA('.lines .line .text')}.length>0`, 20000, '点按钮选文件后进播放页').then(() => true).catch(() => false);
  await pauseVideo();
  const pickerCalls = await b.ev('window.__pickerCalls');
  check('点「选择视频文件」：弹出普通选文件框（不用新式接口），选了文件进播放页、有字幕', !!opened && pickerCalls === 0 && pickedIn, `弹框 ${!!opened}，新式接口被调 ${pickerCalls} 次，进播放页 ${pickedIn}`);
  await b.ev(`${Q('.top-back')}.click()`);
  await b.waitFor(`!document.querySelector('[data-earu-demo]')`, 10000, '回首页');
} catch (e) {
  fail = e;
  console.log(`没走完：${String(e.stack || e).split('\n').slice(0, 3).join('\n  ')}`);
  await b.shot(`${SHOTS}fail.png`).catch(() => {});
}

// ===== 翻译（开发者自己填的 AI 接口；这里只连本机假接口，真实服务一个都不连）=====
{
  const KEY = 'sk-test-FAKE-0123456789abcdef';
  const MODEL = 'test-model-x';
  const tag = (s) => `〔译〕${s}`;
  // 假接口：处理跨域预检，按聊天补全格式应答；mode：ok | 500 | garbage | short（一批 3 句及以上就少回一句，拆小后才对）
  const fake = { mode: 'ok', reqs: [], text: new Map() };
  fake.srv = httpServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = null;
      try { j = JSON.parse(body); } catch { /* 记下原样 */ }
      const user = j?.messages?.filter((m) => m.role === 'user').pop()?.content || '';
      const items = user.split('\n').map((l) => l.match(/^(\d+): (.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]);
      fake.reqs.push({ url: req.url, method: req.method, auth: req.headers.authorization, bodyKeys: j ? Object.keys(j).sort() : null, model: j?.model, n: items.length });
      if (fake.mode === 'ok') items.forEach(([n, x]) => fake.text.set(Number(n), x));
      const send = (code, type, payload) => { res.writeHead(code, { ...cors, 'content-type': type }); res.end(payload); };
      if (!/\/chat\/completions$/.test(req.url)) return send(404, 'text/plain', 'nf');
      if (fake.mode === '500') return send(500, 'application/json', '{"error":"boom"}');
      if (fake.mode === '401') return send(401, 'application/json', '{"error":"bad key"}');
      if (fake.mode === 'garbage') return send(200, 'application/json', JSON.stringify({ choices: [{ message: { content: '这不是 JSON，只是一段话。' } }] }));
      const use = fake.mode === 'short' && items.length >= 3 ? items.slice(0, -1) : items;
      const obj = Object.fromEntries(use.map(([n, x]) => [n, tag(x)]));
      send(200, 'application/json', JSON.stringify({ choices: [{ message: { content: `好的，结果如下：\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` } }] }));
    });
  });
  const fakePort = await freePort(18800);
  await new Promise((r) => fake.srv.listen(fakePort, '127.0.0.1', r));
  const fakeBase = `http://127.0.0.1:${fakePort}/v1/`;   // 末尾带斜杠，也要对
  const setCfg = (on) => { cfgBody = JSON.stringify({ ai: on ? { baseUrl: fakeBase, apiKey: KEY, model: MODEL } : { baseUrl: '', apiKey: '', model: '' } }); };
  const mainB = b;
  const newB = async (name, port) => {
    const p = `${TMP}chrome-profile-${name}`;
    rmSync(p, { recursive: true, force: true });
    const x = new Browser({ chrome: CHROME, profile: p, fromPort: port, width: 1280, height: 800, locale: 'zh-CN' });
    await x.launch();
    return x;
  };
  const prefs = async (ui, learn) => {
    await b.send('Page.navigate', { url: `${origin}/` });
    await b.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]')`, 15000, '首页');
    await b.ev(`localStorage.setItem('earu.uiLang', ${JSON.stringify(ui)}); localStorage.setItem('earu.learnLang', ${JSON.stringify(learn)}); 1`);
    await b.send('Page.navigate', { url: `${origin}/` });
    await b.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]') && document.documentElement.lang===${JSON.stringify(ui)}`, 15000, '首页');
  };
  const zhTexts = () => b.ev(`${QA('.lines .line')}.map((l)=>l.querySelector('.zh')?.textContent?.trim()||'')`);
  const posts = () => fake.reqs.filter((r) => r.method === 'POST').length;
  let T = null;
  try {
    // ---- A：配置指向假接口，zh-CN 界面 + 学英语，打开 titled.mkv ----
    setCfg(true);
    T = await newB('e2e-tr', 9360);
    b = T;
    await prefs('zh-CN', 'en');
    await openFilm('titled.mkv');
    const n = (await lineTexts()).length;
    await b.waitFor(`${QA('.lines .line .zh')}.filter((e)=>e.textContent.includes('〔译〕')).length===${n}`, 20000, '译文出现在每一行');
    const zh = await zhTexts();
    const want = [...Array(n).keys()].map((i) => tag(fake.text.get(i + 1) || ''));
    check('翻译：打开 titled.mkv 后列表每一行下面出现译文，内容和假接口返回的一致', zh.length === n && zh.every((x, i) => x === want[i] && x.length > 3), JSON.stringify(zh.slice(0, 2)));
    const fogInfo = await b.ev(`({enFog:${QA('.lines .line .text .sub-mosaic')}.length, zhFog:${QA('.lines .line .zh .sub-mosaic, .lines .line .zh.sub-mosaic')}.length})`);
    check('翻译：在学语言那行仍遮盖、译文那行不遮盖', fogInfo.enFog > 0 && fogInfo.zhFog === 0, JSON.stringify(fogInfo));
    await b.shot(`${SHOTS}tr-player.png`);

    const cur = fake.reqs.slice();
    const only = cur.length > 0 && cur.every((r) => r.method === 'POST' && r.url === '/v1/chat/completions' && r.model === MODEL);
    check('翻译：请求只发往配置的地址（末尾斜杠不重复）、都是 POST', only, JSON.stringify(cur.slice(0, 2)));
    check('翻译：请求带 Authorization（Bearer 假密钥）', cur.length > 0 && cur.every((r) => r.auth === `Bearer ${KEY}`), String(cur[0]?.auth || '').replace(KEY, '<假密钥>'));
    check('翻译：请求体只有 model 和 messages', cur.length > 0 && cur.every((r) => r.bodyKeys?.join() === 'messages,model'), String(cur[0]?.bodyKeys));
    const outA = T.reqs.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith(`http://127.0.0.1:${fakePort}/`) && !/^(blob|data):/.test(r.url));
    check('翻译：除了配置的地址，站外请求仍为 0', outA.length === 0, outA.slice(0, 2).map((r) => r.url).join(' '));

    // 设置里出现译文那一行（只有开了翻译才有）
    await b.ev(`${Q('.lm-ctl .lm-ib:last-child')}.click()`);
    await sleep(300);
    const segsOn = await b.ev(`${QA('.lm-set .lm-seg')}.length`);
    check('翻译：设置里多出一行译文开关（配置为空时没有）', segsOn === segEmpty + 1, `开 ${segsOn} 组，空配置 ${segEmpty} 组`);
    await b.ev(`${Q('.lm-dim')}.click()`);
    await sleep(300);

    // 排序面板：译文遮盖，点开 = 看译文
    await enterPractice('排序');
    await b.waitFor(`!!${Q('.sort-zh')}`, 10000, '排序面板出现译文行');
    await sleep(500);
    const sortZh = await b.ev(`(()=>{const z=${Q('.sort-zh')};return {mask:!!z.querySelector('.sub-mosaic'), text:z.textContent.trim()}})()`);
    check('翻译：排序面板里译文行出现，手上这题译文先遮盖', sortZh.mask, JSON.stringify(sortZh));
    await b.shot(`${SHOTS}tr-sort.png`);
    await b.waitFor(`!!${Q('.sort-zh .mask-text.is-ready')}`, 40000, '译文遮盖冷却结束可点开').catch(() => false);
    await b.ev(`(()=>{const m=${Q('.sort-zh .mask-text')};if(m)m.click();return 1})()`);
    await sleep(500);
    const peeked = await b.ev(`(()=>{const z=${Q('.sort-zh')};return {mask:!!z.querySelector('.sub-mosaic'), text:z.textContent.trim()}})()`);
    check('翻译：点开遮盖的译文（看译文）后译文亮出来', !peeked.mask && peeked.text.includes('〔译〕'), JSON.stringify(peeked));

    // 听写面板
    await b.ev(`${Q('.lm-grab')}.click()`);
    await sleep(400);
    await enterPractice('听写');
    await b.waitFor(`!!${Q('.dict-panel')} && !!${Q('.sort-zh')}`, 10000, '听写面板出现译文行');
    await sleep(500);
    const dictZh = await b.ev(`${Q('.sort-zh')}.textContent.trim()`);
    const dictMask = await b.ev(`!!${Q('.sort-zh .sub-mosaic')}`);
    check('翻译：听写面板里译文行出现（遮盖或已亮出）', dictMask || dictZh.includes('〔译〕'), dictZh.slice(0, 40));
    await b.shot(`${SHOTS}tr-dictate.png`);

    // ---- B：关掉再打开同一个视频，不再请求 ----
    const before = posts();
    await openFilm('titled.mkv');
    await b.waitFor(`${QA('.lines .line .zh')}.filter((e)=>e.textContent.includes('〔译〕')).length===${n}`, 20000, '再次打开后译文从缓存出现');
    await sleep(1500);
    check('翻译：关掉再打开同一个视频，译文还在、假接口没有收到新请求（走缓存）', posts() === before && before > 0, `之前 ${before}，之后 ${posts()}`);

    // ---- 密钥不外露 ----
    const leak = await b.ev(`(()=>{const k=${JSON.stringify(KEY)};let ls='';try{ls=JSON.stringify({...localStorage})}catch{}
      return {page:(document.body.innerText+${R}.innerHTML+document.documentElement.outerHTML).includes(k), ls:ls.includes(k)}})()`);
    const inLogs = T.logs.some((l) => l.includes(KEY)) || T.errors.some((l) => l.includes(KEY)) || T.reqs.some((r) => r.url.includes(KEY));
    check('翻译：密钥不出现在页面文字、localStorage、控制台输出、请求地址里', !leak.page && !leak.ls && !inLogs, JSON.stringify({ ...leak, inLogs }));
    check('翻译：配置了接口时页面没有未捕获的错误', T.errors.filter((e) => !/favicon/.test(e)).length === 0, T.errors.slice(0, 2).join(' | ').slice(0, 200));

    // ---- C：在学语言＝界面语言：不翻、不请求 ----
    const p0 = fake.reqs.length;
    await prefs('en', 'en');
    await openFilm('titled.mkv');
    await sleep(2500);
    const zhC = await zhTexts();
    check('翻译：在学语言和界面语言相同（英语界面学英语）时不请求、没有译文行', fake.reqs.length === p0 && zhC.every((x) => !x), `新增请求 ${fake.reqs.length - p0}`);
    await enterPractice('排序', 'Practice');
    await b.waitFor(`!!${Q('.sort-panel, .sort-bank')}`, 10000, '排序面板出现').catch(() => false);
    await sleep(500);
    const emptyBlocks = await b.ev(`${QA('.sort-foot, .sort-zh')}.length`); const panelUp = await b.ev(`!!${Q('.sort-panel')}`);
    check('翻译：在学语言＝界面语言时排序面板里没有空的译文块', panelUp && emptyBlocks === 0, `译文块 ${emptyBlocks}`);
    T.close(); T = null;

    // ---- D：接口出错 ----
    for (const mode of ['500', 'garbage', 'short']) {
      fake.mode = mode;
      fake.reqs.length = 0;
      T = await newB(`e2e-tr-${mode}`, 9362);
      b = T;
      await prefs('zh-CN', 'en');
      await openFilm('titled.mkv');
      await sleep(3500);
      const rows = (await lineTexts()).length;
      const st = await b.ev(`({pending:${QA('.lines .line .zh.pending')}.length, popups:${QA('[role=dialog],[role=alert]')}.length, zhRows:${QA('.lines .line .zh')}.filter((e)=>e.textContent.trim()).length})`);
      const errs = T.errors.filter((e) => !/favicon/.test(e));
      const shown = await zhTexts();
      const okTexts = shown.every((x) => !x || x.startsWith('〔译〕'));
      const label = mode === '500' ? '接口返回 500' : mode === 'garbage' ? '返回不是 JSON 的文字' : '行数不对';
      check(`翻译出错（${label}）：列表还在、没有未捕获的错误、没有弹窗、没译文的行没有占位`,
        rows > 0 && errs.length === 0 && st.popups === 0 && st.pending === 0 && okTexts && (mode === 'short' || st.zhRows === 0),
        `${rows} 行，译文 ${st.zhRows} 行，占位 ${st.pending}，弹窗 ${st.popups}，错误 ${errs.slice(0, 1).join('').slice(0, 100)}`);
      if (mode === 'short') {
        const first = fake.reqs[0]?.n || 0;
        check('翻译出错（行数不对）：拆小重试，之后的请求行数比第一次少，最后全部有译文', first >= 3 && fake.reqs.length > 1 && fake.reqs.slice(1).some((r) => r.n < first) && st.zhRows === rows, `各次行数 ${fake.reqs.map((r) => r.n).join(',')}，译文 ${st.zhRows}/${rows}`);
      }
      if (mode === '500') {
        check('翻译出错（接口返回 500）：不拆小、不重发，这一批只发了一个请求', posts() === 1, `请求 ${posts()} 个`);
        // 出错的下次打开再试：接口恢复后再开同一个视频，会重新翻出来（失败没有被存进缓存）
        fake.mode = 'ok';
        await openFilm('titled.mkv');
        await b.waitFor(`${QA('.lines .line .zh')}.filter((e)=>e.textContent.includes('〔译〕')).length===${rows}`, 20000, '接口恢复后重开能翻出来').catch(() => false);
        check('翻译出错后：接口恢复，再打开同一个视频会重新翻出来', (await zhTexts()).every((x) => x.includes('〔译〕')), '');
      }
      T.close(); T = null;
    }

    // ---- E：密钥不对（接口回 401），长片有几十批：头两批被拒就整部停，不把每一批都发一遍 ----
    if (existsSync(`${FIX}zh-long.mkv`)) {
      fake.mode = '401';
      fake.reqs.length = 0;
      T = await newB('e2e-tr-401', 9362);
      b = T;
      await prefs('en', 'zh');
      await openFilm('zh-long.mkv');
      await sleep(4000);
      const rows = (await lineTexts()).length;
      check('翻译出错（密钥不对）：长片只发头两个请求就停，列表照常', rows > 60 && posts() >= 1 && posts() <= 2 && T.errors.filter((e) => !/favicon/.test(e)).length === 0, `${rows} 行，请求 ${posts()} 个`);
      T.close(); T = null;
    }
  } catch (e) {
    fail = fail || e;
    console.log(`翻译用例没走完：${String(e.stack || e).split('\n').slice(0, 3).join('\n  ')}`);
    await b.shot(`${SHOTS}fail-tr.png`).catch(() => {});
  } finally {
    try { T?.close(); } catch { /* 无 */ }
    b = mainB;
    fake.srv.close();
    setCfg(false);
  }

  // 14 种界面语言：译文用到的键都在（含从原仓库取回的）
  const keys = ['translating', 'trProgress', 'trError', 'trFetching', 'sortZhFailed'];
  const miss = [];
  for (const lg of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'tr', 'ar', 'hi', 'vi']) {
    const src = readFileSync(`${WEB}src/i18n/${lg}.js`, 'utf8');
    for (const k of keys) if (!new RegExp(`^\\s*${k}:\\s*['"\`]\\S`, 'm').test(src)) miss.push(`${lg}.${k}`);
  }
  const mTr = (readFileSync(`${WEB}src/lite/liteText.js`, 'utf8').match(/^\s*mTr: /gm) || []).length;
  if (mTr !== 14) miss.push(`liteText.mTr 共 ${mTr} 份`);
  check('14 种界面语言：译文相关的键一个不缺（含取回的键）', miss.length === 0, miss.slice(0, 6).join('、'));
}


// ===== 不改 attachShadow 的冒烟：原样的页面能播放、没有未捕获错误 =====
{
  const SP = `${TMP}chrome-profile-e2e-smoke`;
  rmSync(SP, { recursive: true, force: true });
  const b2 = new Browser({ chrome: CHROME, profile: SP, fromPort: 9340, width: 1280, height: 800, locale: 'zh-CN', openShadow: false });
  try {
    await b2.launch();
    await b2.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{window.__vids=[];const c=document.createElement.bind(document);document.createElement=function(t,o){const e=c(t,o);if(String(t).toLowerCase()==='video')window.__vids.push(e);return e}})()` });
    await b2.send('Page.navigate', { url: `${origin}/` });
    await b2.waitFor(`document.readyState==='complete' && !!document.querySelector('input[type=file]')`, 15000, '冒烟首页');
    await b2.setFile('input[type=file]', [FIX + 'titled.mkv']);
    const st = await b2.waitFor(`(()=>{const v=(window.__vids||[]).find((x)=>x.currentTime>0.5&&!x.paused);return v?{t:v.currentTime,closed:!document.querySelector('[data-earu-demo]').shadowRoot}:null})()`, 30000, '视频在播放');
    check('冒烟（原样 closed shadow）：视频在播放', !!st, `currentTime=${st?.t?.toFixed?.(2)}，shadow 是 closed=${st?.closed}`);
    await b2.shot(`${SHOTS}smoke.png`);
    const e2 = b2.errors.filter((e) => !/favicon/.test(e));
    check('冒烟：没有未捕获的错误', e2.length === 0, e2.slice(0, 3).join(' | ').slice(0, 300));
    const out2 = b2.reqs.filter((r) => !r.url.startsWith(origin) && !/^(blob|data):/.test(r.url));
    check('冒烟：站外请求数为 0', out2.length === 0, String(out2.length));
  } catch (e) {
    check('冒烟（原样 closed shadow）：视频在播放', false, String(e.message || e).slice(0, 200));
  } finally { b2.close(); }
}

// ===== 网络与控制台 =====
const outside = b.reqs.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
const api = b.reqs.filter((r) => /^\/api(\/|$)/.test(new URL(r.url, origin).pathname));
writeFileSync(`${LOGS}e2e-network.txt`, [`本站：${origin}`,
  `请求总数 ${b.reqs.length}；本站 ${b.reqs.filter((r) => r.url.startsWith(origin)).length}；blob/data ${b.reqs.filter((r) => /^(blob|data):/.test(r.url)).length}；站外 ${outside.length}；/api ${api.length}`, '',
  ...b.reqs.map((r) => `${r.method} ${r.url.slice(0, 200)}`)].join('\n'));
check('网络：站外请求数为 0', outside.length === 0, `${outside.length}；共 ${b.reqs.length} 条`);
check('网络：/api 请求数为 0', api.length === 0, String(api.length));
const errs = b.errors.filter((e) => !/favicon/.test(e));
check('控制台：没有未捕获的错误', errs.length === 0, errs.slice(0, 3).join(' | ').slice(0, 300));

b.close();
srv.close();
await sleep(500);
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 条通过${fail ? '（中途出错）' : ''}`);
process.exit(bad.length || fail ? 1 : 0);
