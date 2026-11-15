# 蓝色大肥鱼（chat-demo）

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

> **本 fork 的改动**：应用改名为「蓝色大肥鱼」，接口从 `https://api.deepseek.com` 换成本地 magpie 网关。
> 正式部署跑在 NAS 上（magpie 容器 + nginx 同源代理，不依赖任何 Windows 进程），
> 另外保留零依赖的 Node 适配服务器 `server.mjs` 供本机开发用。详见下方两节。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 本地网关版（本 fork）

默认对接本地网关 `http://192.168.195.154:3425`（magpie，OpenAI/Anthropic 兼容，`/v1/messages` 透传到 DeepSeek）。

### 为什么需要一个本地服务器

纯静态页面直接请求该网关有三个硬性障碍，因此仓库里多了 `server.mjs`（零依赖，只用 Node 内置模块）：

| 障碍 | 现象 | `server.mjs` 的处理 |
| --- | --- | --- |
| 跨域 | 网关不返回 `Access-Control-Allow-Origin`，`OPTIONS` 预检 404 | 同源托管 `dist/` + 代理 `/api/*`，并补上 CORS 头 |
| 网关信任策略 | 通过 LAN 地址（192.168.195.154 / 192.168.2.216）访问会 401：`key ... is not an enabled magpie gateway key`，回环地址正常 | 按 `targets` 顺序自动回退，401 时切到下一个并记住可用地址 |
| 缺失接口 | 网关没有 `/v1/files`（附件）、没有 ASR/TTS 模型 | Files API 在本地实现（图片内联为 base64）；语音接口返回可读的 501 |

### 使用

```sh
npm install          # 或 pnpm install
npm run build        # 产物在 dist/
npm run serve        # 或 node server.mjs，或双击 start.cmd
```

打开 http://127.0.0.1:8090 。首次启动会把 `config.example.json` 复制为 `config.json`（`start.cmd` 自动完成）。

### config.json

| 字段 | 说明 |
| --- | --- |
| `port` | 本地服务端口，默认 `8090` |
| `targets` | 上游地址数组，按顺序尝试；遇到网关密钥类 401 自动切换并记住 |
| `apiKey` | 首次打开自动写入浏览器设置（localStorage 已有 Key 时不覆盖），留空则手动在设置里填 |
| `model` | 强制覆盖请求模型；留空则用界面默认的 `deepseek-flash` |
| `filesDir` | 附件落盘目录，默认 `.gateway-files/` |

也可用环境变量覆盖：`PORT`、`API_TARGETS`（逗号分隔）。

> **模型说明**：`deepseek-flash` 依赖 magpie 里的 `api.deepseek.com` provider（原生支持联网搜索、自动标题等扩展）。该 provider 在 magpie 里被关闭时会报 `api.deepseek.com is switched off in Magpie`，此时可把 `model` 设为备用 id，例如 `readon/DeepSeek-V4.1-Flash`（已验证兼容全部扩展字段，但自动标题会退化为「新对话」）。重新开启 provider 后把 `model` 清空即可恢复。

### 接口映射

| 前端请求 | 转发到 | 说明 |
| --- | --- | --- |
| `POST /api/v1/messages` | `/v1/messages` | Anthropic 兼容流式透传；发送前把 `source.type=file` 的图片块内联成 base64 |
| `GET /api/v1/models` | `/v1/models` | 校验 API Key |
| `POST /api/v1/files` | 本地实现 | 仅图片（png/jpeg/gif/webp），落盘并返回 Anthropic 风格 `FileObject` |
| `DELETE /api/v1/files/:id` | 本地实现 | 删除附件原件 |
| `POST /api/v1/tools/asr`、`/tts` | — | 返回 501，界面提示语音不可用 |
| `GET /api/_config` | — | 返回 `apiKey` 等运行时配置，供前端首帧预填 |
| `GET /api/_status` | — | 查看当前上游地址、可达性、附件数量（排障用） |

### 功能可用性

| 功能 | 状态 |
| --- | --- |
| 流式对话、深度思考、联网搜索、链接阅读、来源引用、自动标题 | ✅ 网关透传 DeepSeek 上游，扩展字段原生支持 |
| 图片附件（png/jpeg/gif/webp） | ✅ 由代理内联为 base64 发送 |
| PDF / Word / PPT / 文本等文档附件 | ❌ 网关无法解析，上传时即提示 |
| 语音输入、回复朗读 | ❌ 网关无 ASR/TTS 模型 |
| 多会话、消息分支、历史导入导出、Markdown / KaTeX / Mermaid | ✅ 纯前端能力，与网关无关 |

### 运行时配置（换后端不用重新构建）

`dist/config.js` 会在应用启动前执行（改完刷新页面即生效，不需要重新构建）：

```js
window.__CHAT_API_ORIGIN__ = ''          // 留空：用构建期默认的 /api（同源代理）
// window.__CHAT_API_ORIGIN__ = 'http://192.168.2.216:8090/api'   // 跨域直连某台适配服务器
```

### 模型选择（设置 → 通用设置 → 模型）

模型不再写死在代码里。设置里的「模型」下拉会请求网关的 `GET /v1/models` 列出全部可用模型
（`group/*` 路由组与 `auto/*` 排在最前，其余按字母序），选中立即生效并存入 localStorage。

