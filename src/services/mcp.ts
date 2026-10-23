/**
 * 麦当劳中国 MCP 客户端。
 *
 * 协议：MCP Streamable HTTP，JSON-RPC 2.0
 * 端点：同源 /api/mcp（由 Vite/生产 BFF 代理到 https://mcp.mcd.cn）
 * 鉴权：Authorization 由 Node 代理从 MCD_MCP_TOKEN 注入，不进入浏览器 bundle
 *
 * 安全说明（务必阅读）：
 * 前端只请求同源代理，不读取、也不持有真实 Token。
 * 开发环境由 vite.config.js 的 proxy 转发；生产环境必须部署自己的 BFF/Serverless 代理。
 * 商品 SKU 从 import.meta.env.VITE_MCD_COIN_SKU_ID / VITE_MCD_COUPON_SKU_ID 读取；
 * SKU 不是凭证。工具参数以服务端 tools/list 的运行时 schema 为准。
 */

export type McpOrderResult = {
  orderId: string | null;
  orderStatus: string | null;
  couponCodes: string[];
  /** 部分实现会直接返回扣减后的积分，状态层可优先采用。 */
  pointsAfter?: number;
  raw: unknown;
};

export type McpPointsResult = {
  points: number;
  raw: unknown;
};

export class McpError extends Error {
  code: string;
  status?: number;
  details?: unknown;

  constructor(code: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type EnvLike = Record<string, string | boolean | undefined>;

const env = ((import.meta as unknown as { env?: EnvLike }).env ?? {}) as EnvLike;
// 安全红线：Token 只从 Vite 环境变量读取，源码中绝不写死。
// 注意 VITE_ 变量会被打包到前端，详见文件顶部说明。

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_ENDPOINT = '/api/mcp';
const ACCOUNT_TOOL = 'query-my-account';
const ORDER_TOOL = 'mall-create-order';
const REQUEST_TIMEOUT_MS = 20_000;
const POINT_KEYS = [
  'availablePoints',
  'availablePoint',
  'points',
  'currentPoints',
  'memberPoints',
  'pointBalance',
  'balance',
  'totalPoints',
];

const asEnvString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readPositiveInt = (value: unknown, fallback: number): number => {
  const n = Number(asEnvString(value));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** 麦当劳接口常包一层 { success, code, message, data }，统一取出业务 data。 */
function unwrapBusinessData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.success === false) {
    const message =
      (typeof value.message === 'string' && value.message) ||
      (typeof value.msg === 'string' && value.msg) ||
      '麦当劳 MCP 业务处理失败';
    throw new McpError('MCP_BUSINESS_ERROR', message, { details: value });
  }
  if (value.data !== undefined && (value.success === true || 'code' in value)) {
    return value.data;
  }
  return value;
}

/** 深度查找积分字段；优先可用积分，避免误取“即将过期积分/商品积分”。 */
function findPoints(value: unknown): number | null {
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const key of POINT_KEYS) {
      if (!(key in current)) continue;
      const n = Number(current[key]);
      if (Number.isFinite(n)) return n;
    }
    for (const nested of Object.values(current)) {
      if (nested && (typeof nested === 'object' || Array.isArray(nested))) queue.push(nested);
    }
  }
  return null;
}

