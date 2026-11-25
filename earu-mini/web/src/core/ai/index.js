// 开发者自己填的 AI 接口 → 母语译文。整个程序里只有这一个模块知道配置、密钥和接口格式；
// 对外只给两样：「开没开」（aiOn / useAiOn / translationTarget）和「翻译这些行」（translateLines）。
// 配置：启动时读一次本站 ./config.json（{ ai: { baseUrl, apiKey, model } }），读不到、格式坏、三项没填全都当没开，不报错、不联网。
// 接口：通用聊天补全格式，POST {baseUrl}/chat/completions，Bearer 密钥，请求体只有 model 和 messages，读 choices[0].message.content。
// 密钥只在 request() 里用，只发给配置的地址；不写日志、不存本机、不进任何报错文字。
import { useSyncExternalStore } from 'react';
import { nativeOf, learnOf } from '../../../../shared/langs.js';
import { readCache, writeCache } from './cache.js';
import { parseNumbered } from './parse.js';

let cfg = null;          // { base, key, model } | null
let ready = false;
const subs = new Set();
const emit = () => { for (const f of [...subs]) { try { f(); } catch { /* 订阅者出错不挡别的 */ } } };

const clean = (x) => (typeof x === 'string' ? x.trim() : '');
export function setConfig(raw) {
  const a = raw && typeof raw === 'object' ? raw.ai : null;
  const base = clean(a?.baseUrl).replace(/\/+$/, ''), key = clean(a?.apiKey), model = clean(a?.model);
  cfg = base && key && model ? { base, key, model } : null;
  ready = true;
  emit();
}

let loading = null;
export function loadConfig(url = './config.json') {
  if (!loading) {
    loading = (async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        setConfig(r.ok ? await r.json() : null);
      } catch { setConfig(null); }
    })();
  }
  return loading;
}

const getOn = () => !!cfg;
const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const aiOn = () => getOn();
export const useAiOn = () => useSyncExternalStore(onChange, getOn, getOn);
export const aiReady = () => ready;

// 译成哪种语言：译文语言＝界面语言（母语）；没开、或在学的语言就是界面语言时不翻（null）
export function translationTarget(uiLang, learn) {
  if (!cfg) return null;
  const native = nativeOf({ uiLang });
  return learnOf(native) === learn ? null : native;
}

const NAMES = {
  en: 'English', de: 'German', fr: 'French', ja: 'Japanese', ko: 'Korean', tr: 'Turkish', ru: 'Russian', es: 'Spanish',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', pt: 'Portuguese', ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese',
};
const BATCH = 30, PARALLEL = 2, TIMEOUT = 60000;

const promptFor = (lang) => [
  { role: 'system', content: `You translate subtitle lines into ${NAMES[lang] || lang}. The user sends numbered lines. Translate each line on its own, naturally and briefly, keeping names and tone. Reply with JSON only: an object whose keys are the same numbers and whose values are the translations. No comments, no extra text.` },
];

async function request(lang, items, signal) {
  const c = cfg;
  if (!c) return null;
  const user = items.map((x) => `${x.n}: ${x.text}`).join('\n');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${c.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.model, messages: [...promptFor(lang), { role: 'user', content: user }] }),
      signal: ctl.signal,
    });
    // 接口不认（密钥、地址、模型名不对）：后面的批也一样会被拒，整部停掉；别的报错只丢这一批
    if (!res.ok) return { down: true, stop: res.status === 401 || res.status === 403 || res.status === 404 };
    const data = await res.json();
    return { got: parseNumbered(data?.choices?.[0]?.message?.content, items.map((x) => x.n)) };
  } catch { return { down: true }; } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// 一批：整批对得上就收；回了内容但行数对不上，拆成两半各重试一次，还不行那半留空。
// 接口本身报错、连不上、超时：不拆、不重发（重发也是一样的结果，只会多花请求）。返回 { got, stop }
async function doBatch(lang, items, signal) {
  const r = await request(lang, items, signal);
  if (!r || r.down) return { got: {}, stop: !!r?.stop };
  if (r.got) return { got: r.got };
  if (signal?.aborted || items.length < 2) return { got: {} };
  const mid = Math.ceil(items.length / 2);
  const out = {};
  for (const half of [items.slice(0, mid), items.slice(mid)]) {
    const g = await request(lang, half, signal);
    if (g?.got) Object.assign(out, g.got);
    if (signal?.aborted || g?.down) break;
  }
  return { got: out };
}

// 翻译一部字幕。lines：[{text}]；key：字幕指纹（缓存按 key + 译文语言存）；lang：译文语言；
// getNear()：当前播放到第几句（离它近的批先翻）；onUpdate(texts)：每到一批（和读完缓存）回一次整份数组（没翻到的是 null）。
// 出错的批留空、不抛；返回 { texts, failed }（failed：没翻到的句数）。signal 中止后不再发请求。
export async function translateLines({ lines, key, lang, getNear = () => 0, onUpdate = () => {}, signal }) {
  const texts = lines.map(() => null);
  if (!cfg || !lang || !key || !lines.length) return { texts, failed: 0 };
  const ck = `${key}|${lang}`;
  const cached = await readCache(ck);
  if (signal?.aborted) return { texts, failed: lines.length };
  if (cached) cached.forEach((v, i) => { if (i < texts.length && typeof v === 'string' && v) texts[i] = v; });
  const todo = [];
  for (let i = 0; i < lines.length; i++) if (texts[i] == null && String(lines[i].text ?? '').trim()) todo.push(i);
  onUpdate(texts.slice());
  const batches = [];
  for (let k = 0; k < todo.length; k += BATCH) batches.push(todo.slice(k, k + BATCH));
  const dist = (b) => { const n = getNear(); return Math.min(...b.map((i) => Math.abs(i - n))); };
  let stopped = false;
  const worker = async () => {
    while (batches.length && !signal?.aborted && cfg && !stopped) {
      let best = 0;
      for (let k = 1; k < batches.length; k++) if (dist(batches[k]) < dist(batches[best])) best = k;
      const b = batches.splice(best, 1)[0];
      const { got, stop } = await doBatch(lang, b.map((i) => ({ n: i + 1, text: String(lines[i].text).replace(/\s*\n\s*/g, ' ') })), signal);
      if (stop) stopped = true;
      if (signal?.aborted) return;
      let any = false;
      for (const i of b) if (typeof got[i + 1] === 'string') { texts[i] = got[i + 1]; any = true; }
      if (any) { onUpdate(texts.slice()); await writeCache(ck, texts); }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { texts, failed: todo.filter((i) => texts[i] == null).length };
}
