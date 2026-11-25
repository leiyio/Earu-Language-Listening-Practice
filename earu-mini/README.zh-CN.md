# 耳如 Earu 本机练习版

[English](README.md)

一个只在本机运行的小播放器，用来练第二语言听力。
打开自己电脑上的视频，用视频里自带的字幕来练。

- **只用本机文件。** 直接打开硬盘上的 MP4、MKV，不上传任何东西。
- **用视频里的字幕。** 读取内嵌的文字字幕轨（SRT/UTF-8、WebVTT、MP4 文字字幕）。
- **遮盖字幕。** 在学语言的字幕默认遮盖，需要时再看。
- **两种练习：**
  - **排序**：把打乱的词按原句排回去。
  - **听写**：听到什么打什么。
- **不要账号、不连服务器。** 不登录、不统计，默认不发任何网络请求。
- 14 种界面语言，12 门学习语言。

这是 [耳如 Earu](https://earu.ai) 公开的一部分。完整版另有片库、词卡、跟读等功能。

## 运行

需要 [Node.js](https://nodejs.org/) 20.19 以上或 22.12 以上。

```bash
cd web
npm install
npm run dev        # 开发服务器
npm run build      # 打包到 web/dist
npm run preview    # 在 http://localhost:5184 打开 web/dist
```

`web/dist` 是纯静态网站，放到任何静态文件服务器上都能用。

在 Chrome 上测过。其他新版浏览器也许能用，但没测过。

## 可选：AI 翻译

默认不翻译成母语。如果你有一个兼容「聊天补全」格式的 AI 接口，可以在 `web/public/config.json`（打包后是 `index.html` 旁边的 `config.json`）里填上：

```json
{ "ai": { "baseUrl": "https://你的接口地址/v1", "apiKey": "你的密钥", "model": "模型名" } }
```

- 三项都填了才开，少一项就当没开。
- 程序发 `POST {baseUrl}/chat/completions`，密钥放在 Bearer 头里，只发给这个地址。
- 译文缓存在浏览器里，同一句不会重复发送。

> **注意：** `config.json` 是公开文件，能打开网页的人都能读到密钥。只在自己电脑上或内网里用时才填密钥。

## 端到端测试

`web/scripts/e2e.mjs` 用无头 Chrome 走一遍主要流程。
它要三部测试视频：`titled.mkv`、`titled.mp4`、`zh.mkv`，都要带内嵌文字字幕。仓库里不带这三部视频。

```bash
cd web
FIXTURES=/测试视频目录 node scripts/e2e.mjs
```

- `FIXTURES`：测试视频所在的目录，默认是仓库根目录下的 `fixtures/`。
- `CHROME`：Chrome 的路径。
- `E2E_TMP`：日志和临时浏览器配置放哪，默认是系统临时目录。

## 许可证

见 [LICENSE](LICENSE)。用到的第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
