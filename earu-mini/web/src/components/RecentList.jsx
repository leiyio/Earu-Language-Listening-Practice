import { useCallback, useRef, useState } from 'react';
import { t, isRtlUi } from '../i18n/index.js';
import { renderLang } from '../i18n/lang.js';
import { isFinished, looseMatch } from '../core/history.js';
import { cardTitle } from '../core/title.js';
import { acceptFor } from './PickButton.jsx';

// 片长 / 看到哪：12:14、1:02:03（示例片卡片 SampleCard 也用）
export const fmtDur = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// 一个月以前的写日期，日期的写法跟着界面语言（如 2026/9/3、9/3/2026）
export function ago(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return t('recentJustNow');
  if (d < 3600) return t('recentMinAgo', { n: Math.floor(d / 60) });
  if (d < 86400) return t('recentHourAgo', { n: Math.floor(d / 3600) });
  if (d < 86400 * 30) return t('recentDayAgo', { n: Math.floor(d / 86400) });
  return new Date(ts).toLocaleDateString(renderLang());
}

// 起始页一排放几张（方案 A：一排 4 张卡）；多的收起来，标题旁边「全部 N 个」点开
export const RECENT_SHOWN = 4;

// 卡上第二行：看完了 / 看到哪 / 还没开始 · 多久以前（宽窄两种布局一样）。
// m：窄屏的一行——放不下就折行（styles.css），「· 多久以前」那个 span 不断开、整段折到下一行；它前面的空格挪到 span 外面，
// 不然空格在不折行的 span 里，「·」前面没有能折的地方，浏览器只好在「02:53 /」后面折，把看到哪和片长拆到两行（360 宽时看到的）
const metaOf = (e, done, m = false) => {
  const at = done ? t('recentDone') : e.position > 1 ? t('recentAt', { at: fmtDur(e.position), dur: fmtDur(e.duration) }) : t('recentNotStarted');
  return m ? <>{at} <span>· {ago(e.openedAt)}</span></> : <>{at}<span> · {ago(e.openedAt)}</span></>;
};

// 触屏设备点「最近播放」的一行：网页不知道文件在设备的哪个文件夹，也没法让选文件框从某个文件夹开，
// 能做的：点一下当场弹选文件框——和「选择视频文件」同一种框（PickButton acceptFor：iPhone 直接进「文件」，
// 安卓是它自己的选择器、最近文件），同时底下提示一句要选哪个文件（「请选择「文件名」」，短提示，过几秒自己没了，不挂在页面上）；
// 选回来的和这一条名字 + 大小对得上（history.js looseMatch：iPhone 每次选都另拷一份，修改时间会变）→ openFile 里 touchEntry
// 按同样的规矩认出是这一条，接着上次的进度放；对不上 → 照常当一部新选的片打开，提示一句「不是上次那个「文件名」」。
// 弹框必须在点击里同步调 input.click()：iPhone 只认手指点下去那一刻直接调的，中间隔一个 await 就不弹（安卓、电脑的 Chrome 也一样要用户手势）。
// iPhone 的「文件」、安卓的选择器都盖住整个页面：提示看得见的是点下去、框升上来那一下，和很快取消回来时；真机上要看一眼够不够。
// 取消（有的浏览器取消也发 change，文件是空的）什么都不做，提示到点自己没了。
// onFile：App 的 openFile（第二个参数 { prefer: 点的那一行 }）；toast / hideToast：App 的短提示（Toast.jsx useToast）。回 { open(entry)：卡片的 onOpen，input：要挂在页面上的选文件框 }。
export const PICK_HINT_MS = 5000;
export function useRecentPick({ onFile, toast, hideToast }) {
  const inputRef = useRef(null);
  const wantRef = useRef(null);
  const open = useCallback((e) => {
    wantRef.current = e;
    inputRef.current?.click();
    toast(t('mRecentPick', { name: e.name }), PICK_HINT_MS);
  }, [toast]);
  const onChange = useCallback((ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    const want = wantRef.current;
    wantRef.current = null;
    if (!file) return;
    if (want && !looseMatch([want], file)) toast(t('mRecentOther', { name: want.name }), PICK_HINT_MS);
    else hideToast?.();
    // 点的是哪一行就交哪一行（prefer）：同一部片以前留下好几条时，接着点的那一行的进度，不是最新那条（touchEntry）
    onFile(file, { prefer: want });
  }, [onFile, toast, hideToast]);
  const input = <input ref={inputRef} type="file" accept={acceptFor()} hidden onChange={onChange} />;
  return { open, input };
}

