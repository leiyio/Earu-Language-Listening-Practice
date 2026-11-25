// 桌面版首页用的线条图标（和网站其他地方一样的描边风格）
export const svg = (d, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
// 耳如标志（五根竖条，最右一根琥珀色；和启动画面的同一个图形）。侧栏左上角用它，新账号选语言那一页（Onboard.jsx）也用它。
// 渐变 id 另起名，不和启动画面撞；两处同时在页面上时 idp 传不同的前缀，id 才不重复
export const BrandLogo = ({ size = 26, idp = 'dk-logo' }) => (
  <svg className="dk-logo" viewBox="96 86 320 340" width={Math.round(size * 320 / 340)} height={size} aria-hidden>
    <defs>
      <linearGradient id={`${idp}-g`} x1="106" y1="416" x2="406" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#945df0" /><stop offset="1" stopColor="#e04ba9" /></linearGradient>
      <linearGradient id={`${idp}-gt`} x1="0" y1="221" x2="0" y2="291" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ffc24a" /><stop offset="1" stopColor="#f59a10" /></linearGradient>
    </defs>
    <rect x="106" y="96" width="44" height="320" rx="22" fill={`url(#${idp}-g)`} />
    <rect x="170" y="129" width="44" height="254" rx="22" fill={`url(#${idp}-g)`} />
    <rect x="234" y="162" width="44" height="188" rx="22" fill={`url(#${idp}-g)`} />
    <rect x="298" y="195" width="44" height="122" rx="22" fill={`url(#${idp}-g)`} />
    <rect x="362" y="221" width="44" height="70" rx="22" fill={`url(#${idp}-gt)`} />
  </svg>
);
// 本地视频：胶片
export const FilmIcon = ({ size = 16 }) => svg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5" /></>, size);
