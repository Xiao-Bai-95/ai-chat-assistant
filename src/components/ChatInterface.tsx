import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { checkBackendStatus, type BackendStatus, streamChat } from '../api'
import { clearMessages, loadMessages, saveMessages } from '../storage'
import { createMessage, type Message } from '../types'

/** 绑定到某条 AI 消息上的错误；retryHistory 存在时可显示"重试"按钮 */
interface InlineError {
  messageId: string
  text: string
  retryHistory: Message[]
}

const markdownComponents: Components = {
  code({ node: _node, className, children }) {
    const match = /language-([\w-]+)/.exec(className ?? '')
    const text = String(children).replace(/\n$/, '')

    if (match) {
      return (
        <SyntaxHighlighter style={oneLight} language={match[1]} PreTag="div">
          {text}
        </SyntaxHighlighter>
      )
    }

    return <code className={className}>{children}</code>
  },
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages())
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messageError, setMessageError] = useState<InlineError | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [backend, setBackend] = useState<BackendStatus | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // 不把内容为空的 AI 占位写进本地，避免刷新后出现空气泡
    const clean = messages.filter((m) => m.content.trim().length > 0)
    if (clean.length > 0) saveMessages(clean)
    else clearMessages()
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isLoading])

  useEffect(() => {
    checkBackendStatus()
      .then(setBackend)
      .catch(() => setBackend(null))
  }, [])

  /** 发起一次流式请求，把内容填入指定 id 的 AI 消息；失败时把错误绑定到这条消息 */
  async function runChat(assistantId: string, history: Message[]) {
    setMessageError(null)
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(
        history,
        (chunk) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + chunk }
                : message,
            ),
          )
        },
        controller.signal,
      )
      // 成功后移除可能残留的空占位
      setMessages((prev) =>
        prev.filter((message) => message.id !== assistantId || message.content.length > 0),
      )
    } catch (caught) {
      const err = caught as Error
      if (err.name === 'AbortError') {
        // 主动停止：移除空占位，不算错误
        setMessages((prev) =>
          prev.filter((message) => message.id !== assistantId || message.content.length > 0),
        )
      } else {
        // 失败：保留部分内容，并把错误绑定到这条消息，供气泡内显示 + 重试
        setMessageError({
          messageId: assistantId,
          text: err.message || '请求失败，请稍后重试',
          retryHistory: history,
        })
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
      textareaRef.current?.focus()
    }
  }

  function sendMessage() {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')

    const userMessage = createMessage('user', text)
    const assistantMessage = createMessage('assistant', '')
    const history = [...messages, userMessage]

    setMessages([...history, assistantMessage])
    void runChat(assistantMessage.id, history)
  }

  /** 点击消息气泡里的"重试"：清空这条 AI 消息并用原历史重新请求 */
  function retryMessage(err: InlineError) {
    if (isLoading) return
    setMessages((prev) =>
      prev.map((message) =>
        message.id === err.messageId ? { ...message, content: '' } : message,
      ),
    )
    void runChat(err.messageId, err.retryHistory)
  }

  function stopGeneration() {
    // 中断 fetch 请求；随后立即把 UI 恢复成未加载的样子
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
    setMessageError(null)
    textareaRef.current?.focus()
  }

  function handleClear() {
    abortRef.current?.abort()
    clearMessages()
    setMessages([])
    setMessageError(null)
    setToast(null)
    setInput('')
    textareaRef.current?.focus()
  }

  async function handleCopy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedId(message.id)
      window.setTimeout(() => {
        setCopiedId((id) => (id === message.id ? null : id))
      }, 1500)
    } catch {
      setToast('复制失败，请手动选择文本复制')
      window.setTimeout(() => setToast(null), 3000)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">AI 聊天助手</h1>
          <p className="text-xs text-slate-500">Powered by DeepSeek · 对话保存在本地</p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={messages.length === 0 && !isLoading}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          清空对话
        </button>
      </header>

      {backend === null && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          无法连接后端服务：请先运行 <code>npm run dev</code> 启动服务（需要 Node 18+）。
        </div>
      )}
      {backend && !backend.configured && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          服务端尚未配置 API Key：请在项目根目录的 <code>.env.local</code> 中填写{' '}
          <code>DEEPSEEK_API_KEY</code> 后重启服务。
        </div>
      )}

      {toast && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          {toast}
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400">
            <div className="text-4xl">💬</div>
            <p className="text-sm">输入问题，开始和 AI 聊天吧</p>
            <p className="text-xs">支持多轮对话、Markdown、代码高亮和流式输出</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message) => {
              const isUser = message.role === 'user'
              return (
                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex max-w-[85%] gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                    <div
                      className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                        isUser ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {isUser ? '我' : 'AI'}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
                          isUser
                            ? 'bg-blue-600 text-white'
                            : 'border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        ) : (
                          <div className="md-content">
                            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
                            {messageError?.messageId === message.id && (
                              <div className="mt-2 flex items-center gap-2 border-t border-red-100 pt-2 text-xs text-slate-500">
                                <svg
                                  viewBox="0 0 24 24"
                                  className="h-4 w-4 shrink-0 text-amber-500"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <circle cx="12" cy="12" r="9" />
                                  <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
                                </svg>
                                <span className="min-w-0 flex-1">{messageError.text}</span>
                                <button
                                  type="button"
                                  onClick={() => retryMessage(messageError)}
                                  className="shrink-0 rounded-md px-2 py-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-blue-600"
                                  title="重新发送这条消息"
                                >
                                  重试
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div
                        className={`mt-1 flex items-center gap-2 text-[11px] text-slate-400 ${
                          isUser ? 'justify-end' : ''
                        }`}
                      >
                        <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                        {!isUser && message.content && (
                          <button
                            type="button"
                            onClick={() => void handleCopy(message)}
                            className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                          >
                            {copiedId === message.id ? '已复制' : '复制'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex max-w-[85%] gap-2">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-700">
                    AI
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                    思考中
                    <span className="animate-pulse">...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={isLoading ? 'AI 正在回复...' : '输入你的问题...'}
              className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || isLoading}
                className="min-w-[80px] rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>
              {isLoading && (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="min-w-[80px] rounded-xl bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  停止生成
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-slate-400">
            Enter 发送，Shift + Enter 换行 · 流式输出逐字显示
          </p>
        </div>
      </footer>
    </div>
  )
}
