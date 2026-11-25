// 播放器控制条图标：统一 24×24、白色、2px 线宽
import { t } from '../i18n/index.js';

const Svg =({ children, fill = 'none', size = 24, sw = 2 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke="currentColor" strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

// 顶栏左上角的返回箭头
export const BackIcon = ({ size = 24 }) => <Svg size={size}><path d="M21 12H3M9 5l-7 7 7 7" /></Svg>;
// 放完以后画面正中的重播钮（Player.jsx end-cover）：逆时针绕回的箭头
export const ReplayIcon = ({ size = 24 }) => <Svg size={size}><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></Svg>;
export const PlayIcon = ({ size = 24 }) => <Svg size={size} fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" stroke="none" /></Svg>;
// 字幕列表「回到当前句」的浮动按钮：准星——一圈、中间一点、四个短刻度
export const LocateIcon = ({ size = 22 }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </Svg>
);
export const PauseIcon = ({ size = 24 }) => (
  <Svg size={size} fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" stroke="none" /></Svg>
);

// 上一句 / 下一句：带箭头的圆弧，中间一个「句」（跟着界面语言换，lineGlyph）
const Sentence = ({ back }) => (
  <Svg>
    <g transform={back ? undefined : 'translate(24 0) scale(-1 1)'}>
      <path d="M5.6 7.5A8 8 0 1 1 4 12" />
      <path d="M5.6 3.5v4h4" />
    </g>
    <text x="12.6" y="16" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none"
      fontFamily="'Microsoft YaHei', 'PingFang SC', sans-serif">{t('lineGlyph')}</text>
  </Svg>
);
export const PrevLineIcon = () => <Sentence back />;
export const NextLineIcon = () => <Sentence />;

// 画质：圆角框里写 HD（进度条上的画质菜单）
export const QualityIcon = () => (
  <Svg>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <text x="12" y="15.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none"
      fontFamily="Arial, sans-serif">HD</text>
  </Svg>
);

// 单句循环：循环箭头 + 1
export const LoopIcon = () => (
  <Svg>
    <path d="M17 2.5l3 3-3 3" /><path d="M4 11V9.5a4 4 0 0 1 4-4h12" />
    <path d="M7 21.5l-3-3 3-3" /><path d="M20 13v1.5a4 4 0 0 1-4 4H4" />
    <text x="12" y="14.6" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none"
      fontFamily="Arial, sans-serif">1</text>
  </Svg>
);

export const CcIcon = ({ on }) => (
  <Svg>
    <rect x="2.5" y="5" width="19" height="14" rx="3" fill={on ? 'currentColor' : 'none'} />
    <text x="12" y="15.2" textAnchor="middle" fontSize="8" fontWeight="700" stroke="none"
      fill={on ? '#000' : 'currentColor'} fontFamily="Arial, sans-serif">CC</text>
  </Svg>
);

export const VolumeIcon = ({ level }) => (
  <Svg>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    {level === 0 ? (
      <><path d="M16 9.5l5 5" /><path d="M21 9.5l-5 5" /></>
    ) : (
      <>
        <path d="M15.5 9a4 4 0 0 1 0 6" />
        {level > 0.5 && <path d="M18.5 6a8 8 0 0 1 0 12" />}
      </>
    )}
  </Svg>
);

export const FullscreenIcon = ({ exit, size = 24 }) => (
  <Svg size={size}>
    <path d={exit
      ? 'M9 3.5v5.5H3.5M15 3.5v5.5h5.5M9 20.5V15H3.5M15 20.5V15h5.5'
      : 'M3.5 9V3.5H9M20.5 9V3.5H15M3.5 15v5.5H9M20.5 15v5.5H15'} />
  </Svg>
);

// 字幕列表的搜索：放大镜；上一处 / 下一处是朝上 / 朝下的尖角；关闭是叉
export const SearchIcon = ({ size = 18 }) => <Svg size={size}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Svg>;
export const UpIcon = ({ size = 18 }) => <Svg size={size}><path d="M6 15l6-6 6 6" /></Svg>;
export const DownIcon = ({ size = 18 }) => <Svg size={size}><path d="M6 9l6 6 6-6" /></Svg>;
export const CloseIcon = ({ size = 18 }) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const LineLoopIcon = ({ size = 17 }) => (
  <Svg size={size} sw={1.8}>
    <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </Svg>
);

// 画中画：大框里右下角一个小实心框；退出画中画：小框在左上、箭头指回大框
export const PipIcon = ({ exit }) => (
  <Svg>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    {exit
      ? <><rect x="5.5" y="7.5" width="7" height="5" rx="1" fill="currentColor" stroke="none" /><path d="M18 16.5l-4-4M14 15.5v-3h3" /></>
      : <rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />}
  </Svg>
);

