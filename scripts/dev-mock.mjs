/**
 * 本地 mock 启动器：仅用于无 Token 的 UI/物理验收。
 * 不要用它替代真实 MCP 验收；真实流程请用 npm run dev + .env。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const child = spawn(process.execPath, [viteBin, '--host', '0.0.0.0'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_MCD_MOCK: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
