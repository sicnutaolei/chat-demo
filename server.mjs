#!/usr/bin/env node
/**
 * chat-demo 本地网关适配服务器（零依赖）
 *
 * 职责：
 *  1. 托管 dist/ 静态产物（同源访问，绕开浏览器的跨域限制）
 *  2. 把前端发往 /api/* 的请求转发到 OpenAI/Anthropic 兼容网关（默认 magpie :3425）
 *  3. 兼容层：
 *     - /api/v1/files        网关没有 Files API，这里在本地实现（上传/删除/持久化）
 *     - /api/v1/messages     发送前把 file_id 引用内联成 base64 图片块（网关支持 base64）
 *     - /api/v1/tools/asr    网关无 ASR 模型，返回可读错误
 *     - /api/v1/tools/tts    网关无 TTS 模型，返回可读错误
 *     - 目标地址自动回退：网关只信任回环连接，LAN 地址 401 时自动改用 127.0.0.1 重试
 *
 * 配置见同目录 config.json，或环境变量 PORT / API_TARGETS。
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')

/** 默认配置：可用 config.json 覆盖 */
const DEFAULTS = {
  port: 8090,
  targets: ['http://192.168.195.154:3425', 'http://127.0.0.1:3425'],
  apiKey: '',
  filesDir: path.join(ROOT, '.gateway-files'),
  model: '',
}

const loadConfig = async () => {
  let file = {}
  try {
    file = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'))
  } catch {
    // 没有 config.json 时使用默认值
  }
  const envTargets = process.env.API_TARGETS?.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    ...DEFAULTS,
    ...file,
    targets: envTargets?.length ? envTargets : file.targets?.length ? file.targets : DEFAULTS.targets,
    port: Number(process.env.PORT ?? file.port ?? DEFAULTS.port),
  }
}

const config = await loadConfig()
const FILES_DIR = path.resolve(ROOT, config.filesDir)

/** 当前选中的上游地址（401 时自动切换） */
let activeTarget = config.targets[0]
/** file_id -> { name, mime, size } */
const fileIndex = new Map()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.LICENSE': 'text/plain; charset=utf-8',
}

// eslint-disable-next-line no-console -- 服务端日志是唯一输出通道
const log = (...args) => console.log('[chat-demo]', ...args)

// ---------------------------------------------------------------- 文件仓库

const loadFileIndex = async () => {
  await mkdir(FILES_DIR, { recursive: true })
  try {
    const raw = JSON.parse(await readFile(path.join(FILES_DIR, 'index.json'), 'utf8'))
    for (const [id, meta] of Object.entries(raw)) {
      fileIndex.set(id, meta)
    }
  } catch {
    // 首次运行没有索引
  }
}

const saveFileIndex = () =>
  writeFile(path.join(FILES_DIR, 'index.json'), JSON.stringify(Object.fromEntries(fileIndex)))

/** 解析 multipart/form-data，返回 [{ name, filename, contentType, data }] */
const parseMultipart = (buffer, boundary) => {
  const delimiter = Buffer.from(`--${boundary}`)
  const parts = []
  let cursor = buffer.indexOf(delimiter)
  while (cursor !== -1) {
    const afterDelimiter = cursor + delimiter.length
    if (buffer.slice(afterDelimiter, afterDelimiter + 2).toString() === '--') {
      break
    }
    const headerStart = afterDelimiter + 2
    const headerEnd = buffer.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) {
      break
    }
    const headers = buffer.slice(headerStart, headerEnd).toString('utf8')
    const dataStart = headerEnd + 4
    const nextDelimiter = buffer.indexOf(delimiter, dataStart)
    if (nextDelimiter === -1) {
      break
    }
    let dataEnd = nextDelimiter
    if (buffer[dataEnd - 2] === 0x0d && buffer[dataEnd - 1] === 0x0a) {
      dataEnd -= 2
    }
    parts.push({
      name: /name="([^"]*)"/.exec(headers)?.[1] ?? '',
      filename: /filename="([^"]*)"/.exec(headers)?.[1],
      contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim(),
      data: buffer.slice(dataStart, dataEnd),
    })
    cursor = nextDelimiter
  }
  return parts
}

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------- HTTP 工具

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-api-key,anthropic-beta,anthropic-version',
  'access-control-max-age': '86400',
}

const sendJson = (res, status, body, extra = {}) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...CORS_HEADERS,
    ...extra,
  })
  res.end(payload)
}

/** Anthropic 风格的错误体，前端 readErrorResponse 能直接取 error.message */
const sendError = (res, status, message, type = 'invalid_request_error') =>
  sendJson(res, status, { type: 'error', error: { type, message } })

