# Blue Big Fat Fish (chat-demo)

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

> **This fork** renames the app to "Blue Big Fat Fish" and points the default API at a local magpie gateway (deployed on a NAS: magpie container + nginx same-origin proxy). The zero-dependency Node adapter still ships as `server.mjs` for local development. Previously it pointed at (`http://192.168.195.154:3425`) and ships a zero-dependency Node adapter (`server.mjs`) that serves `dist/`, proxies `/api/*`, adds CORS headers, emulates the Files API (images are inlined as base64), and falls back from the LAN address to loopback when the gateway rejects the key. See [README.zh-CN.md](README.zh-CN.md) for the full endpoint mapping table.

Quick start for this fork:

```sh
npm install
npm run build
npm run serve   # or double-click start.cmd
```

Open http://127.0.0.1:8090. Settings live in `config.json` (`port`, `targets`, `apiKey`, `model`).

You can [try the upstream app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Model selection

The model is no longer hard-coded. Settings → General → Model fetches `GET /v1/models` from the
gateway and lists every available id (`group/*` and `auto/*` first, the rest alphabetically).
The choice applies immediately and is stored in localStorage.

Precedence: the selected model → `window.__CHAT_MODEL__` in `config.js` (deployment default) →
built-in `deepseek-flash`. Pick "Default (follow deployment config)" to fall back to the last two.
If the gateway is unreachable only the default entry is shown, with a hint to check the connection.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm serve`  | Run the local gateway server |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) injects `__API_ORIGIN__` as `/api` (same-origin proxy) by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy; `pnpm dev` forwards `/api` to `API_PROXY` (default `http://127.0.0.1:3425`).

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
server.mjs             Local gateway adapter (static hosting + /api proxy + Files shim)
scripts/e2e-check.mjs  Headless Chrome end-to-end smoke test
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
