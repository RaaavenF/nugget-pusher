import { defineConfig, loadEnv } from 'vite';

/**
 * 麦当劳 MCP Token 只存在于 Node 进程（.env.local），不会进入浏览器 bundle。
 * 浏览器请求同源 /api/mcp，由下面的 Vite 代理转发到 mcp.mcd.cn 并注入 Bearer Token。
 * 生产环境必须把同样的代理逻辑部署到自己的 BFF / Serverless Function。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mcpTarget = env.MCD_MCP_ENDPOINT || 'https://mcp.mcd.cn';
  const mcpToken = env.MCD_MCP_TOKEN || '';

  return {
    // 相对路径便于把 dist 部署到任意子目录 / CDN
    base: './',
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 900,
    },
    server: {
      host: true,
      proxy: {
        '/api/mcp': {
          target: mcpTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/mcp/, '') || '/',
          headers: {
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            Origin: 'https://mcp.mcd.cn',
          },
        },
      },
    },
  };
});
