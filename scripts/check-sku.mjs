#!/usr/bin/env node
/**
 * check-sku.mjs — 真实 SKU 预检工具（只读，绝不调用 mall-create-order）
 *
 * 解决的问题：
 *   README 要求「配置真实 SKU 前，先用 mall-points-products / mall-product-detail
 *   核对商品上下架状态与 skuId」，但此前没有任何可执行代码承担这一步，
 *   只能靠人工翻文档，极易把已过期商品或错误 id 写进 .env.local。
 *
 * 本脚本基于真实 MCP 返回实测出的两条坑，把人工核对变成机器校验：
 *   1. 返回字段是商品级 spuId，不是 skuId —— 直接抄 skuId 填 .env 会永远匹配不上；
 *   2. status = 2（上架）不代表当前可兑换 —— 商城会长期返回 status=2 但
 *      downTime 已过期的历史商品，必须用 upTime <= now <= downTime 二次过滤。
 *
 * 用法：
 *   node scripts/check-sku.mjs                 # 读取 cwd 的 .env.local
 *   node scripts/check-sku.mjs --env .env.local
 *   node scripts/check-sku.mjs --all           # 列出全部商品，含已过期
 *
 * 退出码：
 *   0  已配置的 SKU 均可正常兑换（或未配置任何 SKU 且仅作浏览）
 *   1  已配置的 SKU 不存在 / 已过期 / 未上架
 *   2  环境或网络问题（缺 Token、鉴权失败、MCP 不可达）
 *
 * 安全：只读。Token 仅在本进程内使用，不落盘、不打印。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROTOCOL_VERSION = '2025-06-18';
const PRODUCTS_TOOL = 'mall-points-products';
const TIMEOUT_MS = 20_000;

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SHOW_ALL = flag('--all');
const ENV_PATH = resolve(process.cwd(), opt('--env', '.env.local'));
/** 离线重放：从已保存的 MCP 响应 JSON 预检，不需要 Token（便于 CI 与回归）。 */
const FROM_FILE = opt('--from-file', '');

/* ---------- .env 解析（不依赖 dotenv） ---------- */

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnv(ENV_PATH);
const env = { ...fileEnv, ...process.env };

const TOKEN = (env.MCD_MCP_TOKEN || '').trim();
const ENDPOINT = (env.MCD_MCP_ENDPOINT || 'https://mcp.mcd.cn').replace(/\/+$/, '');

/* ---------- MCP Streamable HTTP 客户端（最小实现） ---------- */

let sessionId = null;
let nextId = 1;

function headers() {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
  };
  if (sessionId) h['Mcp-Session-Id'] = sessionId;
  return h;
}

async function post(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const sid = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
  if (sid) sessionId = sid;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint =
      res.status === 401 || res.status === 403
        ? '鉴权失败：MCD_MCP_TOKEN 无效或已过期，请到 https://open.mcd.cn/mcp 重新获取'
        : res.status === 429
          ? '请求过于频繁，请稍后重试'
          : `HTTP ${res.status}`;
    throw new Error(`${hint}\n${body.slice(0, 300)}`);
  }
  return res;
}

/** 服务端可能返回 JSON，也可能返回 SSE；两种都要能读。 */
async function readRpc(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    const chunks = text
      .split(/\r?\n\r?\n/)
      .flatMap((block) =>
        block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
      )
      .filter((d) => d && d !== '[DONE]');
    for (const chunk of chunks) {
      try {
        const parsed = JSON.parse(chunk);
        if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
      } catch {
        /* 心跳/注释，跳过 */
      }
    }
    return null;
  }
  const text = await res.text();
  if (!text.trim()) return null;
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed.find((i) => i && (i.result !== undefined || i.error !== undefined)) || null;
  }
  return parsed;
}

