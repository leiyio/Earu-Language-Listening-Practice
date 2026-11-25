# Earu Mini

[简体中文](README.zh-CN.md)

A small, local-only video player for practicing listening in a second language.
Open a video file from your own computer, and practice with the subtitles that are already inside it.

- **Local files only.** Opens MP4 and MKV files straight from your disk. Nothing is uploaded.
- **Uses the subtitles inside the video.** Reads embedded text subtitle tracks (SRT/UTF-8, WebVTT, MP4 timed text).
- **Cover the subtitles.** Subtitles in the language you are learning start covered. Reveal them only when you need to.
- **Two practice modes:**
  - **Sort** — the words of a line are shuffled; put them back in order.
  - **Dictation** — type what you hear.
- **No account, no server.** No sign-in, no analytics, no network requests by default.
- 14 interface languages, 12 learning languages.

Earu Mini is the open part of [Earu](https://earu.ai). The full app adds a video library, word cards, shadowing and more.

## Run it

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```bash
cd web
npm install
npm run dev        # development server
npm run build      # production build into web/dist
npm run preview    # serve web/dist at http://localhost:5184
```

`web/dist` is a static site. You can host it on any static file server.

Tested in Chrome. Other modern browsers may work but are not tested.

## Optional: AI translation

By default there is no translation of the subtitles into your own language. If you have an AI service with a chat-completions-style API, you can turn it on by filling in `web/public/config.json` (or `config.json` next to `index.html` in a build):

```json
{ "ai": { "baseUrl": "https://your-endpoint/v1", "apiKey": "your-key", "model": "your-model" } }
```

- All three fields must be filled in; otherwise translation stays off.
- The app sends `POST {baseUrl}/chat/completions` with your key as a Bearer token, and only to that address.
- Translations are cached in the browser, so the same lines are not sent twice.

> **Warning:** `config.json` is a public file. Anyone who can open the page can read your key. Only put a key in it when the app runs on your own computer or on a private network.

## End-to-end test

`web/scripts/e2e.mjs` drives a headless Chrome through the main flows.
It needs three test videos that are not included in this repository: `titled.mkv`, `titled.mp4` and `zh.mkv`, each with embedded text subtitles.

```bash
cd web
FIXTURES=/path/to/test-videos node scripts/e2e.mjs
```

- `FIXTURES`: folder holding the test videos. Default: `fixtures/` at the repository root.
- `CHROME`: path to Chrome.
- `E2E_TMP`: where logs and temporary browser profiles go. Default: the system temp folder.

## License

See [LICENSE](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
