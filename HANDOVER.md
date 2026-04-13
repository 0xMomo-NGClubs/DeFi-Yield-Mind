# DeFi Yield Hub — 项目交接文档

> 作者：Claude（AI）  
> 日期：2026-04-13  
> 用途：供 Anjit 快速了解项目现状，接手继续开发

---

## 一、项目概述

**DeFi Yield Hub** 是为 LI.FI DeFi Mullet Hackathon 开发的 DeFi 收益聚合平台。核心能力：

- 聚合展示多链 DeFi Vault，排行/筛选/搜索
- AI 自然语言搜索（GLM-4-Flash，智谱 BigModel 免费模型）
- 一键存款 / 赎回（跨链、跨代币均支持，由 LI.FI Composer 处理 Swap + Bridge）
- 钱包持仓展示、盈利计算
- APY 历史快照（SQLite，每小时自动采集）

---

## 二、项目结构

```
/Users/linjuchen/Code/LIFI/
├── api/                    # Hono 后端（Node.js）
│   ├── src/
│   │   ├── index.ts        # 入口，注册所有路由
│   │   ├── routes/
│   │   │   ├── vaults.ts   # GET /vaults、GET /vaults/:chainId/:address
│   │   │   ├── deposit.ts  # POST /deposit/quote
│   │   │   ├── redeem.ts   # POST /redeem/quote
│   │   │   ├── search.ts   # POST /search/parse（AI 搜索）
│   │   │   ├── portfolio.ts # GET /portfolio/:wallet
│   │   │   ├── history.ts  # GET /history/:chainId/:address
│   │   │   ├── chains.ts   # GET /chains
│   │   │   └── protocols.ts # GET /protocols
│   │   └── services/
│   │       ├── earn.ts     # 封装 LI.FI Earn API 调用
│   │       ├── composer.ts # 封装 LI.FI Composer API（存款/赎回报价）
│   │       ├── db.ts       # SQLite 初始化（better-sqlite3）
│   │       └── snapshot.ts # APY 快照定时任务
│   ├── data/
│   │   └── snapshots.db    # SQLite 数据库文件（自动生成）
│   ├── openapi.yaml        # API 文档定义
│   ├── .env                # 环境变量（见下方说明）
│   └── package.json
│
└── web/                    # Next.js 16 前端（App Router）
    ├── app/
    │   ├── page.tsx         # 首页：Vault 列表 + AI 搜索
    │   ├── compare/page.tsx # 跨链 APY 对比页
    │   ├── portfolio/page.tsx # 持仓 vs 最优机会对比
    │   └── docs/page.tsx    # API 文档页（Scalar UI iframe）
    ├── components/
    │   ├── NavBar.tsx        # 顶部导航（含钱包连接）
    │   ├── VaultCard.tsx     # 普通金库卡片
    │   ├── FeaturedVaultCard.tsx # Top Picks 精选卡片
    │   ├── DepositModal.tsx  # 存款/赎回弹窗（核心交互）
    │   ├── WalletAssets.tsx  # 多链钱包余额扫描组件
    │   ├── tokenList.ts      # 各链常用代币地址常量（共享）
    │   ├── VaultFilter.tsx   # 高级筛选栏
    │   └── ApySparkline.tsx  # APY 迷你折线图
    ├── lib/
    │   ├── api.ts            # 前端 API 客户端 + 类型定义
    │   ├── wagmi.ts          # wagmi 配置（支持7条链）
    │   └── providers.tsx     # React Context 提供者
    └── package.json
```

---

## 三、启动方式

### 后端（`/api`）

```bash
cd api
npm install
npm run dev
# 运行在 http://localhost:3000
```

**注意**：必须使用 `--env-file=.env` 方式加载环境变量（已写入 `package.json` dev 脚本），普通 `tsx` 不会读取 `.env`。

### 前端（`/web`）

```bash
cd web
npm install
npm run dev
# 运行在 http://localhost:3001（或 3000 如果后端未启动）
```

---

## 四、环境变量

### `api/.env`

```env
# LI.FI API Key（用于 Composer 存款/赎回报价，必填）
LIFI_API_KEY=your_lifi_api_key_here

# 智谱 BigModel API Key（AI 搜索，免费模型 GLM-4-Flash，必填）
BIGMODEL_API_KEY=9ad741bfed9344798ba17fe961b7f625.HbLXic2KzYangas1

# 可选：APY 快照间隔（分钟，默认 60）
SNAPSHOT_INTERVAL_MIN=60

# 可选：端口（默认 3000）
PORT=3000
```

### `web/.env.local`（可选）

