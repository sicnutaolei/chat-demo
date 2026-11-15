/**
 * 运行时配置 —— NAS 静态站版本
 * 部署时覆盖 dist/config.js（构建会生成一份空的默认 config.js）：
 *   scp deploy/nas-config.js krypton:/vol1/1000/static_web/chat-demo/config.js
 *
 * 接口走同源代理：nginx-static-host 的 /chat-demo/api/ 转发到同机 magpie 容器
 * （http://magpie:3425），网关密钥在 nginx 里注入，所以：
 *   - 页面不含任何真实密钥（下面只是占位）
 *   - 浏览器不需要跨域，也不依赖任何 Windows 上的进程
 */
window.__CHAT_API_ORIGIN__ = '/chat-demo/api'

/**
 * 部署默认模型（可在页面「设置 → 通用设置 → 模型」里改，改完以设置为准）。
 * 网关上的模型 id 是 provider/model 形式，例如 'readon/DeepSeek-V4.1-Flash'、
 * 'tokenjuice-ai/deepseek-ai/DeepSeek-V4.1-Flash-1017'、路由组 'group/group'。
 */
window.__CHAT_MODEL__ = 'readon/DeepSeek-V4.1-Flash'

/** 占位 Key：真实密钥由 nginx 的 proxy_set_header 注入 */
window.__CHAT_KEY__ = 'injected-by-nginx'
