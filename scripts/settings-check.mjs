/**
 * 设置弹窗「模型选择」的端到端自检：打开设置 → 读取模型项 → 展开下拉 → 选中一个模型 →
 * 确认写进 localStorage → 发一句话验证该模型真的可用。仅用于验证，不参与构建。
 *
 * 用法：PAGE_URL=http://... node scripts/settings-check.mjs [目标模型 id]
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9334
const PAGE_URL = process.env.PAGE_URL ?? 'http://127.0.0.1:8090/'
const TARGET_MODEL = process.argv[2] ?? 'readon/DeepSeek-V4.1-Flash'
const OUT_DIR = path.resolve('.e2e')
const profile = path.join(process.env.TEMP ?? '.', 'cd-cdp-settings')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
)
process.on('exit', () => chrome.kill())

let target
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((item) => item.type === 'page')
    if (target) break
  } catch {
    // 等 Chrome 起来
  }
  await sleep(300)
}
if (!target) throw new Error('Chrome 调试端口没起来')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve))

let messageId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return result.result?.result?.value
}
const pressEscape = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
  }
  await sleep(600)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Page.navigate', { url: PAGE_URL })
await sleep(3500)

// 每次从「未选模型」开始，避免上一次的 localStorage 影响判断
await evaluate("localStorage.removeItem('chat-demo:model')")
await call('Page.reload')
await sleep(3000)

console.log('页面标题:', await evaluate('document.title'))

// 打开设置
await evaluate(
  "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '设置')?.click()"
)
await sleep(1200)

// 没有 API Key 时弹窗默认停在「数据管理」，先切到「通用设置」
await evaluate(
  "[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === '通用设置')?.click()"
)
await sleep(900)

const dialogText = await evaluate(
  "(() => { const d = document.querySelector('[role=dialog]') ?? document.body; return d.innerText })()"
)
const modelCell = await evaluate(
  "(() => { const cells = [...document.querySelectorAll('div')]; const c = cells.find((el) => el.className.includes('cell') && el.innerText.startsWith('模型')); return c ? c.innerText : null })()"
)
console.log('--- 设置弹窗是否含模型项 ---')
console.log('模型单元格:', JSON.stringify(modelCell))

// 展开模型下拉
await evaluate('document.querySelector(\'button[aria-label="模型"]\')?.click()')
await sleep(900)
const options = await evaluate(
  "[...document.querySelectorAll('[role=option]')].map((el) => el.textContent.trim())"
)
console.log('下拉选项数:', Array.isArray(options) ? options.length : 0)
console.log('前 6 项:', JSON.stringify((options ?? []).slice(0, 6)))

const shotMenu = await call('Page.captureScreenshot', { format: 'png' })
await mkdir(OUT_DIR, { recursive: true })
await writeFile(
  path.join(OUT_DIR, 'settings-model.png'),
  Buffer.from(shotMenu.result.data, 'base64')
)

// 选中目标模型
const clicked = await evaluate(
  `(() => { const el = [...document.querySelectorAll('[role=option]')].find((o) => o.textContent.trim() === ${JSON.stringify(TARGET_MODEL)}); if (!el) return false; el.click(); return true })()`
)
await sleep(800)
console.log(`选中 ${TARGET_MODEL}:`, clicked)
console.log(
  'localStorage 里的模型:',
  JSON.stringify(await evaluate("localStorage.getItem('chat-demo:model')"))
)

// 关掉设置，发一句话验证该模型可用
await pressEscape()
await sleep(500)

await evaluate('document.querySelector("textarea")?.focus()')
await call('Input.insertText', { text: '用一句话说明你是哪个模型' })
await sleep(300)
await call('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Enter',
  code: 'Enter',
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13,
  text: '\r',
})
await call('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Enter',
  code: 'Enter',
  windowsVirtualKeyCode: 13,
})

let previous = ''
let stable = 0
for (let i = 0; i < 80; i++) {
  await sleep(1500)
  const text = await evaluate('document.body.innerText')
  stable = text === previous ? stable + 1 : 0
  previous = text
  if (i >= 13 && stable >= 3) break
}

const bodyText = await evaluate('document.body.innerText')
await writeFile(path.join(OUT_DIR, 'settings-page.txt'), bodyText, 'utf8')
const shot = await call('Page.captureScreenshot', { format: 'png' })
await writeFile(path.join(OUT_DIR, 'settings-chat.png'), Buffer.from(shot.result.data, 'base64'))

console.log('--- 回答片段 ---')
console.log(bodyText.slice(0, 900))
console.log(
  '截图:',
  path.join(OUT_DIR, 'settings-model.png'),
  path.join(OUT_DIR, 'settings-chat.png')
)
console.log('弹窗文本长度:', dialogText?.length ?? 0)

socket.close()
chrome.kill()
process.exit(0)