```env
# 后端地址，默认 http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000

# WalletConnect Project ID（默认用 "demo"，正式环境需申请）
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

---

## 五、关键技术栈

| 层     | 技术                       | 说明                              |
|--------|--------------------------|----------------------------------|
| 后端   | Hono + Node.js + tsx     | 轻量级 Web 框架，类型安全          |
| 数据库 | SQLite（better-sqlite3）  | 存储 APY 历史快照，WAL 模式        |
| 前端   | Next.js 16 App Router    | React Server Components + Client  |
| Web3   | wagmi v2 + viem          | 链交互，支持 Ethereum/Arbitrum/Base/Optimism/Polygon/BSC/Avalanche |
| 状态   | TanStack Query v5        | 数据缓存、无限滚动、乐观更新       |
| AI     | GLM-4-Flash（BigModel）  | OpenAI 兼容接口，免费模型         |
| 样式   | Tailwind CSS v4          |                                  |

---

## 六、核心数据流

### LI.FI API 说明

| API              | Base URL              | 用途                    |
|------------------|-----------------------|------------------------|
| Earn API         | `https://earn.li.fi`  | 查 Vault 列表、持仓、历史 |
| Composer API     | `https://li.quest`    | 存款/赎回报价            |

#### Composer 存款关键参数（容易搞错！）

```
GET https://li.quest/v1/quote
  fromChain = 用户当前链
  toChain   = vault 所在链
  fromToken = 用户持有的代币地址
  toToken   = vault 合约地址（不是底层 token！）← 这是 Composer 识别为"存款"的关键
  fromAddress = toAddress = 用户钱包地址
```

#### Composer 赎回关键参数（与存款完全对称）

```
GET https://li.quest/v1/quote
  fromChain = vault 所在链
  toChain   = vault 所在链（目前不支持赎回跨链）
  fromToken = vault 合约地址（ERC-4626 份额 token）← 和存款的 toToken 互换
  toToken   = 底层代币地址（如 USDC）
```

---

## 七、DepositModal 交互流程（重点）

```
用户打开存款弹窗
├── 扫描钱包多链资产（WalletAssets 组件，7条链并发查询）
├── 选择来源链 + 来源代币（支持跨链跨代币，LI.FI 自动路由）
├── 输入金额 → 点击「获取存款报价」
│     ↓
│   POST /deposit/quote → LI.FI Composer → 返回 transactionRequest
│     ↓
├── step = 'confirm'，读取链上 allowance
│   ├── 若 allowance < fromAmount（且非 native ETH）：
│   │   ① 点击「授权 USDC」
│   │   ② writeContractAsync(erc20.approve, spender, maxUint256)
│   │   ③ 保存 approveTxHash
│   │   ④ useWaitForTransactionReceipt 等待上链确认（按钮显示「等待链上确认...」）
│   │   ⑤ 确认后 refetchAllowance() → needsApproval 变 false → 显示步骤 2
│   └── 若 allowance 充足（或 native ETH）：直接显示「确认存款」
│         ↓
│   检测链是否匹配 → 不匹配则 switchChainAsync 切链
│         ↓
│   sendTransactionAsync(transactionRequest)
│         ↓
└── step = 'done'，显示 txHash
```

---

## 八、AI 搜索架构（A+B 混合）

**方案 A（上下文注入）**：每次搜索前，把实时 Top50 Vault 数据 + 链列表 + 协议列表注入 System Prompt（缓存 5 分钟）。

**方案 B（Function Calling）**：模型可调用 `search_vaults` 工具，参数为 `{asset, protocol, chainId, sortBy, limit}`，后端实时查询 LI.FI Earn API，结果返回给模型，最多 4 轮。

**返回格式（强制 JSON）**：
```json
{
  "params": { "asset": "USDC", "chainId": 42161, "sortBy": "apy" },
  "recommendations": [{ "chainId": 42161, "address": "0x...", "name": "...", "apy": 12.5, "reason": "..." }],
  "explanation": "找到 3 个 USDC vault...",
  "model": "glm-4-flash-250414"
}
```

**注意**：若模型返回非 JSON，有二次修正请求兜底。

---

## 九、钱包多链余额扫描（WalletAssets）

`components/WalletAssets.tsx` 使用固定数量的 hooks（不在循环里调用 hook，遵守 Rules of Hooks）：

- 7 个 `useBalance` —— 分别查 7 条链的 native 余额
- 1 个 `useReadContracts` —— 批量查所有链所有 ERC-20 余额（约 30+ 个合约调用，合并为一次 multicall）
- 过滤 USD 估值 < $0.1 的资产（使用硬编码粗略价格，仅用于排序/过滤）
- 点击任意资产行 → 自动选择对应的来源链 + 来源代币

代币列表和链配置统一维护在 `components/tokenList.ts`，DepositModal 和 WalletAssets 都从这里导入。

---

## 十、已知问题 & 注意事项

### 1. Hydration 警告（已修复）
NavBar 中 wagmi 的 `isConnected`/`address` 在 SSR 和 CSR 不一致，用 `mounted` state 解决。所有使用 wagmi hook 的 Client Component 若有 SSR 风险，都应加 mounted 检测。

