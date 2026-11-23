import type { Message } from './types'

/**
 * 前端只与本地后端代理通信，不再直接接触 API Key。
 * Key 安全保存在服务端的 .env.local 中，绝不会被打包进浏览器代码。
 */

export interface BackendStatus {
  configured: boolean
  model: string
}

/** 检查后端服务是否已正确配置（用于界面提示，不涉及任何 Key） */
export async function checkBackendStatus(): Promise<BackendStatus> {
  const response = await fetch('/api/health')
  if (!response.ok) throw new Error('无法连接后端服务')
  return (await response.json()) as BackendStatus
}

/**
 * 调用本地后端 /api/chat，解析 SSE 流式响应，每收到一段内容回调 onChunk。
 */
export async function streamChat(
  messages: Message[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
      }),
      signal,
    })
  } catch (caught) {
    const err = caught as Error
    // 主动点击"停止"导致的中断，原样抛给上层按正常流程处理，不算错误
    if (err.name === 'AbortError') throw err
    // 断网、服务未启动、DNS 失败等网络层错误，转成友好的中文提示
    throw new Error('网络连接失败，请检查网络或确认服务已启动（npm run dev）后重试')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const data = (await response.json()) as { error?: string }
      detail = data.error ?? ''
    } catch {
      // 忽略解析失败，使用状态码提示
    }
    throw new Error(detail || `请求失败（${response.status}）`)
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持流式读取，请使用最新版 Chrome / Edge')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      try {
        const parsed = JSON.parse(payload) as { content?: string }
        if (parsed.content) onChunk(parsed.content)
      } catch {
        // 忽略心跳或格式异常的片段
      }
    }
  }
}