async function callTool(name, args = {}) {
  // initialize
  const initRes = await post({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'nugget-pusher-check-sku', version: '1.0.0' },
    },
  });
  const init = await readRpc(initRes);
  if (init?.error) throw new Error(`initialize 失败：${init.error.message}`);
  // 握手完成通知（无 id，服务端不回包）
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // tools/call
  const res = await post({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const rpc = await readRpc(res);
  if (!rpc) throw new Error(`${name} 没有返回 JSON-RPC 响应`);
  if (rpc.error) throw new Error(`${name} 调用失败：${rpc.error.message}`);

  const result = rpc.result || {};
  if (result.isError) {
    const text = (result.content || [])
      .filter((c) => c?.type === 'text')
      .map((c) => c.text)
      .join('\n');
    throw new Error(`${name} 返回错误：${text}`);
  }
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ---------- 业务：商品可兑换性判定 ---------- */

const parseTime = (s) => {
  if (!s) return NaN;
  const d = new Date(String(s).replace(' ', 'T'));
  return d.getTime();
};

/** 真实可兑换：状态上架 且 当前时间落在 [upTime, downTime] 内。 */
function redeemable(product, now) {
  if (Number(product.status) !== 2) {
    return { ok: false, reason: `状态非上架（status=${product.status}）` };
  }
  const up = parseTime(product.upTime);
  const down = parseTime(product.downTime);
  if (Number.isFinite(up) && now < up) return { ok: false, reason: `尚未开始（${product.upTime}）` };
  if (Number.isFinite(down) && now > down) return { ok: false, reason: `已过期（${product.downTime}）` };
  return { ok: true, reason: '当前可兑换' };
}

const pad = (s, n) => {
  // 中文按 2 个字符宽度粗略对齐
  const width = [...String(s)].reduce((w, ch) => w + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - width));
};

/* ---------- 主流程 ---------- */

async function main() {
  // Token 必须是可打印 ASCII。实际踩过的坑：.env.local 里留着中文占位文字没替换，
  // 直接塞进 HTTP 头会抛出 "Cannot convert argument to a ByteString because the
  // character at index N has a value of ..." 这种完全无法定位的错误。
  // 这里提前拦住并给出人话。
  if (!FROM_FILE) {
    if (!TOKEN) {
      console.error(`✗ 未找到 MCD_MCP_TOKEN。\n  已尝试读取：${ENV_PATH}`);
      console.error('  请在 .env.local 中填写，或执行：MCD_MCP_TOKEN=xxx node scripts/check-sku.mjs');
      process.exit(2);
    }
    if (/[^\x21-\x7e]/.test(TOKEN)) {
      console.error('✗ MCD_MCP_TOKEN 不是合法 Token：检测到中文、空格或控制字符。');
      console.error('  这通常说明 .env.local 里还是占位文字（例如「请填写你的Token」）没被替换掉。');
      console.error('  真实 Token 为纯 ASCII 字符串，请到 https://open.mcd.cn/mcp 控制台复制。');
      process.exit(2);
    }
  }

  const coinSku = (env.VITE_MCD_COIN_SKU_ID || '').trim();
  const couponSku = (env.VITE_MCD_COUPON_SKU_ID || '').trim();

  if (FROM_FILE) {
    console.log(`模式   离线重放（${FROM_FILE}，不联网、不需要 Token）`);
  } else {
    console.log(`端点   ${ENDPOINT}`);
    console.log(`环境   ${ENV_PATH}`);
    console.log('模式   只读预检（不会调用 mall-create-order，不产生任何订单）');
  }
  console.log('');

  let payload;
  if (FROM_FILE) {
    try {
      payload = JSON.parse(readFileSync(resolve(process.cwd(), FROM_FILE), 'utf8'));
    } catch (error) {
      console.error(`✗ 读取重放文件失败：${error.message}`);
      process.exit(2);
    }
  } else {
    try {
      payload = await callTool(PRODUCTS_TOOL, {});
    } catch (error) {
      console.error(`✗ 调用 ${PRODUCTS_TOOL} 失败：${error.message}`);
      process.exit(2);
    }
  }

  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  if (!list.length) {
    console.error('✗ 商品列表为空，无法预检');
    process.exit(2);
  }

  const now = Date.now();
  const rows = list.map((p) => ({ ...p, _check: redeemable(p, now) }));
  const usable = rows.filter((r) => r._check.ok);
  const expired = rows.filter((r) => !r._check.ok);

  console.log(`商品总数 ${list.length}　当前可兑换 ${usable.length}　不可兑换 ${expired.length}\n`);

  const show = SHOW_ALL ? rows : usable;
  console.log(pad('spuId', 8) + pad('积分', 6) + pad('状态', 22) + '商品名称');
  console.log('-'.repeat(72));
  for (const p of show) {
    const mark = p._check.ok ? '可兑' : '不可兑';
    console.log(
      pad(p.spuId, 8) +
        pad(p.point ?? '-', 6) +
        pad(`${mark}·${p._check.reason}`, 22) +
        String(p.spuName || '')
    );
  }
  if (!SHOW_ALL && expired.length) {
    console.log(`\n（已隐藏 ${expired.length} 个当前不可兑换的商品，加 --all 查看）`);
  }

  /* 校验 .env 里配置的 SKU */
  const checks = [
    { env: 'VITE_MCD_COIN_SKU_ID', label: '代币包', value: coinSku },
    { env: 'VITE_MCD_COUPON_SKU_ID', label: '麦乐鸡券', value: couponSku },
  ];

  console.log('\n' + '='.repeat(72));
  let failed = 0;
  let configuredCount = 0;

  for (const c of checks) {
    if (!c.value) {
      console.log(`○ ${c.label}（${c.env}）未配置 —— 真实模式下兑${c.label === '代币包' ? '币' : '券'}会被拒绝并明确报错`);
      continue;
    }
    configuredCount++;
    const hit = rows.find((r) => String(r.spuId) === String(c.value));
    if (!hit) {
      console.log(`✗ ${c.label}（${c.env}=${c.value}）在积分商城中不存在`);
      console.log(`   提示：返回字段是商品级 spuId，不是 skuId，请确认填的是 spuId`);
      failed++;
      continue;
    }
    if (!hit._check.ok) {
      console.log(`✗ ${c.label}（${c.value} → ${hit.spuName}）${hit._check.reason}`);
      failed++;
      continue;
    }
    console.log(`✓ ${c.label}（${c.value} → ${hit.spuName}）可兑换，需 ${hit.point} 积分`);
  }

  console.log('='.repeat(72));
  if (!configuredCount) {
    console.log('结果：未配置任何真实 SKU，仅完成商城可兑换性浏览（只读，无副作用）');
  } else if (failed) {
    console.log(`结果：${failed} 项配置不可用，请修正 .env.local 后再开启真实模式`);
  } else {
    console.log('结果：全部配置项通过预检，可开启真实模式');
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`✗ 预检异常：${error?.message || error}`);
  process.exit(2);
});
