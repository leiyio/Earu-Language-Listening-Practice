import { useRef } from 'react';

// 手机、平板（主要的指针是手指）上不写 accept：iPhone 不认识 .mkv 这种类型，写了「只收 MKV / MP4」它就把 MKV 灰掉不让选
// 选错了文件 openFile 里 checkVideoFile 照样挡。按指针判断而不按 UA：iPad 的 Safari 自称是 Mac，
// 主要指针却是手指；带鼠标、触控板的触屏笔记本主要指针是鼠标，照电脑算。电脑上照旧只列 MKV / MP4
const ACCEPT = '.mkv,.mp4,video/x-matroska,video/mp4';
const touchFirst = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
// iPhone、iPad：一点就进「文件」（避免先弹「照片图库 / 拍照或录像 / 选取文件」三选一）。
// 不写 accept 时苹果三样都给；写一个不是图片、不是视频的类型，它就直接开「文件」，
// 而且不按这个类型过滤（苹果只认图片、视频类的过滤），MKV、MP4 都不灰。安卓不这样写：安卓按类型过滤，写了反而选不了视频
const IOS_ACCEPT = 'application/octet-stream';
export const pickAccept = ({ ios = false, touch = false } = {}) => (ios ? IOS_ACCEPT : touch ? undefined : ACCEPT);
// 这台设备的选文件框写什么 accept（手机上「最近播放」的卡弹的框也用它，components/RecentList.jsx）：和「选择视频文件」是同一种框
const isIos = () => {
  const nav = globalThis.navigator;
  const ua = nav?.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1);
};
export const acceptFor = () => pickAccept({ ios: isIos(), touch: touchFirst() });

// 「选择视频文件」「换视频」：点了直接弹选文件框。
// 一律用普通选文件框，不用 showOpenFilePicker：有的 Chrome 上用户选好文件后它报「用户取消」（AbortError），
// 程序分不出是真取消还是被拒，结果什么反应都没有。代价：点选的文件不存句柄，「最近播放」再开要重新选一次；
// 拖进来的文件照样存句柄，能直接再开
export default function PickButton({ onFile, label, className = 'btn', title }) {
  const inputRef = useRef(null);
  const pick = () => { inputRef.current.click(); };
  return (
    <>
      {/* 鼠标点的马上让出焦点（同顶栏页签）：选完文件焦点回到这颗按钮，再按空格暂停，Chrome 会给它画上焦点框 */}
      <button type="button" className={className} onClick={(e) => { if (e.detail > 0) e.currentTarget.blur(); pick(); }} title={title}>{label}</button>
      <input
        ref={inputRef} type="file" accept={acceptFor()} hidden
        onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }}
      />
    </>
  );
}
