import type { Message } from './types'

const STORAGE_KEY = 'ai-chat-assistant:messages'

export function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Message =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as Message).role === 'string' &&
            typeof (item as Message).content === 'string',
        ),
      )
      .map((item) => ({
        id: item.id || `${item.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: item.content,
        timestamp: item.timestamp || Date.now(),
      }))
  } catch {
    return []
  }
}

export function saveMessages(messages: Message[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch (error) {
    console.warn('对话历史保存失败', error)
  }
}

export function clearMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('对话历史清除失败', error)
  }
}
