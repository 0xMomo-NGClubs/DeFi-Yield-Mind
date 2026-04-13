# DeFi Yield Hub

基于 LI.FI Earn API 构建的收益聚合平台，核心产品是一份通用 OpenAPI Skill 定义，让任意 Agent 框架（Claude、OpenClaw、LangChain 等）都能通过对话调用 DeFi 存款操作。

参赛：[DeFi Mullet Hackathon #1: Builder Edition](https://lifi.notion.site/defi-mullet-hackathon-1-builder-edition)
赛道：🔧 Developer Tooling

---

## 目录

- [项目背景](#项目背景)
- [整体架构](#整体架构)
- [项目结构](#项目结构)
- [Agent Skill 接入](#agent-skill-接入)
- [API 接口设计](#api-接口设计)
- [OpenAPI Skill](#openapi-skill)
- [前端页面](#前端页面)
- [技术栈](#技术栈)
- [LI.FI API 参考](#lifi-api-参考)
- [关键注意事项](#关键注意事项)
- [参赛资源](#参赛资源)

---

## 项目背景

### 什么是 DeFi Mullet

> "Business in the front, yield in the back" — 前端简洁的用户体验，后端由 LI.FI 的跨链基础设施完成所有执行逻辑。

LI.FI Earn 是一个统一的 DeFi 收益 API，一次集成即可接入：
- **20+ 协议**：Morpho、Aave、Euler、Pendle、Ethena、EtherFi 等
- **60+ 链**：一套 API，所有链
- **一键存款**：通过 Composer 实现 swap + bridge + deposit 单笔交易

### 为什么做 Developer Tooling

当前 DeFi 开发者若要集成 LI.FI Earn，需要自己阅读文档、封装 API、处理边界情况。本项目将这一过程标准化：

- 提供封装好的后端 API，处理认证、分页、错误、精度换算等细节
- 提供一份标准 `openapi.yaml`，任意 Agent 框架直接读取即可调用
- 提供前端页面作为 Demo，展示 API 的完整能力

---

## 整体架构

```
Agent 框架（本地运行）
    │
    ├─ GET  /vaults / POST /search/parse → 查询最优收益机会
    ├─ POST /deposit/quote               → 获取未签名交易（API 不碰私钥）
    │
    │  Skill 文件在本地用 viem 签名 + 广播（私钥不离本机）
    ▼
区块链
        ↑
后端 API（Node.js + Hono）
    ├── earn.li.fi  → Vault 数据（免认证）
    └── li.quest    → Composer 报价（需 API Key）
        ↑
前端页面（Next.js，调同一套后端 API）
```

Agent 完整执行流程示例：

```
用户："把 1 USDC 存入 Arbitrum 上 APY 最高的 vault"

Agent
  → get_vaults({ asset: "USDC", chainId: 42161, sortBy: "apy", limit: 1 })
  → execute_deposit({ fromChainId: 42161, fromToken: "0xUSDC...",
                      fromAmount: "1000000", vaultAddress: "0x..." })
      [本地] 检查 ERC-20 allowance
      [本地] 发 approve 交易（如需）→ 等待链上确认
      [本地] 签名存款交易 → 广播 → 等待确认
  ← { txHash: "0xabc...", status: "success" }
```

---

## 项目结构

```
LIFI/
├── api/                            # 后端服务（Node.js + TypeScript + Hono）
│   ├── src/
│   │   ├── routes/
│   │   │   ├── vaults.ts           # GET /vaults, /vaults/:chainId/:address
│   │   │   ├── portfolio.ts        # GET /portfolio/:wallet
│   │   │   ├── deposit.ts          # POST /deposit/quote
│   │   │   ├── redeem.ts           # POST /redeem/quote
│   │   │   ├── search.ts           # POST /search/parse（AI 搜索）
│   │   │   ├── history.ts          # GET /history/:chainId/:address
│   │   │   ├── chains.ts           # GET /chains
│   │   │   └── protocols.ts        # GET /protocols
│   │   ├── services/
│   │   │   ├── earn.ts             # LI.FI Earn API 封装
│   │   │   ├── composer.ts         # LI.FI Composer 封装（报价构建）
│   │   │   ├── db.ts               # SQLite 初始化
│   │   │   └── snapshot.ts         # APY 历史快照定时任务（每小时）
│   │   └── index.ts                # 服务入口
│   ├── openapi.yaml                # OpenAPI 3.0 Spec（9 个端点，含 Scalar UI）
│   ├── .env.example
│   └── package.json
│
├── skill/                          # ★ Agent Skill 文件（核心产品）
│   ├── defi-yield-hub.skill.ts     # 完整 Skill：工具定义 + 本地签名执行
│   ├── SKILL.md                    # Skill 接入指南（各框架接入方式）
│   ├── .env.example                # 环境变量模板（AGENT_PRIVATE_KEY 等）
│   ├── .gitignore                  # 忽略 .env 和 node_modules
│   ├── package.json
│   └── tsconfig.json
│
├── web/                            # 前端（Next.js App Router）
│   ├── app/
│   │   ├── page.tsx                # Vault 列表 + AI 搜索
│   │   ├── portfolio/page.tsx      # 持仓管理
│   │   ├── compare/page.tsx        # 跨链 APY 对比
│   │   └── docs/page.tsx           # SKILL 页面（API 文档 + 接入指南）
│   ├── components/
│   │   ├── DepositModal.tsx        # 存款/赎回弹窗（浏览器钱包签名）
│   │   ├── VaultCard.tsx           # Vault 卡片
│   │   └── ...
│   └── package.json
│
├── HANDOVER.md                     # 项目交接文档
└── README.md
```

---

## Agent Skill 接入

> 完整文档见 **[skill/SKILL.md](./skill/SKILL.md)**

本项目提供一个自包含的 Skill 文件（`skill/defi-yield-hub.skill.ts`），可直接接入 Claude API、LangChain、AutoGen 等 Agent 框架，实现**对话式 DeFi 操作**。

### 私钥安全架构

```
私钥存在本地 .env
    ↓
viem 在本机签名（不发给任何服务器）
    ↓
API 只负责返回未签名的 transactionRequest
```

### 快速运行

```bash
cd skill
npm install
cp .env.example .env   # 填入 AGENT_PRIVATE_KEY 和 ANTHROPIC_API_KEY

# 查询类（只读）
npm run dev "USDC 收益最高的 vault 是哪个"

# 执行类（发链上交易）
npm run dev "把 1 USDC 存入 Arbitrum APY 最高的 vault"
```

### 支持的 6 个工具

| 工具 | 类型 | 说明 |
|------|------|------|
| `get_vaults` | 只读 | 按链/代币/协议/APY 筛选 Vault 列表 |
| `ai_search` | 只读 | 自然语言搜索最优 vault |
| `get_portfolio` | 只读 | 查询钱包多链持仓 |
| `get_agent_wallet` | 只读 | 查询 Agent 操作的钱包地址 |
| `execute_deposit` | 执行 | 自动报价 → ERC-20 授权 → 签名 → 广播存款 |
| `execute_redeem` | 执行 | 自动报价 → 份额授权 → 签名 → 广播赎回 |

各框架详细接入方式（Claude API / LangChain Python / OpenAPI URL）见 [skill/SKILL.md](./skill/SKILL.md)。

---

## API 接口设计

后端基础 URL：`http://localhost:3000`（部署后替换为实际域名）

### GET `/vaults`

查询 Vault 列表，支持多维度筛选与排序。

**Query Parameters：**

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `chainId` | number | 按链过滤 | `42161`（Arbitrum） |
| `asset` | string | 按代币符号过滤 | `USDC` |
| `protocol` | string | 按协议过滤 | `morpho-v1` |
| `minApy` | number | 最低 APY 门槛（%） | `5` |
| `minTvl` | number | 最低 TVL（USD） | `1000000` |
| `sortBy` | string | 排序字段：`apy`\|`tvl`\|`apy7d`\|`apy30d` | `apy` |
| `limit` | number | 每页数量，默认 20，最大 100 | `50` |
| `cursor` | string | 分页游标（来自上一页响应的 `nextCursor`） | - |

**Response：**

```json
{
  "vaults": [
    {
      "address": "0x...",
      "chainId": 42161,
      "name": "Morpho USDC Vault",
      "protocol": { "name": "morpho-v1" },
      "underlyingTokens": [
        { "symbol": "USDC", "address": "0x...", "decimals": 6 }
      ],
      "tags": ["stablecoin", "single"],
      "analytics": {
        "apy": { "base": 5.2, "reward": 1.1, "total": 6.3 },
        "apy7d": 6.1,
        "apy30d": 5.8,
        "tvl": { "usd": "45000000" }
      },
      "isTransactional": true,
      "isRedeemable": true
    }
  ],
  "nextCursor": "xxx",
  "total": 672
}
```

---

### GET `/vaults/:chainId/:address`

获取单个 Vault 的详细信息。

**Response：** 同上单个 vault 对象。

---

### GET `/portfolio/:wallet`

查询钱包在所有协议的持仓情况。

**Path Parameters：**

| 参数 | 说明 |
|------|------|
| `wallet` | EVM 钱包地址（0x...） |

**Response：**

```json
{
  "positions": [
    {
      "chainId": 42161,
      "protocolName": "morpho-v1",
      "asset": {
        "address": "0x...",
        "name": "Morpho USDC Vault",
        "symbol": "mUSDC",
        "decimals": 6
      },
      "balanceUsd": "1234.56",
      "balanceNative": "1234560000"
    }
  ],
  "totalUsd": "1234.56"
}
```

---

### GET `/chains`

获取支持的链列表（当前 21 条链）。

**Response：**

```json
{
  "chains": [
    { "id": 42161, "name": "Arbitrum", "nativeCurrency": "ETH" },
    { "id": 8453, "name": "Base", "nativeCurrency": "ETH" }
  ]
}
```

---

### GET `/protocols`

获取支持的协议列表（当前 20+ 个）。

**Response：**

```json
{
  "protocols": [
    { "name": "morpho-v1", "displayName": "Morpho" },
    { "name": "aave-v3", "displayName": "Aave V3" }
  ]
}
```

---

### POST `/deposit/quote`

调用 LI.FI Composer 构建存款交易，返回待签名的交易数据，**不执行上链**。

**Request Body：**

```json
{
  "fromChainId": 42161,
  "fromToken": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "fromAmount": "1000000",
  "vaultChainId": 42161,
  "vaultAddress": "0x...",
  "userWallet": "0x..."
}
```

| 字段 | 说明 |
|------|------|
| `fromChainId` | 资金所在链 ID |
| `fromToken` | 输入代币地址（用户持有的代币） |
| `fromAmount` | 数量（需按代币 decimals 换算，USDC=6，ETH=18） |
| `vaultChainId` | Vault 所在链 ID（可跨链） |
| `vaultAddress` | 目标 Vault 地址（即 Composer 的 `toToken`） |
| `userWallet` | 用户钱包地址 |

**Response：**

```json
{
  "transactionRequest": {
    "to": "0x...",
    "data": "0x...",
    "value": "0",
    "gasLimit": "300000",
    "chainId": 42161
  },
  "estimate": {
    "fromAmount": "1000000",
    "toAmount": "999800",
    "executionDuration": 30,
    "feeCosts": []
  }
}
```

用户拿到 `transactionRequest` 后通过 wagmi / ethers.js 签名并广播。

---

## OpenAPI Skill

`api/openapi.yaml` 是本项目的核心产品，符合 OpenAPI 3.0 规范，任意框架可直接读取：

```yaml
openapi: "3.0.0"
info:
  title: DeFi Yield Hub API
  description: >
    封装 LI.FI Earn API 的 DeFi 收益工具集。
    支持 Vault 发现、持仓查询、存款交易构建。
    可作为 Agent Skill 供 Claude、OpenClaw、LangChain 等框架直接调用。
  version: "1.0.0"
servers:
  - url: https://your-api-domain.com
paths:
  /vaults:
    get:
      operationId: getVaults
      summary: 查询收益 Vault 列表
      description: 返回可用的 DeFi 收益 Vault，支持按链、代币、协议、APY、TVL 过滤和排序
      parameters:
        - name: chainId
          in: query
          schema: { type: integer }
        - name: asset
          in: query
          schema: { type: string }
        # ... 其余参数
  /portfolio/{wallet}:
    get:
      operationId: getPortfolio
      summary: 查询钱包持仓
  /deposit/quote:
    post:
      operationId: createDepositQuote
      summary: 构建存款交易
      description: 调用 LI.FI Composer 生成待签名的存款交易，支持跨链
```

各框架接入方式：

| 框架 | 接入方式 |
|------|----------|
| Claude (tool use) | 从 OpenAPI 转换为 tool JSON schema |
| OpenClaw | 直接读取 `openapi.yaml` URL |
| LangChain | `JsonSpec` + `OpenAPIChain` |
| AutoGPT | Plugin manifest 引用 `openapi.yaml` |
| MCP | 包装为 MCP server（`@modelcontextprotocol/sdk`） |

---

## 前端页面

前端调用同一套后端 API，作为 Demo 展示 API 能力，不内嵌 Agent 对话框。

### Vault 列表页（`/`）

- 筛选栏：链、协议、代币、最低 APY
- 排序：APY（1d / 7d / 30d）、TVL
- 表格列：协议、Vault 名称、链、资产、APY、TVL、操作（存款）
- 存款弹窗：连接钱包 → 输入金额 → 获取报价 → 签名

### 持仓页（`/portfolio`）

- 连接钱包（wagmi）→ 自动加载持仓；或手动输入钱包地址
- 卡片网格布局（`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`），与首页 Vault 列表风格一致
- 每张持仓卡展示：协议徽标、链名、Vault 名称、底层代币、当前 APY、TVL、持仓金额（USD）
- 持仓面板（绿色）：余额 / 日收益 / 月收益 / 可赎回状态 → 快捷存款、赎回按钮
- 更优选择面板（黄色，APY 高出 > 0.5% 时出现）：展示目标 Vault APY、收益对比、年化多赚估算
  - **详情按钮**：打开 `VaultDetailModal`，完整展示 APY 历史图、与当前持仓对比
  - **迁移按钮**：打开 `MigrateModal`，执行两步迁移（赎回 → 存款）
- 持仓 → Vault 协议名模糊匹配（`protocolName` slug 化后做包含检查）

---

## 技术栈

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 20+ | 运行时 |
| TypeScript | 5.x | 类型安全 |
| Hono | latest | Web 框架，轻量，天然支持 OpenAPI |
| `node-cache` | latest | 内存缓存（Vault 数据 TTL 60s）|

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 14 | React 框架 |
| TailwindCSS | 3.x | 样式 |
| wagmi | 2.x | 钱包连接与交易签名 |
| viem | 2.x | EVM 交互 |
| TanStack Query | 5.x | 数据请求与缓存 |

---

## LI.FI API 参考

### 两个独立服务

| 服务 | Base URL | 认证 | 用途 |
|------|----------|------|------|
| Earn Data API | `https://earn.li.fi` | **不需要** | Vault 查询、持仓查询 |
| Composer | `https://li.quest` | **需要 API Key** | 构建存款交易 |

API Key 申请：[https://portal.li.fi/](https://portal.li.fi/)

### Earn Data API 端点

```
GET https://earn.li.fi/v1/earn/vaults
GET https://earn.li.fi/v1/earn/vaults/:chainId/:address
GET https://earn.li.fi/v1/earn/portfolio/:userAddress/positions
GET https://earn.li.fi/v1/earn/chains
GET https://earn.li.fi/v1/earn/protocols
```

速率限制：100 请求/分钟

### Composer 端点

```
GET https://li.quest/v1/quote?fromChain=...&toChain=...&fromToken=...&toToken=...&fromAddress=...&toAddress=...&fromAmount=...
```

注意：Composer 是 **GET 请求**，参数通过 query string 传递，不是 POST。

请求头：`x-lifi-api-key: YOUR_API_KEY`

### 最小可用代码示例

```typescript
// 1. 查询 Vault（免认证）
const vaults = await fetch(
  'https://earn.li.fi/v1/earn/vaults?chainId=8453&sortBy=apy'
).then(r => r.json());

const vault = vaults.vaults[0];

// 2. 构建存款报价（需 API Key）
const params = new URLSearchParams({
  fromChain: '8453',
  toChain: '8453',
  fromToken: vault.underlyingTokens[0].address,
  toToken: vault.address,          // ← 注意：是 vault 地址，不是 token 地址
  fromAddress: userWallet,
  toAddress: userWallet,
  fromAmount: '1000000'            // USDC 6 位精度，即 1 USDC
});

const quote = await fetch(
  `https://li.quest/v1/quote?${params}`,
  { headers: { 'x-lifi-api-key': process.env.LIFI_API_KEY } }
).then(r => r.json());

// 3. 用户签名并广播（前端用 wagmi）
// quote.transactionRequest → sendTransaction

// 4. 验证持仓（免认证）
const positions = await fetch(
  `https://earn.li.fi/v1/earn/portfolio/${userWallet}/positions`
).then(r => r.json());
```

---

## 前端组件说明

### 新增组件（Portfolio 优化后）

| 组件 | 文件 | 说明 |
|------|------|------|
| `VaultDetailModal` | `web/components/VaultDetailModal.tsx` | Vault 详情弹窗，展示 APY 历史折线、协议信息、与持仓对比、操作按钮 |
| `MigrateModal` | `web/components/MigrateModal.tsx` | 两步迁移弹窗：Step 1 赎回当前 Vault LP 份额，Step 2 存入目标 Vault |

### 修改组件

| 组件 | 文件 | 改动 |
|------|------|------|
| `DepositModal` | `web/components/DepositModal.tsx` | 授权状态改为本地 `approved` boolean，避免链上确认后 allowance 刷新延迟导致按钮卡住 |

### 注意事项（前端）

**SSR 水合错误**：`useAccount()` 服务端返回 `undefined`，客户端有钱包地址，React 报 hydration mismatch。
修复方法：`const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])` 然后所有依赖钱包状态的 JSX 包在 `{mounted && (...)}` 中。

**授权按钮状态刷新**：`useWaitForTransactionReceipt` 确认后调 `refetchAllowance()`，但 `useReadContract` 的 `enabled` 还未更新（React 批量渲染），导致 refetch 实际上没执行。
修复方法：引入 `const [approved, setApproved] = useState(false)`，在 `approveConfirmed` effect 中直接 `setApproved(true)`，不再依赖链上 allowance 刷新。
同样的模式同时应用在 `DepositModal` 和 `MigrateModal`（`redeemApproved` / `depositApproved`）。

**持仓 → Vault 协议名匹配**：Portfolio API 返回的 `protocolName`（如 `"Aave V3"`）与 Vault API 的 `protocol.name`（如 `"aave-v3"`）格式不一致。
匹配逻辑：`slug = s.toLowerCase().replace(/[^a-z0-9]/g, '')` 然后判断两者互相包含。

**更优 Vault 查询**：按持仓中每个唯一 `(chainId, symbol)` 组合发一次 `GET /vaults?sortBy=apy` 请求，返回同链同资产 APY 最高的列表，取第一个 APY 高出 > 0.5% 且非当前持仓的 Vault 作为推荐。

---

## 关键注意事项

从官方 guide 整理的常见错误：

| 问题 | 正确做法 |
|------|----------|
| Earn Data API 加了认证头 | 不需要，直接请求 |
| Composer 用了 POST | 必须用 GET + query params |
| `toToken` 用了底层代币地址 | 必须用 vault 的 `.address` |
| APY / TVL 字段直接用于计算 | `apy7d`、`reward` 可能为 null；`tvl.usd` 是字符串不是数字 |
| 精度问题 | USDC=6位，ETH=18位，根据 `decimals` 字段换算 |
| 只取第一页数据 | 总共 672+ 个 vault，需用 `nextCursor` 分页 |
| 报价过时 | 获取 quote 后尽快签名广播，不要缓存 |

---

## 参赛资源

### 黑客松

| 资源 | 链接 |
|------|------|
| 黑客松主页 | [lifi.notion.site/defi-mullet-hackathon-1-builder-edition](https://lifi.notion.site/defi-mullet-hackathon-1-builder-edition) |
| 官方 Guide（完整技术文档） | [github.com/brucexu-eth/defi-mullet-hackathon/blob/main/guide.md](https://raw.githubusercontent.com/brucexu-eth/defi-mullet-hackathon/refs/heads/main/guide.md) |
| 注册表单 | [forms.gle/RFLGG8RiEKC3AqnQA](https://forms.gle/RFLGG8RiEKC3AqnQA) |
| 提交表单 | [forms.gle/1PCvD9BymH1EyRmV8](https://forms.gle/1PCvD9BymH1EyRmV8) |
| Telegram 社区 | [t.me/lifibuilders](https://t.me/lifibuilders) |
| 微信社区 | 添加 brucexu-eth，回复 "DeFi Mullet" |

### LI.FI 文档

| 资源 | 链接 |
|------|------|
| Earn API 概览 | [docs.li.fi/earn/overview](https://docs.li.fi/earn/overview) |
| Earn API Quickstart | [docs.li.fi/earn/quickstart](https://docs.li.fi/earn/quickstart) |
| API Key 申请（Partner Portal） | [portal.li.fi](https://portal.li.fi/) |
| 官方文档首页 | [docs.li.fi](https://docs.li.fi) |

### 评分标准

| 维度 | 权重 |
|------|------|
| API 集成度（覆盖端点数量与深度） | **35%** |
| 创新性 | 25% |
| 产品完整度 | 20% |
| 展示质量（推文/Demo 视频） | 20% |

### 奖励结构

| 奖项 | 金额 |
|------|------|
| 🏆 Grand Prize（整体最佳） | $1,000 USDC |
| 🥇 各赛道第一（×5） | $400 USDC 每个 |
| 🥈 各赛道第二（×5） | $200 USDC 每个 |
| 🥉 各赛道第三（×5） | $100 USDC 每个 |
| 🌟 最佳发布内容 | $200 USDC |
| **合计** | **$5,000 USDC** |

### 提交要求（4月14日）

1. **可运行的项目**：部署的 Web 应用或真实执行的录屏 Demo
2. **X（Twitter）推文**：在提交窗口内发布（APAC：北京时间 4月14日 09:00-12:00）
   - 必须包含：项目名 + 功能描述 + Demo 视频 + 仓库/应用链接 + 参赛赛道
   - 必须 Tag：`@lifiprotocol` + `@brucexu_eth`（中文）
3. **简短说明**：项目功能、如何使用 Earn API、后续计划、API 使用体验反馈
4. **填写 Google Form**：[forms.gle/1PCvD9BymH1EyRmV8](https://forms.gle/1PCvD9BymH1EyRmV8)
