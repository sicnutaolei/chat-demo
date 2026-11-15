import { setApiKey, useSettings } from './settings.js'

/**
 * 首次打开时从本地网关服务器读取预置的 API Key（config.json 的 apiKey 字段），
 * 已经手动填过就保持原值。必须在挂载 App 之前 await，否则首帧会因为「没有 Key」弹出设置弹窗。
 * 直接用 file:// 打开 dist/index.html 时请求失败，静默忽略。
 */
export const bootstrapGatewayConfig = async (): Promise<void> => {
  if (useSettings.getState().apiKey) {
    return
  }
  try {
    const response = await fetch('/api/_config', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
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
    // 没有本地网关或超时：不阻塞启动，用户仍可在设置里手动填写
  }
}
