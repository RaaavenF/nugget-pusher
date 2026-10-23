# WorkBuddy 开发上下文

> 本文档记录本项目在 **WorkBuddy** 中完成的工作阶段：MCP 真机验收、缺陷发现、预检工具补齐与文档修正。
> 范围声明：本文件仅覆盖上述阶段与其中的决策过程，不覆盖其他工具链下的历史开发。
> 所有技术描述均对应仓库内的真实文件，可按文末「核验方式」逐条复查。

## 1. 项目与技术栈（据实描述）

| 项 | 实际实现 |
|---|---|
| 语言 / 框架 | 原生 JavaScript（ES Module），**未使用 React/Vue 等框架，未使用 TypeScript 编译** |
| 3D 渲染 | three.js（`three@^0.186.1`，唯一运行时依赖） |
| 构建 | Vite 8（`vite.config.js`，非 `.ts`） |
| 样式 | Tailwind CSS（`tailwind.config.js` + `src/tailwind.css`） |
| 状态管理 | 自研 Store + 订阅（`src/store.js`），未引入 Zustand 等库 |
| 物理 | 自研定点步进物理（`src/physics.js`），未使用 Rapier/Cannon 等物理引擎 |
| MCP 客户端 | 手写 Streamable HTTP / JSON-RPC 2.0（`src/services/mcp.ts`） |
| 玩法参数 | 集中在 `src/config.js` |
| 源文件数 | `src/` 下 15 个文件 |

> 说明：`src/services/mcp.ts` 使用 `.ts` 扩展名但由 Vite/esbuild 直接转译，仓库内没有 `tsconfig.json`，不做独立类型检查。

## 2. 本轮在 WorkBuddy 中做的事

### 2.1 MCP 真机验收（只读）

用真实 MCP Token 与真实会员账户打通 `https://mcp.mcd.cn`，完成两次只读调用：

| Tool | 用途 | traceId |
|---|---|---|
| `query-my-account` | 读取会员积分 | `48324d3247edcf8fc676a9b3470c6315` |
| `mall-points-products` | 拉取积分商城商品（返回 55 条） | `1ffd5c42d2ef6c9bbe8788050a6013af` |

结论与完整返回（accountId 已脱敏）见 `docs/MCP_VERIFICATION.md`。**未调用 `mall-create-order`**——该操作为真实扣积分/发券的写操作，在没有匹配 SKU 的情况下执行会给账户造成真实损失。

### 2.2 真机返回暴露的三个问题

**问题一：`status = 2` 不代表可兑换。**
商城返回中大量商品状态为「上架」（`status = 2`），但 `downTime` 早已早于当前时间（如 2026-03-21、2026-06-24）。只看 `status` 选商品，会把已下架商品配进 `.env.local`。
→ 处理：判定条件改为 `status === 2 && upTime <= now <= downTime`，并落地为可执行校验。

**问题二：返回字段是商品级 `spuId`，不是 `skuId`。**
项目 `.env` 里配的是 `VITE_MCD_COIN_SKU_ID` / `VITE_MCD_COUPON_SKU_ID`，若直接在商城返回里找 `skuId` 会永远匹配不上。
→ 处理：预检脚本按 `spuId` 匹配，并在匹配失败时直接提示这个差异，避免排查方向跑偏。

**问题三：`.env.local` 里的 `MCD_MCP_TOKEN` 是中文占位文字。**
该行长度 30 且含非 ASCII 字符，说明占位文字没有被替换成真实 Token。直接发起请求时，Fetch 会抛出
`Cannot convert argument to a ByteString because the character at index 13 has a value of 22320...`
——这个报错完全无法定位到「Token 是假的」这一真实原因。
→ 处理：预检脚本在请求前先校验 Token 是否为可打印 ASCII，非 ASCII 时直接给出人话提示并退出，不让天书错误冒到上层。

### 2.3 补齐预检工具

`README.md` 原本写着「配置真实 SKU 前，请先使用 `mall-points-products` / `mall-product-detail` 核对商品上下架状态与 `skuId`」，但仓库里没有任何代码承担这一步，全靠人工翻文档——这正是上述三个问题能漏到提交阶段的原因。