### 2. Composer 422 错误（code 1001）
含义："No routes available"，常见原因：
- 流动性不足
- vault 暂不支持该 fromToken/toToken 组合
- fromAmount 过小（< 最低限额）

已有用户友好提示。若频繁出现，可试试换 fromToken 或增大金额。

### 3. 授权交易确认等待
授权 (`approve`) 交易提交后，**必须等链上确认**再 refetch allowance，否则读到旧值。当前实现用 `useWaitForTransactionReceipt` 监听，确认后自动刷新。

### 4. 赎回份额精度
赎回时的 `fromToken` 是 vault 本身（ERC-4626 份额），精度优先用 `vault.lpTokens[0].decimals`，fallback 18。`balanceNative` 字段（来自 portfolio API）是以底层 token 为单位的，不是份额数量，需注意区分。

### 5. AI 搜索模型
当前使用 `glm-4-flash-250414`（注意：不是 `glm-4-flash`，加了日期后缀）。免费额度有限，若遇到 429 错误，检查 BigModel 控制台配额。

### 6. 跨链存款
LI.FI Composer 支持从任意链存入 vault，但实际路由可能因流动性不足失败（尤其小链 → 小链）。`fromChainId` 可和 `vaultChainId` 不同，已在前端 UI 支持，后端 `buildDepositQuote` 直接透传给 Composer。

### 7. WalletConnect Project ID
当前用 `"demo"` 占位，生产环境需在 [cloud.walletconnect.com](https://cloud.walletconnect.com) 申请正式 Project ID。

---

## 十一、待完善功能（建议 Anjit 跟进）

- [ ] **交易状态追踪**：`sendTransactionAsync` 返回 hash 后，用 `useWaitForTransactionReceipt` 轮询确认，并在 UI 上展示「确认中 → 已完成」状态
- [ ] **赎回跨链**：目前赎回固定同链，Composer 理论上支持赎回后桥接到其他链，未实现
- [ ] **实时代币价格**：WalletAssets 当前用硬编码价格估算 USD，可接入 CoinGecko API 或 LI.FI Token Prices API
- [ ] **Portfolio 页完善**：目前展示逻辑较简单，可参考首页的 `findPosition` 匹配逻辑
- [ ] **移动端适配**：部分组件在小屏有溢出问题，需检查
- [ ] **错误边界**：AI 搜索、存款弹窗需要 React ErrorBoundary 包裹
- [ ] **WalletConnect 正式 ID**：替换占位符
- [ ] **更多代币支持**：`tokenList.ts` 里只列了常见代币，可根据需要扩充

---

## 十二、关键文件速查

| 想改什么 | 找哪个文件 |
|---------|-----------|
| 存款/赎回交互逻辑 | `web/components/DepositModal.tsx` |
| 钱包多链余额扫描 | `web/components/WalletAssets.tsx` |
| 各链代币地址配置 | `web/components/tokenList.ts` |
| AI 搜索后端逻辑 | `api/src/routes/search.ts` |
| Composer 报价封装 | `api/src/services/composer.ts` |
| 前端 API 客户端 + 类型 | `web/lib/api.ts` |
| wagmi 链配置 | `web/lib/wagmi.ts` |
| APY 历史快照 | `api/src/services/snapshot.ts` |
| 顶部导航 | `web/components/NavBar.tsx` |
| 首页（AI搜索+列表） | `web/app/page.tsx` |
| 跨链对比页 | `web/app/compare/page.tsx` |
| API 文档（Scalar） | 访问 `http://localhost:3000/scalar` |

---

## 十三、开发中踩过的坑（避免重复）

1. **`tsx watch` 不读 `.env`**：必须用 `tsx watch --env-file=.env src/index.ts`，否则所有环境变量为 undefined。
2. **GLM 模型名**：正确名称是 `glm-4-flash-250414`，不是 `glm-4-flash`。
3. **Composer `toToken` 是 vault 地址**：不是底层 token 地址，这是存款的关键。反之赎回时 `fromToken` 才是 vault 地址。
4. **hook 不能在循环里调用**：WalletAssets 的多链余额查询必须用固定数量的 hook + 一个 `useReadContracts` 批量，不能在 `.map()` 里 `useBalance`。
5. **授权后立刻 refetch 无效**：`writeContractAsync` 完成 ≠ 链上确认，必须 `useWaitForTransactionReceipt` 等确认后再读 allowance。
6. **ERC-4626 赎回精度**：vault 份额 decimals 未必和底层 token 一致，用 `vault.lpTokens[0].decimals`。
7. **Hydration 错误**：wagmi 的 `isConnected` 在 SSR 始终是 false，用 `mounted` state 在客户端挂载后才渲染钱包相关 UI。
