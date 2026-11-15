/**
 * 运行时配置（部署后可直接改这个文件，无需重新构建）
 *
 * __CHAT_API_ORIGIN__：
 *   - 留空字符串：使用构建期默认值 `/api`（由 server.mjs 同源代理，推荐本机使用）
 *   - 填完整地址：静态页面跨域直连该地址，例如 "http://192.168.2.216:8090/api"
 *     目标必须返回 CORS 头（server.mjs 已带 Access-Control-Allow-Origin: *）
 */
window.__CHAT_API_ORIGIN__ = ''

/**
 * __CHAT_MODEL__：强制覆盖请求里的模型 id（留空则用界面默认的 deepseek-flash）。
 * 网关上的模型 id 是 provider/model 形式，例如 'readon/DeepSeek-V4.1-Flash'、
 * 'tokenjuice-ai/deepseek-ai/DeepSeek-V4.1-Flash-1017'、路由组 'group/group'。
 */
window.__CHAT_MODEL__ = ''

/**
 * __CHAT_KEY__：占位 Key。密钥由反向代理在服务端注入（如 nginx 的 proxy_set_header）
 * 时填任意非空字符串即可进入界面，真实密钥不会出现在页面里。
 */
window.__CHAT_KEY__ = ''
