import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { checkBackendStatus, type BackendStatus, streamChat } from '../api'
import { clearMessages, loadMessages, saveMessages } from '../storage'
import { createMessage, type Message } from '../types'

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
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [backend, setBackend] = useState<BackendStatus | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (messages.length > 0) saveMessages(messages)
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isLoading])

  useEffect(() => {
    checkBackendStatus()
      .then(setBackend)
      .catch(() => setBackend(null))
  }, [])

  async function sendMessage() {
    const text = input.trim()
    if (!text || isLoading) return

    setError(null)
    setInput('')

    const userMessage = createMessage('user', text)
    const assistantMessage = createMessage('assistant', '')
    const history = [...messages, userMessage]

    setMessages([...history, assistantMessage])
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(
        history,
        (chunk) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + chunk }
                : message,
            ),
          )
        },
        controller.signal,
      )
    } catch (caught) {
      const err = caught as Error
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.filter((message) => message.id !== assistantMessage.id || message.content.length > 0),
        )
      } else {
        setError(err.message || '请求失败，请稍后重试')
        setMessages((prev) =>
          prev.filter((message) => message.id !== assistantMessage.id || message.content.length > 0),
        )
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
      textareaRef.current?.focus()
    }
  }

  function stopGeneration() {
    abortRef.current?.abort()
  }

  function handleClear() {
    abortRef.current?.abort()
    clearMessages()
    setMessages([])
    setError(null)
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
      setError('复制失败，请手动选择文本复制')
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

      {error && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700">
          {error}
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
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>
              {isLoading && (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="rounded-xl border border-slate-300 px-5 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                >
                  停止
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
