// 后端代理服务：保管 API Key，转发 DeepSeek 请求，并托管前端构建产物。
// 零第三方依赖，仅使用 Node 内置模块（需要 Node 18+，内置 fetch）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname

const PORT = Number(process.env.PORT || 3001)
const DIST_DIR = path.join(ROOT, 'dist')

// —— 读取 .env.local（简单的 KEY=VALUE 解析，足矣）——
function loadEnvFile(filePath) {
  const env = {}
  if (!fs.existsSync(filePath)) return env
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

// 服务端环境变量优先从 .env.local 读取，也支持系统环境变量覆盖（方便部署平台注入）
const fileEnv = loadEnvFile(path.join(ROOT, '.env.local'))
const API_KEY = process.env.DEEPSEEK_API_KEY || fileEnv.DEEPSEEK_API_KEY || ''
const BASE_URL = (
  process.env.DEEPSEEK_BASE_URL ||
  fileEnv.DEEPSEEK_BASE_URL ||
  'https://api.deepseek.com'
).replace(/\/$/, '')
const MODEL = process.env.DEEPSEEK_MODEL || fileEnv.DEEPSEEK_MODEL || 'deepseek-flash'

function isConfigured() {
  return Boolean(API_KEY && API_KEY.trim() && API_KEY !== 'your_deepseek_api_key')
}

// —— MCP/工具：读取请求体 ——
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 2_000_000) reject(new Error('请求体过大'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function setSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

// —— 核心：流式转发 /api/chat ——
async function handleChat(req, res) {
  let payload
  try {
    payload = await readJsonBody(req)
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: err.message || '请求格式错误' }))
    return
  }

  if (!isConfigured()) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        error: '服务端尚未配置 API Key。请在项目根目录的 .env.local 中填写 DEEPSEEK_API_KEY 后重启服务。',
      }),
    )
    return
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : []

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, stream: true, messages }),
      signal: req.signal,
    })

    if (!upstream.ok) {
      let detail = ''
      try {
        const data = await upstream.json()
        detail = data?.error?.message || ''
      } catch {
        // 忽略解析失败
      }
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          error: detail
            ? `DeepSeek 请求失败（${upstream.status}）：${detail}`
            : `DeepSeek 请求失败（${upstream.status}）`,
        }),
      )
      return
    }

    setSseHeaders(res)

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const content = parsed?.choices?.[0]?.delta?.content
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`)
            }
          } catch {
            // 忽略心跳或异常片段
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    if (res.headersSent) {
      res.end()
      return
    }
    const aborted = err?.name === 'AbortError'
    res.writeHead(aborted ? 499 : 502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        error: aborted ? '请求已取消' : `无法连接 DeepSeek：${err?.message || '未知错误'}`,
      }),
    )
  }
}

// —— 静态文件托管（生产环境用）：让一个后端进程同时提供页面和 API ——
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function serveStatic(pathname, res) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('未找到构建产物，请先执行 npm run build')
    return
  }
  const decoded = decodeURIComponent(pathname)
  // 防目录穿越：解析后必须仍在 dist 目录内
  let filePath = path.normalize(path.join(DIST_DIR, decoded))
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end()
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html') // SPA fallback
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end()
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

// —— 路由 ——
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ configured: isConfigured(), model: MODEL }))
    return
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    await handleChat(req, res)
    return
  }

  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '接口不存在' }))
    return
  }

  // 非 API 请求交给静态文件托管
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(url.pathname, res)
    return
  }

  res.writeHead(405)
  res.end()
})

// 监听 0.0.0.0：本地 127.0.0.1 可访问，将来部署到云平台也能被外部访问
const HOST = process.env.HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
  console.log(`\n  ✅ 后端服务已启动: http://localhost:${PORT}`)
  console.log(`  🔑 API Key 状态: ${isConfigured() ? '已配置（仅服务端可见）' : '未配置'}`)
  console.log(`  🤖 模型: ${MODEL}\n`)
})