// 最近播放（播放器起始页）：片名用 parseTitle 整理过的（Family Guy · S20E01 LASIK Instinct），长文件名只放在悬停提示里。
// extra：排在自己的记录后面的那张示例片卡（SampleCard，不是播放记录，core/sample.js）；算一张卡——一排 4 张、「全部 N 个」都把它算上，
// 自己的记录不到 4 条时它在第一排里，多了收进「全部」；没有自己的记录时就只有它这一张。
// compact：窄屏。一条一行，和上面示例片那一行（SampleCard compact）
// 一个样子：海报 112 宽、片名（最多两行）、看到哪，× 一直露着（触屏没有悬停）。不用电脑那种一排两张的卡：390 宽一张卡只有 171 宽，
// 「看到 02:53 / 21:38 · 2 小时前」放不下，× 也只能压在海报角上、手指不好点。示例片不在这里（窄屏上它单占一行，排在这一块上面），
// 标题旁边那句「点一下接着看」不写（窄屏上点了先弹选文件框，不是直接接着看；也不挂操作说明）。点一行：onOpen（App 传 useRecentPick 的 open）
//
// view（可选，首页「观看记录」页用）：不传，上面写的一切一字不变（ui-test、mobile-test 锁着默认标记）。传了（宽屏的卡）：
//   head：换掉标题那一块（null = 不画；页面自己有标题）；limit：最多画几张（不画「全部 N 个」）；
//   thumb(e)：海报里画什么（回 null 用默认的缩略图 / ▶）；badge(e)：压在海报角上的来源小图标；name(e)：卡上的片名；meta(e, done)：片名下面那行（name、meta 回空就用默认的）。
export default function RecentList({ items, onOpen, onRemove, extra = null, compact = false, view = null }) {
  const [all, setAll] = useState(false);
  if (compact) {
    if (!items.length) return null;
    const rows = all ? items : items.slice(0, RECENT_SHOWN);
    return (
      <section className="recent is-m">
        <div className="recent-head">
          <h2>{t('recent')}</h2>
          {items.length > RECENT_SHOWN && (
            <button type="button" className="recent-more" onClick={() => setAll(!all)}>
              {all ? t('recentLess') : t('recentAll', { n: items.length })}
            </button>
          )}
        </div>
        <ul className="recent-rows">
          {rows.map((e) => {
            const pct = e.duration ? Math.min(100, (e.position / e.duration) * 100) : 0;
            const done = isFinished(e.position, e.duration);
            return (
              <li key={e.id} className="recent-row">
                <button type="button" className="recent-row-open" onClick={() => onOpen(e)} title={e.name}>
                  <span className="recent-thumb">
                    {e.thumb && <img src={e.thumb} alt="" />}
                    {pct > 0 && <span className="recent-bar"><i style={{ width: `${pct}%` }} /></span>}
                    <span className="recent-play" aria-hidden>▶</span>
                  </span>
                  <span className="recent-text">
                    <span className="recent-name" dir={isRtlUi() ? 'auto' : undefined}>{cardTitle(e.name)}</span>
                    <span className={`recent-meta${done ? ' is-done' : ''}`}>{metaOf(e, done, true)}</span>
                  </span>
                </button>
                <button type="button" className="recent-row-del" title={t('recentRemove')} aria-label={t('recentRemove')} onClick={() => onRemove(e)}>×</button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  const total = items.length + (extra ? 1 : 0);
  if (!total) return null;
  const shown = view ? items.slice(0, view.limit ?? items.length) : all ? items : items.slice(0, RECENT_SHOWN);
  const showExtra = !!extra && (all || items.length < RECENT_SHOWN);
  return (
    <section className="recent">
      {view ? view.head : (
        <div className="recent-head">
          <h2>{t('recent')}</h2>
          {total > RECENT_SHOWN && (
            <button type="button" className="recent-more" onClick={() => setAll(!all)}>
              {all ? t('recentLess') : t('recentAll', { n: total })}
            </button>
          )}
        </div>
      )}
      <ul className="recent-grid">
        {shown.map((e) => {
          const pct = e.duration ? Math.min(100, (e.position / e.duration) * 100) : 0;
          const done = isFinished(e.position, e.duration);
          const direct = e.hasHandle || e.handle;
          return (
            <li key={e.id} className={`recent-card ${direct ? '' : 'nohandle'}`}>
              <button className="recent-open" onClick={() => onOpen(e)} title={direct ? e.name : t('recentNoHandle', { name: e.name })}>
                <div className="recent-thumb">
                  {(view?.thumb && view.thumb(e)) || (e.thumb ? <img src={e.thumb} alt="" /> : <div className="recent-ph">▶</div>)}
                  {pct > 0 && <div className="recent-bar"><div style={{ width: `${pct}%` }} /></div>}
                  {e.duration > 0 && <span className="recent-dur">{fmtDur(e.duration)}</span>}
                  <span className="recent-play" aria-hidden>▶</span>
                  {view?.badge && view.badge(e)}
                </div>
                {/* 片名多半是英文：阿拉伯语界面里按片名自己的文字定方向（dir="auto"），太长时省略号打在片名的尾巴上、不把开头截掉 */}
                <div className="recent-name" dir={isRtlUi() ? 'auto' : undefined}>{(view?.name && view.name(e)) || cardTitle(e.name)}</div>
                <div className={`recent-meta${done ? ' is-done' : ''}`}>{(view?.meta && view.meta(e, done)) || metaOf(e, done)}</div>
              </button>
              <button className="recent-del" title={t('recentRemove')} aria-label={t('recentRemove')} onClick={() => onRemove(e)}>×</button>
            </li>
          );
        })}
        {showExtra && extra}
      </ul>
    </section>
  );
}