生效优先级：

1. 设置里选中的模型
2. `config.js` 的 `window.__CHAT_MODEL__`（部署默认）
3. 内置默认 `deepseek-flash`

选「默认（跟随部署配置）」即回到第 2、3 条。网关不可达时下拉只保留「默认」一项，
小字会提示检查网关连接，不影响其它设置项。

> 网关上的模型 id 通常是 `provider/model` 形式（如 `readon/DeepSeek-V4.1-Flash`），
> 与 DeepSeek 官方 id（`deepseek-flash`）不同，换网关后在这里选对即可，不必重新构建。

## 部署到 NAS 静态站（magpie 跑在 NAS 上）

目标架构：**页面、网关、模型供应商全部在 NAS 上，不依赖任何 Windows 进程。**

```
浏览器 ──同源──> nginx-static-host:8888 (/chat-demo/api/)
                        │  注入网关密钥、去掉 Origin、关闭缓冲
                        ▼
                 magpie 容器 :3425  (ghcr.io/yetone/magpie)
                        │
                        ▼
              readon / tokenjuice-ai / nvidia … 等 provider
```

### 1. 在 NAS 上跑 magpie

`/vol1/1000/docker/magpie/compose.yaml`（要点：网关发布到局域网、网页界面只绑回环、加入 nginx 的网络）：

```yaml
services:
  magpie:
    image: ghcr.io/yetone/magpie:latest
    container_name: magpie
    restart: unless-stopped
    ports:
      - "3425:3425"            # 网关：局域网客户端调用（需网关密钥）
      - "127.0.0.1:3430:3430"  # Web 管理界面：仅回环，用 SSH 隧道打开
    environment:
      MAGPIE_PUBLIC_URL: http://<nas-ip>:3425
      MAGPIE_WEB_KEY: <16 位以上的固定 key>
      MAGPIE_ALLOW_IPS: 192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
    volumes:
      - ./config:/config
    command: [web, --addr, 0.0.0.0:3430, --no-open]
    networks: [default, nginx_default]

networks:
  nginx_default:
    external: true
```

bind mount 的目录要交给容器用户（uid 65532），没有 sudo 时可以用一次性容器：

```sh
docker run --rm -u 0 --entrypoint /bin/sh \
  -v /vol1/1000/docker/magpie/config:/c \
  ghcr.io/yetone/magpie:latest -c "chown -R 65532:65532 /c"
docker compose up -d
```

Web 管理界面（加供应商、看用量）：`ssh -L 3430:127.0.0.1:3430 you@nas`，再打开 `http://127.0.0.1:3430/?k=<MAGPIE_WEB_KEY>`。

网关密钥给客户端用：`docker exec magpie magpie gateway-key add "Laptop"`（非 TTY 下会打码，
用 `... gateway-key rotate <id> --key -` 从 stdin 设定自己指定的密钥最省事）。

### 2. nginx 加一段同源代理

`/vol1/1000/Docker/nginx/conf/default.conf`：

```nginx
location /chat-demo/api/ {
    proxy_pass http://magpie:3425/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Authorization "Bearer <网关密钥>";
    proxy_set_header x-api-key "<网关密钥>";
    # magpie 把带 Origin 的请求当浏览器页面、要求登记白名单；
    # 密钥已由 nginx 注入且页面同源，去掉 Origin 按普通 API 客户端对待
    proxy_set_header Origin "";
    proxy_set_header Referer "";
    proxy_buffering off;      # SSE 必须
    proxy_cache off;
    proxy_request_buffering off;
    chunked_transfer_encoding on;
    gzip off;
    proxy_read_timeout 600s;
    client_max_body_size 32m;
}
```

### 3. 页面侧的 config.js

```js
window.__CHAT_API_ORIGIN__ = '/chat-demo/api'                 // 同源，浏览器无跨域
window.__CHAT_MODEL__ = 'readon/DeepSeek-V4.1-Flash'          // 网关上的 provider/model id
window.__CHAT_KEY__ = 'injected-by-nginx'                     // 占位，真实密钥在 nginx 里
```

### 这套架构下的功能边界

| 功能 | 状态 |
| --- | --- |
| 流式对话、深度思考、联网搜索、链接阅读、来源引用 | ✅ |
| 图片附件 | ❌ magpie 没有 Files API（`/v1/files` 返回 404），上传时会提示 |
| 语音输入 / 朗读 | ❌ 网关无 ASR/TTS 模型 |
| 多会话、消息分支、历史导入导出、Markdown / KaTeX / Mermaid | ✅ 纯前端 |

> 需要图片附件时，把 `__CHAT_API_ORIGIN__` 指回本机的 `server.mjs`（它自带 Files 兼容层），
> 代价是那台机器要开着。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm serve`  | 启动本地网关服务器  |
| `pnpm e2e`    | 无头浏览器端到端自检 |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认把 `__API_ORIGIN__` 注入为 `/api`（同源代理）。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理；`pnpm dev` 会把 `/api` 直接转发到 `API_PROXY`（默认 `http://127.0.0.1:3425`）。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
public/config.js       运行时配置模板（构建时复制为 dist/config.js）
server.mjs             本地网关适配服务器（静态托管 + /api 代理 + Files 兼容层）
scripts/e2e-check.mjs  CDP 无头浏览器自检脚本
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
