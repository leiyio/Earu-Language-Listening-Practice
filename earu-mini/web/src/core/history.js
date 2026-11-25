// 播放记录：存在浏览器的 IndexedDB 里（只在这台电脑这个浏览器上）。
// 每条记录带一个文件句柄（FileSystemFileHandle），下次点一下就能重新打开本地文件，不用再选；
// 句柄只有 Chrome/Edge 有，拿不到句柄的记录只能看、不能直接打开。
// 记录不分人，id 就是文件指纹。
// 【文件句柄单独存】：句柄放在另一张表 handles（id → handle），播放记录里只记 hasHandle。
// 原因：关标签页的那一刻（visibilitychange / pagehide）useProgressSaver 要存进度，以前是把整条记录连同句柄重新 put 一遍——
// Chrome 154 在页面拆到一半时序列化 FileSystemFileHandle 会把整个浏览器（主进程）带崩（
// 无头 Chrome 复现：拖进来拿到句柄、播着、关标签页 → 浏览器退出 0x80000003；关页面时不存就不崩）。句柄只在打开文件那一下写，
// 进度、缩略图怎么存都碰不到它。老库（第 1 版，句柄在记录里）升级时搬过去
const DB = 'earu';
const STORE = 'history';
const HANDLES = 'handles';
const MAX = 50;       // 最近播放留 50 条

let dbp = null;
function db() {
  dbp ||= Promise.resolve().then(() => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      const t = req.transaction;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(HANDLES)) {
        d.createObjectStore(HANDLES, { keyPath: 'id' });
        // 搬家：老记录里的句柄挪到 handles，记录里只留 hasHandle
        const hs = t.objectStore(HANDLES);
        const cur = t.objectStore(STORE).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          const { handle, ...rest } = c.value;
          if (handle) { hs.put({ id: rest.id, handle }); c.update({ ...rest, hasHandle: true }); }
          c.continue();
        };
      }
    };
    req.onsuccess = () => {
      const d = req.result;
      // 别的标签页要升级库：让出来（下次用时重新打开）
      d.onversionchange = () => { d.close(); dbp = null; };
      resolve(d);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
  }));
  return dbp;
}

// 在一张或几张表上开一个事务；fn 拿到的是第一张表（names 只有一张时）或 {表名: 表}。
// fn 回一个请求（get、getAll）就交出它的结果。get 找不到时结果是 undefined：以前写的 `out?.result ?? out` 这时把请求对象本身交出去，
// getEntry 拿到的不是空，touchEntry 当成「这个 id 有旧记录」（一条什么都没有的），按名字 + 大小找旧那条一次都没走到——
// 重新选同一部片从头放。无头 Chrome 端到端测出来的
async function tx(mode, fn, names = STORE) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const list = [].concat(names);
    const t = d.transaction(list, mode);
    const arg = list.length === 1 ? t.objectStore(list[0]) : Object.fromEntries(list.map((n) => [n, t.objectStore(n)]));
    const out = fn(arg);
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    // An aborted transaction does not always fire `error`; without this the promise would never settle.
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}
const dropBoth = (ids) => tx('readwrite', (s) => ids.forEach((id) => { s[STORE].delete(id); s[HANDLES].delete(id); }), [STORE, HANDLES]);
async function getHandle(id) {
  try { return (await tx('readonly', (s) => s.get(id), HANDLES))?.handle ?? null; } catch { return null; }
}

// 看完了：剩下的不到片长 3%（最多 30 秒，片尾字幕那一段）
export const isFinished = (pos, dur) => !!dur && dur - pos < Math.min(30, dur * 0.03);

// 同一个文件：名字 + 大小 + 修改时间都一样
export const fileId = (file) => `${file.name}|${file.size}|${file.lastModified}`;

// 最近播放：新的在前
export async function listHistory() {
  try {
    return (await tx('readonly', (s) => s.getAll())).sort((x, y) => y.openedAt - x.openedAt);
  } catch { return []; }
}

// 超出上限就删最旧的
async function trimHistory() {
  const all = await listHistory();
  if (all.length > MAX) await dropBoth(all.slice(MAX).map((e) => e.id));
}

export async function getEntry(id) {
  try { return (await tx('readonly', (s) => s.get(id))) ?? null; } catch { return null; }
}

// 认「同一部片」放宽到名字 + 大小：有的系统每次选文件都另拷一份，修改时间会变
export const looseMatch = (mine, file) => mine.find((e) => e.name === file.name && e.size === file.size) || null;

// 打开文件时记一笔（保留之前的进度、缩略图、字幕轨选择）。
export async function touchEntry(file, kind, handle) {
  try {
    const id = fileId(file);
    const prev = await getEntry(id);
    const { handle: _old, id: _oldId, ...old } = prev || {};
    const entry = {
      position: 0, duration: 0, thumb: null, subId: null,
      ...old,
      id, name: file.name, size: file.size, lastModified: file.lastModified, kind,
      hasHandle: !!handle || (!!prev && !!old.hasHandle),
      openedAt: Date.now(),
    };
    // 句柄只在这里（打开文件那一下）写，进度那些以后怎么存都碰不到它
    const put = (withHandle) => tx('readwrite', (s) => {
      s[STORE].put(entry);
      if (withHandle) s[HANDLES].put({ id, handle });
    }, [STORE, HANDLES]);
    try {
      await put(!!handle);
    } catch (e) {
      // The handle could not be stored: keep the entry itself, without the handle.
      if (!handle) throw e;
      entry.hasHandle = !!prev && !!old.hasHandle;
      await put(false);
    }
    await trimHistory();
    return entry;
  } catch { return null; }
}

export async function updateEntry(id, patch) {
  try {
    const old = await getEntry(id);
    if (!old) return;
    const { handle: _h, ...rest } = old;   // 万一还带着句柄（搬家没搬完）也不再写回去
    await tx('readwrite', (s) => s.put({ ...rest, ...patch }));
  } catch { /* 记录失败不影响播放 */ }
}

export async function removeEntry(id) {
  try { await dropBoth([id]); } catch { /* 忽略 */ }
}

// fileFromEntry 失败时给用户看哪句话（文案键，参数 { name }）。沙盒环境只能读这次打开期间选过的文件，
// 重启后句柄读不出来不是文件丢了，说「要重新选一次」；别处照旧
export function recentFileErrorKey(err) {
  const code = err?.code;
  if (code === 'missing') return 'recentMissing';
  return code === 'denied' ? 'recentDenied' : 'recentNoHandle';
}

// 用句柄重新拿到文件。必须在用户点击里调用（要申请读取权限）。
// 失败抛出 Error，code: 'nohandle' | 'denied' | 'missing'
export async function fileFromEntry(entry) {
  const h = entry.handle || (await getHandle(entry.id));
  if (!h?.getFile) throw Object.assign(new Error('nohandle'), { code: 'nohandle' });
  let p = await h.queryPermission?.({ mode: 'read' });
  if (p !== 'granted') p = await h.requestPermission?.({ mode: 'read' });
  if (p !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' });
  try {
    return await h.getFile();
  } catch {
    throw Object.assign(new Error('missing'), { code: 'missing' });
  }
}
