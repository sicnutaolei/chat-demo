import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { bootstrapGatewayConfig } from './services/gateway.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()

const mount = () => createRoot(document.getElementById('root') as HTMLElement).render(<App />)

// 先拿到本地网关预置的 API Key 再挂载，避免首帧因缺少 Key 弹出设置弹窗
void bootstrapGatewayConfig().finally(mount)