// ---------------------------------------------------------------- 上游转发

const isGatewayKeyError = (text) =>
  typeof text === 'string' && text.includes('not an enabled magpie gateway key')

/** 逐个尝试上游地址；401 且是网关密钥错误时切换下一个并记住可用地址 */
const fetchUpstream = async (pathname, { method = 'GET', headers = {}, body } = {}) => {
  const order = [activeTarget, ...config.targets.filter((t) => t !== activeTarget)]
  let lastError
  for (const target of order) {
    const url = `${target.replace(/\/$/, '')}${pathname}`
    try {
      const response = await fetch(url, { method, headers, body, duplex: body ? 'half' : undefined })
      if (response.status === 401) {
        const text = await response.text()
        if (isGatewayKeyError(text)) {
          lastError = text
          continue
        }
        return { response: new Response(text, { status: 401, headers: response.headers }), target }
      }
      if (target !== activeTarget) {
        activeTarget = target
        log(`上游切换到 ${target}`)
      }
      return { response, target }
    } catch (error) {
      lastError = String(error?.message ?? error)
    }
  }
  throw new Error(`所有上游地址都不可用：${lastError ?? '未知错误'}`)
}

/** 转发请求头：只保留鉴权与内容协商相关字段 */
const upstreamHeaders = (req, { json = true } = {}) => {
  const headers = {}
  const auth = req.headers.authorization
  if (auth) {
    headers.authorization = auth
  } else if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`
  }
  if (req.headers['x-api-key']) {
    headers['x-api-key'] = req.headers['x-api-key']
  }
  headers['content-type'] = req.headers['content-type'] ?? (json ? 'application/json' : 'application/octet-stream')
  headers.accept = req.headers.accept ?? (json ? 'application/json' : '*/*')
  return headers
}

const pipeResponse = (res, response) => {
  const headers = {}
  for (const [key, value] of response.headers) {
    // fetch 已自动解压，长度与编码不再可信
    if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
      continue
    }
    headers[key] = value
  }
  Object.assign(headers, CORS_HEADERS)
  res.writeHead(response.status, headers)
  if (!response.body) {
    res.end()
    return
  }
  Readable.fromWeb(response.body).pipe(res)
}

// ---------------------------------------------------------------- 消息兼容层

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * 网关没有 Files API：把 source.type === 'file' 的图片块换成 base64。
 * 文档类附件网关无法解析，直接给出可读错误。
 */
const inlineFileBlocks = async (body) => {
  if (!body?.messages) {
    return body
  }
  const unsupported = []
  for (const message of body.messages) {
    if (!Array.isArray(message.content)) {
      continue
    }
    const blocks = []
    for (const block of message.content) {
      if (
        (block?.type === 'image' || block?.type === 'document') &&
        block.source?.type === 'file' &&
        typeof block.source.file_id === 'string'
      ) {
        const id = block.source.file_id
        const meta = fileIndex.get(id)
        if (!meta) {
          throw Object.assign(new Error(`附件已失效（${id}），请重新上传`), { status: 400 })
        }
        if (block.type === 'document' || !IMAGE_TYPES.has(meta.mime)) {
          unsupported.push(meta.name)
          continue
        }
        const bytes = await readFile(path.join(FILES_DIR, id))
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: meta.mime, data: bytes.toString('base64') },
        })
        continue
      }
      blocks.push(block)
    }
    message.content = blocks
  }
  if (unsupported.length > 0) {
    throw Object.assign(
      new Error(
        `当前网关只支持图片附件，以下文件无法解析：${unsupported.join('、')}（可改用纯文本粘贴内容）`
      ),
      { status: 400 }
    )
  }
  return body
}

// ---------------------------------------------------------------- 路由

const handleFiles = async (req, res) => {
  const contentType = req.headers['content-type'] ?? ''
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!boundary) {
    sendError(res, 400, '缺少 multipart boundary')
    return
  }
  const parts = parseMultipart(await readBody(req), (boundary[1] ?? boundary[2]).trim())
  const file = parts.find((part) => part.filename)
  if (!file) {
    sendError(res, 400, '请求里没有文件字段')
    return
  }
  const purpose = parts.find((part) => part.name === 'purpose')?.data.toString('utf8')
  const mime = file.contentType || 'application/octet-stream'
  if (!IMAGE_TYPES.has(mime) || purpose === 'rich_layout_recognition') {
    sendError(
      res,
      400,
      `当前网关只支持图片附件（png/jpeg/gif/webp），${file.filename} 无法解析`
    )
    return
  }
  const id = `file_${randomBytes(12).toString('hex')}`
  await writeFile(path.join(FILES_DIR, id), file.data)
  const meta = { name: file.filename, mime, size: file.data.length }
  fileIndex.set(id, meta)
  await saveFileIndex()
  log(`附件已保存 ${file.filename} (${mime}, ${file.data.length}B) -> ${id}`)
  sendJson(res, 200, {
    id,
    type: 'file',
    size_bytes: meta.size,
    created_at: new Date().toISOString(),
    filename: meta.name,
    mime_type: meta.mime,
  })
}

const handleDeleteFile = async (res, id) => {
  fileIndex.delete(id)
  await saveFileIndex()
  await unlink(path.join(FILES_DIR, id)).catch(() => {})
  res.writeHead(204, CORS_HEADERS)
  res.end()
}

const handleMessages = async (req, res) => {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    sendError(res, 400, '请求体不是合法 JSON')
    return
  }
  try {
    body = await inlineFileBlocks(body)
  } catch (error) {
    sendError(res, error.status ?? 400, error.message)
    return
  }
  if (config.model) {
    body.model = config.model
  }
  const headers = upstreamHeaders(req)
  // 文件已内联，不再需要 Files API beta 头
  delete headers['anthropic-beta']
  const { response } = await fetchUpstream('/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok && !(response.headers.get('content-type') ?? '').includes('event-stream')) {
    const text = await response.text()
    sendJson(res, response.status, safeJson(text) ?? { error: { message: text } })
    return
  }
  pipeResponse(res, response)
}

const safeJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const handleApi = async (req, res, url) => {
  const route = url.pathname.replace(/^\/api/, '') || '/'

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  if (route === '/_config') {
    sendJson(res, 200, {
      apiKey: config.apiKey,
      targets: config.targets,
      activeTarget,
      model: config.model,
    })
    return
  }

  if (route === '/_status') {
    let reachable = false
    try {
      const { response } = await fetchUpstream('/v1/models', {
        headers: upstreamHeaders(req),
      })
      reachable = response.ok
    } catch {
      reachable = false
    }
    sendJson(res, 200, {
      activeTarget,
      targets: config.targets,
      reachable,
      files: fileIndex.size,
    })
    return
  }

  if (route === '/v1/files' && req.method === 'POST') {
    await handleFiles(req, res)
    return
  }
  const fileMatch = /^\/v1\/files\/(.+)$/.exec(route)
  if (fileMatch && req.method === 'DELETE') {
    await handleDeleteFile(res, decodeURIComponent(fileMatch[1]))
    return
  }

  if (route === '/v1/tools/asr') {
    sendError(
      res,
      501,
      '当前网关没有语音识别模型，语音输入不可用；请直接输入文字。',
      'not_implemented_error'
    )
    return
  }
  if (route === '/v1/tools/tts') {
    sendError(
      res,
      501,
      '当前网关没有语音合成模型，朗读功能不可用。',
      'not_implemented_error'
    )
    return
  }

  if (route === '/v1/messages' && req.method === 'POST') {
    await handleMessages(req, res)
    return
  }

  // 其余接口直接透传（/v1/models 等）
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req)
  const { response } = await fetchUpstream(route + url.search, {
    method: req.method,
    headers: upstreamHeaders(req),
    body,
  })
  pipeResponse(res, response)
}

const serveStatic = async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') {
    pathname = '/index.html'
  }
  let filePath = path.join(DIST, pathname)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  let info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) {
    // 单页应用回退
    filePath = path.join(DIST, 'index.html')
    info = await stat(filePath).catch(() => null)
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dist/ 不存在，请先运行 npm run build')
      return
    }
  }
  const ext = path.extname(filePath).toLowerCase()
  const immutable = pathname.startsWith('/static/')
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(filePath).pipe(res)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const task = url.pathname.startsWith('/api/')
    ? handleApi(req, res, url)
    : serveStatic(req, res, url)
  task.catch((error) => {
    log('请求失败', req.method, url.pathname, error?.message ?? error)
    if (!res.headersSent) {
      sendError(res, 500, String(error?.message ?? error), 'api_error')
    } else {
      res.end()
    }
  })
})

await loadFileIndex()
server.listen(config.port, () => {
  log(`已启动: http://127.0.0.1:${config.port}`)
  log(`上游地址: ${config.targets.join(' -> ')}`)
  log(`已保存附件: ${fileIndex.size} 个`)
})
