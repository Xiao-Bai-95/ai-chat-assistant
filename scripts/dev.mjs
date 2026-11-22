// 一键启动：同时运行后端代理和前端 Vite（零第三方依赖）
import { spawn } from 'node:child_process'

const isWindows = process.platform === 'win32'
const node = process.execPath

const children = []
let shuttingDown = false

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: isWindows, // Windows 下用 shell 才能正确解析 npx/vite
    env: process.env,
  })
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[${name}] 已退出（code ${code}），正在关闭其它服务...`)
      shutdown(code ?? 0)
    }
  })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) {
      // Windows 下需 taskkill 才能终止 shell 子进程
      if (isWindows && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('\n  🚀 启动后端服务（含 API 代理）...\n')
run('backend', node, ['server.mjs'])

console.log('\n  🚀 启动前端 Vite...\n')
const viteBin = isWindows ? 'npx.cmd' : 'npx'
run('frontend', viteBin, ['vite'])
