// 本机版译文：把当前这部字幕交给 core/ai 翻（有缓存先读缓存），给界面一份「按句编号的译文数组 + 状态」。
// 没开（没填 AI 接口）、在学的语言就是界面语言、字幕还没读全：on 为假、texts 为 null，什么都不发。
import { useEffect, useRef, useState } from 'react';
import { translateLines, translationTarget, useAiOn } from '../core/ai/index.js';
import { useUiLang } from '../i18n/useUiLang.js';

const IDLE = Object.freeze({ id: null, texts: null, running: false, failed: 0 });

export function useTranslation({ lines, subKey, learn, near }) {
  const uiLang = useUiLang();
  const aiOn = useAiOn();
  const target = aiOn ? translationTarget(uiLang, learn) : null;
  const [st, setSt] = useState(IDLE);
  const nearRef = useRef(0);
  nearRef.current = near;
  const id = target && subKey ? `${subKey}|${target}` : null;

  useEffect(() => {
    if (!id || !lines.length) { setSt(IDLE); return undefined; }
    const ctl = new AbortController();
    const live = (f) => { if (!ctl.signal.aborted) f(); };
    setSt({ id, texts: null, running: true, failed: 0 });
    translateLines({
      lines, key: subKey, lang: target, signal: ctl.signal,
      getNear: () => Math.max(0, nearRef.current),
      onUpdate: (texts) => live(() => setSt((s) => ({ ...s, id, texts }))),
    }).then((r) => live(() => setSt((s) => ({ ...s, running: false, failed: r.failed }))))
      .catch(() => live(() => setSt((s) => ({ ...s, running: false, failed: 1 }))));
    return () => ctl.abort();
  }, [id, lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = st.id === id && id != null;
  const texts = mine ? st.texts : null;
  return {
    on: !!id, target,
    texts: id ? (texts || lines.map(() => null)) : null,
    pending: mine && st.running,
    failed: mine && !st.running ? st.failed : 0,
    done: texts ? texts.filter((x) => x != null).length : 0,
    total: lines.length,
  };
}
