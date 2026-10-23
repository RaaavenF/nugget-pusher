# MCP 真机验收记录 · 麦乐鸡块推币机

本文记录本项目对麦当劳中国 MCP 的**真实链路验收**：调用时间、使用的 Tool、真实返回（已脱敏）、结论，以及**未执行的写操作及其原因**。

> 验收目的：验证本项目确实真实调用麦当劳 MCP，而非仅在 mock 模式下运行。
> 验收环境：WorkBuddy 智能体 + 麦当劳中国 MCP 连接器（`https://mcp.mcd.cn`），使用真实 MCP Token 与真实会员账户。

---

## 1. 验收结论摘要

| 链路 | Tool | 状态 | 说明 |
|---|---|:---:|---|
| 会员积分读取 | `query-my-account` | ✅ 通过 | 返回真实账户积分，字段 `availablePoint` 可正确解析 |
| 积分商城商品列表 | `mall-points-products` | ✅ 通过 | 返回全量商品，可读取 `spuId` / `point` / `status` / `downTime` |
| 下单（兑币） | `mall-create-order` | ⏸ 未执行 | 无对应代币包 SKU；见 §4 |
| 下单（发券） | `mall-create-order` | ⏸ 未执行 | 公开积分商城未检索到麦乐鸡专属券 SKU；见 §4 |

**只读链路已用真实 Token 实机验证通过。写操作链路代码完整，但因缺少匹配 SKU 未实机执行，且在缺少 SKU 时会明确报错而非伪造成功。**

---

## 2. 验收明细

### 2.1 `query-my-account` — 会员积分读取

- 调用时间：2026-10-23 08:12:17（北京时间）
- traceId：`48324d3247edcf8fc676a9b3470c6315`
- 真实返回（脱敏后）：

```json
{
  "success": true,
  "code": 200,
  "message": "请求成功",
  "data": {
    "accountId": "0200****5595",
    "currency": "麦享会积分",
    "availablePoint": "83.8",
    "accumulativePoint": "122.5",
    "expiredPoint": "38.7",
    "usedPoint": "0",
    "frozenPoint": "0"
  }
}
```

**验证点**：本项目 `src/services/mcp.ts` 的 `findPoints()` 递归归一化逻辑在真实返回结构下可正确取到 `data.availablePoint`。真机返回结构为 `data.availablePoint`，字段名与代码候选列表一致，无需兼容性修补。

### 2.2 `mall-points-products` — 积分商城商品列表

- 调用时间：2026-10-23 08:12:39（北京时间）
- traceId：`1ffd5c42d2ef6c9bbe8788050a6013af`
- 返回商品条目：55 条（含商品券、实物商品、派对、品鉴会、玩具、鞋袜等多类目）

**真机返回字段与项目预期的差异（重要）**：

| 字段 | 真机返回值 | 项目原假设 |
|---|---|---|
| 唯一标识 | `spuId`（商品级，非 SKU 级） | `skuId` |
| 所需积分 | `point`（字符串） | 未定义 |
| 上下架时间 | `upTime` / `downTime` | 未使用 |
| 状态 | `status`（1 仓库 / 2 上架 / 3 售罄 / 4 下架 / 5 预热） | 未使用 |

**关键发现**：`status = 2`（上架）**不代表当前可兑换**。返回数据中存在大量 `status = 2` 但 `downTime` 已早于当前时间的历史商品（如 `downTime = 2026-03-21`、`2026-06-24`）。因此兑换前必须以 `upTime <= now <= downTime` 二次过滤，不能只看 `status`。

---

## 3. 链路时序（真机确认）

```text
WorkBuddy / 浏览器客户端
  → POST https://mcp.mcd.cn   (Streamable HTTP, JSON-RPC 2.0)
     Authorization: Bearer <MCD_MCP_TOKEN>
  → initialize → notifications/initialized → tools/call
  → 返回 JSON，data 字段承载业务结果
```

真机确认：`success` / `code` / `message` / `datetime` / `traceId` / `data` 为统一信封，业务数据在 `data` 内。项目 `src/services/mcp.ts` 对 `code === 200` 与 `success === true` 的判断与真机一致。

---

## 4. 未执行的写操作及原因

`mall-create-order` 是真实扣积分 / 发券的写操作，本项目在**未配置有效 SKU 时不会调用**。原因如下：

1. **无代币包 SKU**：麦当劳积分商城不存在「100 积分兑换 5 枚游戏代币」这类商品。`100 积分 → 5 代币` 是项目自定义规则，需运营侧新建对应 SKU 后才可走真实下单。
2. **无麦乐鸡券 SKU**：截至验收时间，公开积分商城全类目检索未发现「麦乐鸡券」商品。最接近的为「16.9元中薯麦乐鸡组合」（`spuId` 16056，200 积分），但其 `downTime` 为 2026-06-24，已过期。
3. **账户积分不足门槛**：验收账户可用积分 83.8，低于项目设定的 100 积分兑币门槛，即使存在 SKU 亦无法完成真实扣减。

**因此本项目不伪造写操作成功**：真实模式在缺少 `VITE_MCD_COIN_SKU_ID` / `VITE_MCD_COUPON_SKU_ID` 时会明确报错，不扣积分、不加代币、不发券。演示模式（`npm run dev:mock`）下才使用本地记账。

---

## 5. 可复现步骤

审核方可使用自己的 MCP Token 复现只读验收：

1. 在 <https://open.mcd.cn/mcp> 登录并激活 MCP Token。
2. 按 `mcp-config.example.json` 配置客户端，将 `${MCD_MCP_TOKEN}` 替换为实际 Token。
3. 调用 `query-my-account`（无入参），应返回自身会员积分。
4. 调用 `mall-points-products`（无入参或传 `catRuleIds`），应返回积分商城商品列表。

或使用本项目自带前端：

```bash
npm install
cp .env.example .env.local   # 填入 MCD_MCP_TOKEN
npm run dev                  # 顶部状态点显示「已连接麦当劳 MCP」
```

---

## 6. 声明

- 本文档所有 traceId 与返回数据均来自真实 MCP 调用，未做数值篡改。
- 账户标识已脱敏（`accountId` 中间位打码），不包含真实 Token、密码或其他凭证。
- 未执行任何真实扣积分或发券的写操作，因此不对任何账户资产造成影响。
