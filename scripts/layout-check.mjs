/**
 * 排版审计（不依赖识图）：打开设置 → 通用设置 → 展开模型下拉，
 * 用 DOM 几何数据判断有没有溢出、重叠、被裁切，并保存截图。
 *
 * 用法：PAGE_URL=http://... node scripts/layout-check.mjs [宽x高]
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9335
const PAGE_URL = process.env.PAGE_URL ?? 'http://127.0.0.1:8090/'
const SIZE = process.argv[2] ?? '1440x900'
const [width, height] = SIZE.split('x').map(Number)
const OUT_DIR = path.resolve('.e2e')
const profile = path.join(process.env.TEMP ?? '.', `cd-cdp-layout-${SIZE}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    `--window-size=${width},${height}`,
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
    // 等 Chrome
  }
  await sleep(300)
}
if (!target) throw new Error('Chrome 调试端口没起来')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r))
let id = 0
const pending = new Map()
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    socket.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.text))
  return r.result?.result?.value
}

await call('Page.enable')
await call('Runtime.enable')
await call('Page.navigate', { url: PAGE_URL })
await sleep(3200)

// 可选：预置一个模型 id，用来验证长文本在选择器里的省略表现
if (process.env.PRESET_MODEL) {
  await evaluate(
    `localStorage.setItem('chat-demo:model', ${JSON.stringify(process.env.PRESET_MODEL)})`
  )
  await call('Page.reload')
  await sleep(3000)
}

await evaluate(
  "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '设置')?.click()"
)
await sleep(900)
await evaluate(
  "[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === '通用设置')?.click()"
)
await sleep(700)
await evaluate('document.querySelector(\'button[aria-label="模型"]\')?.click()')
await sleep(800)

const audit = await evaluate(`(() => {
  const vw = innerWidth, vh = innerHeight
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const dialog = document.querySelector('[role=dialog]')
  const trigger = document.querySelector('button[aria-label="模型"]')
  const menu = document.querySelector('[role=listbox]')
  const options = [...document.querySelectorAll('[role=option]')]
  const cell = [...document.querySelectorAll('div')].find((el) => el.className.includes('cell') && el.innerText.startsWith('模型'))
  const label = cell?.querySelector('div')
  const cs = trigger ? getComputedStyle(trigger) : null
  const labelCs = label ? getComputedStyle(label) : null
  const last = options.at(-1)
  return {
    viewport: { vw, vh },
    dialog: dialog ? rect(dialog) : null,
    dialogInViewport: dialog ? (() => { const r = dialog.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh })() : null,
    cellText: cell ? cell.innerText.replace(/\\n/g, ' | ') : null,
    trigger: trigger ? rect(trigger) : null,
    triggerStyle: cs ? { textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, overflow: cs.overflow, fontSize: cs.fontSize } : null,
    triggerText: trigger ? trigger.innerText.trim() : null,
    triggerSpan: trigger
      ? (() => {
          const span = trigger.querySelector('span')
          if (!span) return null
          const cs2 = getComputedStyle(span)
          return {
            scrollWidth: span.scrollWidth,
            clientWidth: span.clientWidth,
            textOverflow: cs2.textOverflow,
            ellipsized: span.scrollWidth > span.clientWidth + 1 && cs2.textOverflow === 'ellipsis',
          }
        })()
      : null,
    labelClipped: label && labelCs ? label.scrollHeight > label.clientHeight + 1 : null,
    menu: menu ? rect(menu) : null,
    menuInViewport: menu ? (() => { const r = menu.getBoundingClientRect(); return r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh })() : null,
    menuScrolls: menu ? menu.scrollHeight > menu.clientHeight + 1 : null,
    optionCount: options.length,
    lastOption: last ? { text: last.innerText.trim(), rect: rect(last) } : null,
    wideElements: [...document.querySelectorAll('body *')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > vw + 1 && r.height > 0 })
      .slice(0, 5)
      .map((el) => el.tagName + '.' + String(el.className).slice(0, 40)),
  }
})()`)

console.log(JSON.stringify(audit, null, 2))

await mkdir(OUT_DIR, { recursive: true })
const shot = await call('Page.captureScreenshot', { format: 'png' })
const file = path.join(OUT_DIR, `layout-${SIZE}.png`)
await writeFile(file, Buffer.from(shot.result.data, 'base64'))
console.log('截图:', file)

socket.close()
chrome.kill()
process.exit(0)
