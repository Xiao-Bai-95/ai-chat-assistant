/// <reference types="vite/client" />

// 前端不再读取任何环境变量：API Key 只存在于服务端 .env.local，
// 由 server.mjs 读取，绝不会进入浏览器代码。