function normalizeCodeList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function extractOrder(value: unknown): McpOrderResult {
  const data = asRecord(unwrapBusinessData(value));
  const rawCoupons = Array.isArray(data.coupons) ? data.coupons : [];
  const couponCodes = rawCoupons.flatMap((coupon) => {
    if (typeof coupon === 'string') return [coupon];
    const c = asRecord(coupon);
    return [
      ...normalizeCodeList(c.couponCodes),
      ...normalizeCodeList(c.couponCode),
      ...normalizeCodeList(c.code),
      ...normalizeCodeList(c.voucherCode),
    ];
  });
  if (!couponCodes.length) {
    couponCodes.push(
      ...normalizeCodeList(data.couponCodes),
      ...normalizeCodeList(data.couponCode),
      ...normalizeCodeList(data.voucherCode)
    );
  }
  const orderId =
    (typeof data.orderId === 'string' && data.orderId) ||
    (typeof data.orderNo === 'string' && data.orderNo) ||
    (typeof data.id === 'string' && data.id) ||
    null;
  const orderStatus =
    (typeof data.orderStatus === 'string' && data.orderStatus) ||
    (typeof data.status === 'string' && data.status) ||
    null;
  const numericStatus = Number(data.status ?? data.orderStatus ?? data.orderState);
  if (Number.isFinite(numericStatus) && numericStatus === 0) {
    throw new McpError('MCP_ORDER_FAILED', '麦当劳订单未成功（status=0）', { details: data });
  }
  if (orderStatus && /(fail|cancel|error|closed|失败|取消)/i.test(orderStatus)) {
    throw new McpError('MCP_ORDER_FAILED', `麦当劳订单未成功：${orderStatus}`, { details: data });
  }
  // 只接受明确的“下单后余额”字段；不要把商品消耗的 points 误当成余额。
  const pointsAfter = Number(data.pointsAfter ?? data.availablePoints ?? data.pointBalance);
  return {
    orderId,
    orderStatus,
    couponCodes,
    ...(Number.isFinite(pointsAfter) ? { pointsAfter } : {}),
    raw: value,
  };
}

