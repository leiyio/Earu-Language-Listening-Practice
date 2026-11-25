// 译文的本机缓存（IndexedDB）：按「字幕指纹 + 译文语言」存一份按句编号排的译文数组（没翻到的句子是 null）。
// 读写出任何错（无痕模式、被禁用、配额）都当没缓存，不抛。
const DB = 'earu-translation';
const STORE = 'texts';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

const run = async (mode, fn) => {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
};

export async function readCache(key) {
  try {
    const v = await run('readonly', (s) => s.get(key));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

export async function writeCache(key, texts) {
  try { await run('readwrite', (s) => s.put(texts, key)); } catch { /* 存不了：下次再翻 */ }
}