新增：

- `scripts/check-sku.mjs` — 只读 SKU 预检。调 `mall-points-products`，按 `upTime/downTime` 过滤出真正可兑换的商品，再校验 `.env.local` 里配置的 SKU 是否命中且可兑。
- `npm run check:sku` — 入口，支持 `--all`（含已过期）与 `--from-file`（离线重放，无需 Token，便于回归）。
- `tests/fixtures/mall-points-products.sample.json` — 摘自真实返回的样本（8 条，保留原始信封与字段），作为离线回归与字段结构参考。

退出码语义：`0` 配置可用 / `1` 配置不可用 / `2` 环境或鉴权问题。

### 2.4 验证记录

预检脚本用真实返回样本跑了 5 个用例：

| 用例 | 输入 | 期望 | 结果 |
|---|---|---|---|
| 1 | 未配置任何 SKU | 列出可兑 4 条、不可兑 4 条，不报错 | ✅ 退出码 0 |
| 2 | 代币包配 `17073`（有效）、券配 `16056`（麦乐鸡组合，已过期） | 前者通过、后者拦截 | ✅ 退出码 1，提示「已过期（2026-06-24 23:59:59）」 |
| 3 | 券配 `99999999`（不存在） | 报不存在并提示 `spuId` 差异 | ✅ 退出码 1 |
| 4 | `MCD_MCP_TOKEN='请填写你的Token'` | 识别为占位文字并给出获取地址 | ✅ 退出码 2 |
| 5 | 完全未配 Token | 报缺失并指出读取路径 | ✅ 退出码 2 |

构建验证：

```text
vite v8.3.5 building client environment for production...
✓ 26 modules transformed.
✓ built in 9.93s
```

### 2.5 文档修正

- `MCP_INTEGRATION.md` §7：原表述为「未进行真实账户扣积分/发券实机验收」，改为区分「只读链路已用真实 Token 实机验证通过」与「写操作因缺少匹配 SKU 未执行，且缺少 SKU 时会明确报错而非伪造成功」。
- `MCP_INTEGRATION.md` §2：补充 `status` 与 `spuId` 两处真机字段差异。
- `README.md`：新增「SKU 预检」小节与 `npm run check:sku` 命令。

### 2.6 一处主动放弃的改动

最初打算「修复 SKU 选择的 `status` 过滤 bug」，核查代码后发现**该 bug 并不存在**——`mall-points-products` 从未进入运行时主流程（运行时只调用 `query-my-account` 与 `mall-create-order`），项目代码里没有按 `status` 选商品的逻辑。

因此改为不动运行时代码，把这条判定逻辑落到新增的预检脚本里。**不为凑改动而改运行时代码**，避免给已验证通过的 E2E 流程引入回归风险。

## 3. 未做的事与原因

| 事项 | 原因 |
|---|---|
| 调用 `mall-create-order` 做真机下单 | 真实扣积分 + 真实支付，且商城无对应「代币包」「麦乐鸡券」SKU，做了对项目无验证价值 |
| 声称已完成真实发券闭环 | 公开积分商城全类目检索未发现麦乐鸡券商品，不能虚假声称 |
| 使用真实账户数据之外的虚构返回 | 所有引用数据均来自真实调用，附 traceId 可复查 |

## 4. 核验方式

审核方可逐条对照仓库复查：

```bash
# 1. 确认真实依赖（应只有 three）
cat package.json

# 2. 确认无 React/TS 编译产物与配置
ls src/ && ls vite.config.js

# 3. 确认源文件数
find src -type f | wc -l        # 15

# 4. 复跑预检脚本（离线，无需 Token）
npm run check:sku -- --from-file tests/fixtures/mall-points-products.sample.json

# 5. 复跑构建
npm run build
```

真实 MCP 只读调用请配置自己的 `MCD_MCP_TOKEN` 后执行 `npm run check:sku`，或直接调用 `query-my-account`；本文引用的 traceId 为真实调用记录。