function extractTextContent(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((item) => {
      const block = asRecord(item);
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseMaybeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type McpClientOptions = {
  endpoint?: string;
  coinSkuId?: string;
  couponSkuId?: string;
  coinOrderArgs?: Record<string, unknown>;
  couponOrderArgs?: Record<string, unknown>;
  coinCount?: number;
  couponCount?: number;
  mock?: boolean;
  mockPoints?: number;
};

export class McdMcpClient {
  readonly endpoint: string;
  readonly mock: boolean;
  private readonly coinSkuId: string;
  private readonly couponSkuId: string;
  private readonly coinOrderArgs?: Record<string, unknown>;
  private readonly couponOrderArgs?: Record<string, unknown>;
  private readonly coinCount: number;
  private readonly couponCount: number;
  private sessionId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private nextId = 1;
  private mockPoints: number;

  constructor(options: McpClientOptions = {}) {
    this.endpoint = (options.endpoint ?? asEnvString(env.VITE_MCD_MCP_URL) ?? DEFAULT_ENDPOINT).replace(
      /\/+$/,
      ''
    ) || DEFAULT_ENDPOINT;
    this.coinSkuId = options.coinSkuId ?? asEnvString(env.VITE_MCD_COIN_SKU_ID);
    this.couponSkuId = options.couponSkuId ?? asEnvString(env.VITE_MCD_COUPON_SKU_ID);
    this.coinOrderArgs = options.coinOrderArgs ?? parseOrderArgsEnv(env.VITE_MCD_COIN_ORDER_ARGS, 'VITE_MCD_COIN_ORDER_ARGS');
    this.couponOrderArgs =
      options.couponOrderArgs ?? parseOrderArgsEnv(env.VITE_MCD_COUPON_ORDER_ARGS, 'VITE_MCD_COUPON_ORDER_ARGS');
    this.coinCount = options.coinCount ?? readPositiveInt(env.VITE_MCD_COIN_COUNT, 1);
    this.couponCount = options.couponCount ?? readPositiveInt(env.VITE_MCD_COUPON_COUNT, 1);
    this.mock = options.mock ?? asEnvString(env.VITE_MCD_MOCK) === '1';
    this.mockPoints = options.mockPoints ?? readPositiveInt(env.VITE_MCD_MOCK_POINTS, 1000);
  }

  get isMock(): boolean {
    return this.mock;
  }

  get isConfigured(): boolean {
    // 前端不再检查 Token；代理是否配置由 /api/mcp 的实际响应决定。
    return Boolean(this.endpoint);
  }

  /** 查询麦当劳会员积分（query-my-account，传空对象）。 */
  async getPoints(): Promise<McpPointsResult> {
    if (this.mock) {
      return { points: this.mockPoints, raw: { mock: true, points: this.mockPoints } };
    }
    const result = await this.callTool(ACCOUNT_TOOL, {});
    const data = unwrapBusinessData(result.data);
    const points = findPoints(data);
    if (points === null) {
      throw new McpError('MCP_POINTS_NOT_FOUND', 'MCP 账户返回中没有找到积分字段，请检查 query-my-account 的返回结构');
    }
    return { points: Math.floor(points), raw: result.data };
  }

  /**
   * 100 积分 -> 5 代币 的下单动作。
   * 真实扣分由麦当劳积分商城完成；本方法只负责调用 mall-create-order。
   */
  async buyCoins(): Promise<McpOrderResult> {
    if (this.mock) {
      this.mockPoints = Math.max(0, this.mockPoints - 100);
      return {
        orderId: `MOCK-COIN-${Date.now().toString(36)}`,
        orderStatus: 'SUCCESS',
        couponCodes: [],
        pointsAfter: this.mockPoints,
        raw: { mock: true, skuId: this.coinSkuId || 'MOCK-COIN-SKU', count: this.coinCount },
      };
    }
    const args = this.buildOrderArgs('coin');
    const result = await this.callTool(ORDER_TOOL, args);
    return extractOrder(result.data);
  }

  /** 3 个掉落物 -> 1 张真实麦乐鸡券 的下单动作。 */
  async exchangeCoupon(): Promise<McpOrderResult> {
    if (this.mock) {
      return {
        orderId: `MOCK-COUPON-${Date.now().toString(36)}`,
        orderStatus: 'SUCCESS',
        couponCodes: [`MOCK-MCD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`],
        raw: { mock: true, skuId: this.couponSkuId || 'MOCK-COUPON-SKU', count: this.couponCount },
      };
    }
    const args = this.buildOrderArgs('coupon');
    const result = await this.callTool(ORDER_TOOL, args);
    const order = extractOrder(result.data);
    if (!order.couponCodes.length && !order.orderId) {
      throw new McpError('MCP_COUPON_MISSING', '订单已返回，但没有券码或订单号，无法确认券已发放', {
        details: order.raw,
      });
    }
    return order;
  }

  /** 通用 tools/call，便于后续接入 mall-points-products 等工具。 */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; text: string; raw: unknown }> {
    const rpc = await this.request('tools/call', { name, arguments: args });
    const result = asRecord(rpc.result);
    const text = extractTextContent(result);
    if (result.isError === true) {
      throw new McpError('MCP_TOOL_ERROR', text || `MCP 工具 ${name} 执行失败`, {
        details: result,
      });
    }
    const structured = result.structuredContent;
    const data = structured ?? parseMaybeJson(text) ?? result;
    return { data, text, raw: result };
  }

  private buildOrderArgs(kind: 'coin' | 'coupon'): Record<string, unknown> {
    const override = kind === 'coin' ? this.coinOrderArgs : this.couponOrderArgs;
    if (override) return { ...override };
    const skuId = kind === 'coin' ? this.coinSkuId : this.couponSkuId;
    const count = kind === 'coin' ? this.coinCount : this.couponCount;
    if (!skuId) {
      const name = kind === 'coin' ? 'VITE_MCD_COIN_SKU_ID' : 'VITE_MCD_COUPON_SKU_ID';
      throw new McpError(
        'MCP_PRODUCT_NOT_CONFIGURED',
        `未配置 ${name}：请先在麦当劳积分商城找到对应商品的 skuId，写入 .env`,
        { details: { env: name } }
      );
    }
    return { skuId: coerceSku(skuId), count };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const response = await this.post(
      {
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'nugget-pusher-mcp', version: '1.0.0' },
        },
      },
      { includeProtocolHeader: false }
    );
    const rpc = await this.readResponse(response);
    if (!rpc || rpc.error) {
      throw new McpError(
        'MCP_INIT_FAILED',
        rpc?.error?.message || '麦当劳 MCP 初始化失败',
        { details: rpc?.error }
      );
    }
    // Streamable HTTP 在响应头下发 session；后续请求必须沿用。
    this.initialized = true;
    await this.post(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { notification: true }
    );
  }

  private async request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    await this.ensureInitialized();
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: '2.0', id, method, params });
    const rpc = await this.readResponse(response);
    if (!rpc) {
      throw new McpError('MCP_EMPTY_RESPONSE', `MCP ${method} 没有返回 JSON-RPC 响应`);
    }
    if (rpc.error) {
      throw new McpError(
        'MCP_RPC_ERROR',
        rpc.error.message || `MCP ${method} 调用失败`,
        { details: rpc.error.data }
      );
    }
    return rpc;
  }

  private headers(options: { includeProtocolHeader?: boolean } = {}): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Streamable HTTP 服务端可以返回 JSON，也可以返回 SSE。
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.initialized && options.includeProtocolHeader !== false) {
      headers['Mcp-Protocol-Version'] = PROTOCOL_VERSION;
    }
    return headers;
  }

  private async post(
    payload: Record<string, unknown>,
    options: { notification?: boolean; includeProtocolHeader?: boolean } = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(options),
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: 'omit',
        mode: 'cors',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new McpError('MCP_TIMEOUT', '麦当劳 MCP 请求超时，请稍后再试');
      }
      throw new McpError(
        'MCP_NETWORK_ERROR',
        '无法连接麦当劳 MCP。请检查网络；若浏览器控制台提示 CORS，需要通过后端/Vite 代理转发。',
        { details: error }
      );
    } finally {
      clearTimeout(timer);
    }

    const sid = response.headers.get('Mcp-Session-Id') || response.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const code =
        response.status === 401 || response.status === 403
          ? 'MCP_UNAUTHORIZED'
          : response.status === 429
            ? 'MCP_RATE_LIMITED'
            : 'MCP_HTTP_ERROR';
      const message =
        response.status === 401 || response.status === 403
          ? '麦当劳 MCP 鉴权失败，请检查服务端 MCD_MCP_TOKEN 是否有效或已过期'
          : response.status === 429
            ? '麦当劳 MCP 请求过于频繁，请稍后再试'
            : `麦当劳 MCP 请求失败（HTTP ${response.status}）`;
      throw new McpError(code, message, { status: response.status, details: body.slice(0, 500) });
    }

    if (options.notification) return response;
    return response;
  }

  private async readResponse(response: Response): Promise<JsonRpcResponse | null> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      return this.readSse(response);
    }
    const text = await response.text();
    if (!text.trim()) return null;
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed.find((item) => isRecord(item) && 'result' in item) as JsonRpcResponse) ?? null;
    }
    return isRecord(parsed) ? (parsed as JsonRpcResponse) : null;
  }

  private async readSse(response: Response): Promise<JsonRpcResponse | null> {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line === '') {
            if (dataLines.length) {
              const data = dataLines.join('\n');
              dataLines = [];
              if (data !== '[DONE]') {
                try {
                  const parsed = JSON.parse(data) as JsonRpcResponse;
                  if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) {
                    return parsed;
                  }
                } catch {
                  // 忽略 SSE 注释/心跳。
                }
              }
            }
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
          newline = buffer.indexOf('\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
    return null;
  }
}

function coerceSku(value: string): number | string {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
}

function parseOrderArgsEnv(value: unknown, envName: string): Record<string, unknown> | undefined {
  const raw = asEnvString(value);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) throw new Error('must be object');
    return parsed;
  } catch {
    throw new McpError('MCP_CONFIG_INVALID', `${envName} 必须是合法 JSON 对象`);
  }
}

/** 单例：状态层只依赖这个实例，便于测试时替换为 mock。 */
export const mcp = new McdMcpClient();

/** 便捷函数：按需求中的命名直接调用单例。 */
export const getPoints = (): Promise<McpPointsResult> => mcp.getPoints();
export const buyCoins = (): Promise<McpOrderResult> => mcp.buyCoins();
export const exchangeCoupon = (): Promise<McpOrderResult> => mcp.exchangeCoupon();
