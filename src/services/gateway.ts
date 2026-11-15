import { API_ORIGIN } from './api/client.js'
import { setApiKey, useSettings } from './settings.js'

/**
 * 首次打开时从网关适配服务器读取预置的 API Key（server 端 config.json 的 apiKey 字段），
 * 已经手动填过就保持原值。必须在挂载 App 之前 await，否则首帧会因为「没有 Key」弹出设置弹窗。
 * 地址跟随 API_ORIGIN，因此部署到 NAS 静态站、跨域连回本机代理时同样可用；
 * 没有适配服务器（如直接双击 dist/index.html）时请求失败，静默忽略。
 */
/** 运行时占位 Key（config.js 的 window.__CHAT_KEY__）：密钥由反代在服务端注入时用它进入界面 */
const runtimeKey = (globalThis as { __CHAT_KEY__?: unknown }).__CHAT_KEY__

export const bootstrapGatewayConfig = async (): Promise<void> => {
  if (useSettings.getState().apiKey) {
    return
  }
  if (typeof runtimeKey === 'string' && runtimeKey.trim()) {
    setApiKey(runtimeKey.trim())
    return
  }
  try {
    const response = await fetch(`${API_ORIGIN}/_config`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) {
      return
    }
    const config: unknown = await response.json()
    const apiKey = (config as { apiKey?: unknown } | null)?.apiKey
    if (typeof apiKey === 'string' && apiKey && !useSettings.getState().apiKey) {
      setApiKey(apiKey)
    }
  } catch {
    // 没有适配服务器或超时：不阻塞启动，用户仍可在设置里手动填写
  }
}
