import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn, type ChildProcess } from 'node:child_process'

// 在 Vite 开发服务器启动时自动拉起后端代理，保证 /api 聊天接口可用。
// 这样 `dev` 可以是标准的 vite 命令（本地预览面板能识别），同时保留前后端一键启动。
function backendProxy(): Plugin {
  let backend: ChildProcess | null = null

  return {
    name: 'backend-proxy',
    configureServer(server) {
      backend = spawn(process.execPath, ['server.mjs'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
      })
      backend.on('exit', () => {
        backend = null
      })

      const cleanup = () => {
        if (backend && !backend.killed) backend.kill()
      }
      server.httpServer?.once('close', cleanup)
      process.once('exit', cleanup)
    },
  }
}

export default defineConfig({
  // 使用独立的缓存目录：每次配置变更后换新名，避免 Vite 重新优化依赖时触发批量删除拦截
  cacheDir: 'node_modules/.vite-preview',
  plugins: [react(), tailwindcss(), backendProxy()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
