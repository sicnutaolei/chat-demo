/**
 * 端到端自检脚本：用 Chrome DevTools Protocol 打开本地页面，输入一句话并发送，
 * 等待流式回答结束后打印正文与截图。仅用于验证，不参与构建。
 *
 * 用法：node scripts/e2e-check.mjs [问题]
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
const PAGE_URL = process.env.PAGE_URL ?? 'http://127.0.0.1:8090/'
const QUESTION = process.argv[2] ?? '用两句话介绍你自己'
const OUT_DIR = path.resolve('.e2e')
const profile = path.join(process.env.TEMP ?? '.', 'cd-cdp-profile')

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

const cleanup = () => chrome.kill()
process.on('exit', cleanup)

let target
for (let i = 0; i < 60; i++) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const list = await response.json()
    target = list.find((item) => item.type === 'page')
    if (target) {
      break
    }
  } catch {
    // 等 Chrome 起来
  }
  await sleep(300)
}
if (!target) {
  throw new Error('Chrome 调试端口没起来')
}

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

await call('Page.enable')
await call('Runtime.enable')
await call('Page.navigate', { url: PAGE_URL })
await sleep(3500)

// 首次打开可能弹设置弹窗，Esc 关掉
let hasInput = await evaluate('!!document.querySelector("textarea")')
if (!hasInput) {
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await sleep(800)
  hasInput = await evaluate('!!document.querySelector("textarea")')
}
console.log('输入框可用:', hasInput)
if (!hasInput) {
  console.log('页面文本:', await evaluate('document.body.innerText.slice(0, 400)'))
  process.exit(1)
}

await evaluate('document.querySelector("textarea").focus()')
await call('Input.insertText', { text: QUESTION })
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

// 等流式回答结束：至少轮询 9s，且连续 3 次正文完全一致才认为稳定。
// 只看「1 次没变化」会在慢上游（首字延迟数秒）时提前退出，导致假阴性。
let previous = ''
let stable = 0
for (let i = 0; i < 80; i++) {
  await sleep(1500)
  const text = await evaluate('document.body.innerText')
  stable = text === previous ? stable + 1 : 0
  previous = text
  if (i >= 13 && stable >= 3) {
    break
  }
}

const bodyText = await evaluate('document.body.innerText')
await mkdir(OUT_DIR, { recursive: true })
await writeFile(path.join(OUT_DIR, 'page.txt'), bodyText, 'utf8')

const shot = await call('Page.captureScreenshot', { format: 'png' })
await writeFile(path.join(OUT_DIR, 'chat.png'), Buffer.from(shot.result.data, 'base64'))

console.log('--- 页面正文（截断）---')
console.log(bodyText.slice(0, 1200))
console.log('截图:', path.join(OUT_DIR, 'chat.png'))
socket.close()
chrome.kill()
process.exit(0)
