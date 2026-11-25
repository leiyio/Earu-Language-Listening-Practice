import { t } from '../i18n/index.js';

// 「正在获取X翻译…」：前面四根声波竖条依次跳。
// 播放画面字幕、排序、听写的译文行都用这一个；字号颜色跟着所在那一行（styles.css 的 .tr-pending）
export default function TrPending() {
  return (
    <span className="tr-pending">
      <span className="tr-wave" aria-hidden><i /><i /><i /><i /></span>
      {t('trFetching')}
    </span>
  );
}
