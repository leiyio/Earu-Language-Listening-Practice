// 解析模型回的内容：宽容——去掉代码围栏、前后的废话，认「按编号的对象」或「按顺序的数组」。
// 返回 { [编号]: 文字 }；编号不全、类型不对都由调用方按行数核对。
const stripFence = (s) => s.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');

function sliceJson(s) {
  const o = s.indexOf('{'), a = s.indexOf('[');
  const first = o >= 0 && (a < 0 || o < a) ? '{' : a >= 0 ? '[' : '';
  if (!first) return null;
  const last = s.lastIndexOf(first === '{' ? '}' : ']');
  const from = first === '{' ? o : a;
  return last > from ? s.slice(from, last + 1) : null;
}

export function parseNumbered(content, ids) {
  if (typeof content !== 'string') return null;
  const body = sliceJson(stripFence(content));
  if (!body) return null;
  let v;
  try { v = JSON.parse(body); } catch { return null; }
  const out = {};
  if (Array.isArray(v)) {
    if (v.length !== ids.length) return null;
    v.forEach((x, k) => { out[ids[k]] = x; });
  } else if (v && typeof v === 'object') {
    for (const id of ids) out[id] = v[id] ?? v[String(id)];
  } else return null;
  for (const id of ids) {
    const x = out[id];
    if (typeof x !== 'string' || !x.trim()) return null;
    out[id] = x.trim();
  }
  if (!Array.isArray(v) && Object.keys(v).length !== ids.length) return null;
  return out;
}
