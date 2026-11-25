// 手上这一题的打码：不把字幕和译文藏起来，而是打码，让人知道它们在、偷看就是提示。
// 样子和别的句子的字幕打码一模一样：同一种雾（.sub-mosaic）。底下排的就是这句真字，不排长短差不多的假字（假字和真字宽窄不一样，
// 同一句观影、练习打出来的码会一长一短）。
// 只是练习、不是考试，就排真字，和「字幕打码」那层一模一样。
// 点开就是提示：原文 = 「提示 2 秒」，译文 = 亮到这一句结束、记一次提示（App 接 session.hint / session.peekZh）；鼠标移上去是手形、悬停说明，
// 冷却里点不开（点了说一声为什么，触屏没有悬停）。
//   text：底下那句；className / attrs：和这一层不打码时那个 span 一样（'en' / 'zh'、learnAttrs / nativeAttrs），字号字体跟着走；
//   info：display.js maskInfo 给的 {avail, look, title}；onPeek：点开（avail 时）；toast：点不开时说为什么；
//   still：不能点的那种（字幕列表里打码的行：点一行照旧是跳过去听，不拦这一下），和别的雾行一样不接鼠标、读屏跳过；
//     也吹不开（.fog-lock，components/subFog.js 跳过它）：这是手上这道题的答案，和画面上那份 .mask-text 一样只能「提示一下」才看得到；
//   fold：「先亮后收」（排对第一题以后，下一题的译文先亮一下、再淡成雾）——这一次底下的真字照常画出来，
//   淡完了 App 把 fold 去掉，只剩打码那层（styles.css .mask-fold）。只给译文用（原文是答案，从不先亮）
export default function MaskText({ text = '', info = null, onPeek, toast, still = false, fold = false, className = '', attrs = null }) {
  const cls = `${className ? `${className} ` : ''}sub-mosaic`;
  if (still) return <span className={`${cls} fog-lock`} {...attrs} aria-hidden>{text}</span>;
  const look = info?.look || 'wait';
  const title = info?.title || '';
  const peek = () => { if (info?.avail) onPeek?.(); else if (title) toast?.(title); };
  const masked = (
    <span className={`${cls} mask-text is-${look}`} {...attrs} role="button" tabIndex={0}
      title={title || undefined} aria-label={title || undefined} aria-disabled={!info?.avail || undefined}
      // 挂在画面上时：这一下不是「点画面暂停 / 双击全屏」，也不是手机上点画面出控制条
      onClick={(e) => { e.stopPropagation(); peek(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); peek(); } }}
      onDoubleClick={(e) => e.stopPropagation()}>{text}</span>
  );
  if (!fold) return masked;
  return <span className="mask-fold"><span className={`${className ? `${className} ` : ''}mask-fold-text`} {...attrs} aria-hidden>{text}</span>{masked}</span>;
}

