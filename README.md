# AI 聊天助手

一个基于 React + DeepSeek 的流式 AI 聊天应用。前端负责界面，Node 后端代理负责保管 API Key，浏览器全程接触不到密钥。

## 技术栈

- 前端：React 19 + TypeScript + Vite 7 + Tailwind CSS 4
- 后端：零依赖 Node.js HTTP 服务（原生 fetch 转发 SSE 流）
- 数据：对话记录保存在浏览器 localStorage

## 本地运行

环境要求：Node.js 18+

1. 安装依赖

   ```bash
   npm install
   ```

2. 配置 API Key：把 `.env.local.example` 复制为 `.env.local`，填入你的 DeepSeek Key

   ```env
   DEEPSEEK_API_KEY=你的Key
   DEEPSEEK_BASE_URL=https://api.deepseek.com
   DEEPSEEK_MODEL=deepseek-flash
   ```

3. 一条命令同时启动前后端

   ```bash
   npm run dev
   ```

   打开 <http://127.0.0.1:5173/> 即可。前端在 5173，后端代理在 3001，Vite 会把 `/api` 请求转发到后端。

## 生产运行

```bash
npm run build
npm start
```

后端会在 3001 端口同时提供静态页面和 API。可通过 `PORT` 环境变量指定端口。

## 安全说明

- API Key 只写在 `.env.local`，已被 `.gitignore` 忽略，不会进入 Git 仓库
- 前端代码使用 `VITE_` 前缀才会被打包，本项目 Key 不带该前缀，不会出现在浏览器代码里
- 密钥仅在服务端读取，浏览器只请求自己的 `/api/chat` 接口

## 主要功能

- DeepSeek 流式输出（SSE）
- 停止生成
- Markdown 渲染、代码高亮、一键复制
- 对话本地持久化、清空
- 错误内联提示与重试
