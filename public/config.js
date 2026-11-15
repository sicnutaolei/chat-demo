/**
 * 运行时配置（部署后可直接改这个文件，无需重新构建）
 *
 * __CHAT_API_ORIGIN__：
 *   - 留空字符串：使用构建期默认值 `/api`（由 server.mjs 同源代理，推荐本机使用）
 *   - 填完整地址：静态页面跨域直连该地址，例如 "http://192.168.2.216:8090/api"
 *     目标必须返回 CORS 头（server.mjs 已带 Access-Control-Allow-Origin: *）
 */
window.__CHAT_API_ORIGIN__ = ''
