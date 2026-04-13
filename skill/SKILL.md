# DeFi Yield Hub — Agent Skill 接入指南

本文件是为 **Agent 框架开发者** 准备的完整接入文档。  
适用于 Claude API、LangChain、AutoGen、Dify、Coze 等任何支持 Function Calling 或 OpenAPI 的框架。

---

## 目录

- [架构说明（重要）](#架构说明重要)
- [快速开始](#快速开始)
- [工具定义参考](#工具定义参考)
- [定时盯盘 & 自动迁移](#定时盯盘--自动迁移)
- [框架接入方式](#框架接入方式)
  - [方式 A：直接使用 Skill 文件（推荐）](#方式-a直接使用-skill-文件推荐)
  - [方式 B：自行集成 OpenAPI Spec](#方式-b自行集成-openapi-spec)
  - [方式 C：LangChain OpenAPIChain](#方式-c-langchain-openapichain)
- [完整对话示例](#完整对话示例)
- [fromAmount 精度换算](#fromamount-精度换算)
- [安全须知](#安全须知)
- [常见问题](#常见问题)

---

## 架构说明（重要）

本 Skill 采用**本地签名**架构（方案 B）：

```
Agent 框架（本地运行）
    │
    ├─ GET  /vaults          → 查询 Vault 列表
    ├─ POST /search/parse    → AI 自然语言搜索
    ├─ GET  /portfolio/:wallet → 查询持仓
    ├─ POST /deposit/quote   → 获取未签名存款交易 ←─┐
    └─ POST /redeem/quote    → 获取未签名赎回交易 ←─┘
              │                                    │
              │  API 只返回 transactionRequest       │
              │  私钥从不经过 API                    │
              ▼                                    │
    Skill 文件在本地（viem）                          │
      ├─ 读取私钥（仅本地 .env）                      │
      ├─ 检查 ERC-20 allowance  ──────────────────── RPC
      ├─ 发送 approve（如需）    ──────────────────── RPC
      └─ 签名并广播交易          ──────────────────── RPC
```

**关键点**：私钥存在本地 `.env`，只被 viem 在本机读取，不发送给后端 API，也不发送给 Claude API。

---

## 快速开始

### 前置条件

- Node.js 20+
- 已启动后端服务（`cd ../api && npm run dev`，运行在 `localhost:3000`）
- 一个专用测试钱包的私钥（**不要用主钱包**）
- Anthropic API Key

### 安装

```bash
cd skill
npm install
cp .env.example .env
```

编辑 `.env`：

```env
AGENT_PRIVATE_KEY=0x你的私钥
ANTHROPIC_API_KEY=sk-ant-...
DEFI_API_URL=http://localhost:3000   # 可选，默认值
```

### 运行

```bash
# 查询类（只读，不发交易）
npm run dev "帮我找 USDC 收益最高的 vault"
npm run dev "Arbitrum 上有哪些 ETH vault APY 超过 5%"
npm run dev "查询钱包 0x... 的持仓"

# 执行类（会发链上交易，消耗 gas）
npm run dev "把 1 USDC 存入 Arbitrum 上 APY 最高的 vault"
npm run dev "赎回我在 Base 上的全部 USDC 持仓"
npm run dev "扫描我的持仓，看有没有更高收益的 vault 可以迁移"

# 盯盘模式（cron 命令）
npm run dev cron                       # 扫描机会，仅打印，不执行交易
npm run dev cron --auto-migrate        # 扫描 + 自动迁移
npm run dev cron --min-apy=3           # APY 提升门槛 3%（默认 2%）
npm run dev cron --min-tvl=5000000     # TVL 门槛 $5M（默认 $1M）
```

---

## 工具定义参考

Skill 文件暴露 **8 个工具**，可直接用于 Claude `tools` 参数，或转换为其他框架格式。

### `get_vaults`

查询 DeFi 收益 Vault 列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `asset` | string | 否 | 代币符号，如 `USDC`、`ETH`、`WBTC` |
| `chainId` | integer | 否 | 链 ID（见下表） |
| `protocol` | string | 否 | 协议名，如 `morpho-v1`、`aave-v3` |
| `minApy` | number | 否 | 最低 APY（百分比） |
| `sortBy` | string | 否 | `apy`（默认）或 `tvl` |
| `limit` | integer | 否 | 返回数量，最大 100 |

**支持的链 ID：**

| 链 | chainId |
|----|---------|
| Ethereum | 1 |
| Arbitrum | 42161 |
| Base | 8453 |
| Optimism | 10 |
| Polygon | 137 |
| BSC | 56 |

---

### `ai_search`

用自然语言搜索最优 Vault，内部调用 GLM-4-Flash 解析意图并推荐（最多 5 个）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | ✅ | 自然语言，如 `"USDC 收益最高的"` |

---

### `get_portfolio`

查询钱包在所有支持协议的持仓。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `wallet` | string | ✅ | EVM 钱包地址（`0x...`） |

---

### `get_agent_wallet`

查询当前 Skill 使用的钱包地址（派生自 `AGENT_PRIVATE_KEY`）。  
执行存款前建议先调用，让模型知道要操作哪个地址。

无参数。

---

### `execute_deposit`

全自动存款：获取报价 → ERC-20 授权（按需）→ 本地签名 → 广播。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fromChainId` | integer | ✅ | 资金来源链 ID |
| `fromToken` | string | ✅ | 来源代币地址（native token 用 `0x0000000000000000000000000000000000000000`） |
| `fromAmount` | string | ✅ | 数量（已按 decimals 换算的整数字符串，见[精度说明](#fromamount-精度换算)） |
| `vaultChainId` | integer | ✅ | Vault 所在链 ID |
| `vaultAddress` | string | ✅ | Vault 合约地址（来自 `get_vaults` 的 `address` 字段） |
| `fromTokenDecimals` | integer | 否 | 来源代币精度（用于日志，不影响执行） |

**返回：**
```json
{
  "txHash": "0x...",
  "status": "success",
  "agentWallet": "0x...",
  "estimate": { "fromAmount": "...", "toAmount": "...", "executionDuration": 30 }
}
```

---

### `execute_redeem`

全自动赎回：获取报价 → 份额授权（按需）→ 本地签名 → 广播。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `vaultChainId` | integer | ✅ | Vault 所在链 ID |
| `vaultAddress` | string | ✅ | Vault 合约地址（持有的 ERC-4626 份额） |
| `toToken` | string | ✅ | 赎回后想收到的底层代币地址 |
| `fromAmount` | string | ✅ | 赎回份额数量（通常 18 位 decimals） |

---

### `scan_migration_opportunities`

扫描钱包持仓，在同链同资产中寻找 APY 更高、TVL 更大的迁移机会。**纯查询，不执行任何交易。**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `walletAddress` | string | 否 | 要扫描的钱包地址，不填则用 `AGENT_PRIVATE_KEY` 派生地址 |
| `minApyImprovement` | number | 否 | 最低 APY 提升幅度（%），默认 `2` |
| `minTvlUsd` | number | 否 | 目标 vault 最低 TVL（USD），默认 `1000000`（$1M） |

**返回示例：**
```json
{
  "opportunities": [
    {
      "chainId": 42161,
      "chainName": "Arbitrum",
      "currentVaultName": "Aave USDC",
      "currentApy": 4.5,
      "currentBalanceUsd": 1200.0,
      "currentSharesAmount": "1198500000000000000000",
      "targetVaultName": "Morpho USDC Vault",
      "targetApy": 8.2,
      "targetTvlUsd": 45000000,
      "apyImprovement": 3.7,
      "estimatedExtraAnnualYieldUsd": 44.4,
      "underlyingToken": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "underlyingTokenSymbol": "USDC",
      "underlyingTokenDecimals": 6
    }
  ],
  "totalPositions": 3,
  "migratable": 1,
  "message": "发现 1 个迁移机会，每年可多赚约 $44.40"
}
```

---

### `execute_migration`

原子化执行同链 vault 迁移：赎回旧 vault → 链上读取实际余额 → 存入新 vault。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fromVaultChainId` | integer | ✅ | 迁出 vault 所在链 ID |
| `fromVaultAddress` | string | ✅ | 旧 vault 合约地址 |
| `fromSharesAmount` | string | ✅ | 赎回份额数量（来自 `scan_migration_opportunities` 的 `currentSharesAmount`） |
| `toVaultAddress` | string | ✅ | 目标 vault 合约地址（来自 `targetVaultAddress`） |
| `underlyingTokenAddress` | string | ✅ | 底层代币地址（来自 `underlyingToken`） |
| `underlyingTokenDecimals` | integer | 否 | 底层代币精度，默认 18 |
| `reason` | string | 否 | 迁移原因，用于日志记录 |

**返回示例：**
```json
{
  "success": true,
  "redeemTxHash": "0xabc...",
  "depositTxHash": "0xdef...",
  "transferredAmount": "1198450000",
  "reason": "APY +3.70%，预计年增收 $44.40"
}
```

⚠️ **仅支持同链迁移**。跨链迁移请分别调用 `execute_redeem` + `execute_deposit`。

---

## 定时盯盘 & 自动迁移

### 工作原理

```
定时触发（cron）
    │
    ▼
scan_migration_opportunities
    ├─ 拉取当前持仓（/portfolio/:wallet）
    ├─ 查询同链同资产 vault（/vaults?chainId=&asset=&sortBy=apy）
    └─ 按「APY 提升 × 持仓金额」排序机会列表
              │
              │ 发现机会？
              ▼
    autoMigrate = true？
    ├─ YES → execute_migration（赎回 → 存入新 vault）
    └─ NO  → 打印机会 / 调用 onOpportunity 回调通知
```

### 方式一：CLI 单次运行（适合系统 cron / GitHub Actions）

```bash
# 每小时执行一次（系统 crontab）
0 * * * * cd /path/to/skill && npm run dev cron --auto-migrate >> /var/log/defi-monitor.log 2>&1

# GitHub Actions（每 6 小时）
# .github/workflows/monitor.yml
on:
  schedule:
    - cron: '0 */6 * * *'
jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd skill && npm ci && npm run dev cron --auto-migrate
        env:
          AGENT_PRIVATE_KEY: ${{ secrets.AGENT_PRIVATE_KEY }}
          DEFI_API_URL: ${{ secrets.DEFI_API_URL }}
```

### 方式二：node-cron 内嵌调度

```typescript
import cron from 'node-cron'                    // npm install node-cron @types/node-cron
import { runMonitorCron } from './defi-yield-hub.skill.js'

// 每小时扫描一次，APY 提升 > 3% 且 TVL > $5M 才迁移
cron.schedule('0 * * * *', () =>
  runMonitorCron({
    autoMigrate:      true,
    minApyImprovement: 3,
    minTvlUsd:        5_000_000,
  })
)

// 每 10 分钟扫描，不自动迁移，只发通知
cron.schedule('*/10 * * * *', () =>
  runMonitorCron({
    autoMigrate: false,
    onOpportunity: async (opportunities) => {
      // 发送 Telegram / Discord / 邮件通知
      for (const opp of opportunities) {
        await sendTelegramAlert(
          `📊 迁移机会：${opp.chainName} ${opp.underlyingTokenSymbol}\n` +
          `${opp.currentVaultName} (${opp.currentApy.toFixed(2)}%) → ` +
          `${opp.targetVaultName} (${opp.targetApy.toFixed(2)}%)\n` +
          `预计年增收 +$${opp.estimatedExtraAnnualYieldUsd.toFixed(2)}`
        )
      }
    },
  })
)
```

### 方式三：Claude Agent 主动触发

在 Agent 对话中可以直接要求扫描和迁移：

```
用户：每隔 1 小时帮我检查一次持仓，如果有同链 APY 比现在高 3% 以上、TVL 超过 $5M 的 vault，自动迁移过去

Agent 内部：
  → scan_migration_opportunities({ minApyImprovement: 3, minTvlUsd: 5000000 })
  ← { opportunities: [...], message: "发现 1 个迁移机会..." }

Agent 回复：
  发现迁移机会：
  Arbitrum USDC：Aave (4.5%) → Morpho (8.2%)，APY 提升 3.7%，持仓 $1,200，年增收约 $44
  确认执行迁移？

用户：确认

Agent 内部：
  → execute_migration({ fromVaultChainId: 42161, ..., reason: "APY +3.7%，年增收 $44" })
  ← { redeemTxHash: "0x...", depositTxHash: "0x...", success: true }
```

### 推荐参数配置

| 场景 | minApyImprovement | minTvlUsd | autoMigrate |
|------|------------------|-----------|-------------|
| 保守策略 | 5% | $10M | false（人工确认） |
| 均衡策略 | 3% | $5M | true |
| 积极策略 | 2% | $1M | true |
| 仅通知 | 1% | $500K | false |

---

## 框架接入方式

### 方式 A：直接使用 Skill 文件（推荐）

适合：TypeScript/Node.js 项目，或直接用 Claude API。

```typescript
import { runDeFiAgent, DEFI_TOOLS } from './defi-yield-hub.skill.js'

// 方式 A1：内置 Agent 循环，一句话触发完整流程
const result = await runDeFiAgent('把 1 USDC 存入 Arbitrum APY 最高的 vault')
console.log(result)

// 方式 A2：把工具注入自己的 Agent 系统
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()

const response = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  tools: DEFI_TOOLS,    // ← 直接复用 Skill 的工具定义
  messages: [{ role: 'user', content: '查询 ETH 收益最高的 vault' }],
})
```

---

### 方式 B：自行集成 OpenAPI Spec

适合：支持直接读取 OpenAPI URL 的框架（OpenClaw、Dify、Coze 等）。

**OpenAPI Spec URL：** `http://localhost:3000/openapi.json`

⚠️ 注意：OpenAPI 方式只能调用**查询类端点**（`/vaults`、`/portfolio`、`/search/parse`），  
`execute_deposit` / `execute_redeem` 需要在本地运行 Skill 文件才能完成签名。

---

### 方式 C：LangChain OpenAPIChain

适合：Python + LangChain 项目。

```python
from langchain.chains import OpenAPIEndpointChain
from langchain_anthropic import ChatAnthropic
from langchain_community.agent_toolkits.openapi.spec import reduce_openapi_spec
import requests, json
from viem import Account   # pip install viem (如有)

# 加载 OpenAPI spec
spec_raw = requests.get("http://localhost:3000/openapi.json").json()
spec = reduce_openapi_spec(spec_raw)

llm = ChatAnthropic(model="claude-opus-4-6")

# 查询工具（只读，不需要私钥）
from langchain.tools import tool

@tool
def get_vaults(asset: str = None, chain_id: int = None,
               min_apy: float = None, sort_by: str = "apy", limit: int = 10) -> dict:
    """查询 DeFi 收益 Vault 列表，支持按代币、链、APY 筛选"""
    params = {k: v for k, v in {
        "asset": asset, "chainId": chain_id,
        "minApy": min_apy, "sortBy": sort_by, "limit": limit
    }.items() if v is not None}
    return requests.get("http://localhost:3000/vaults", params=params).json()

@tool
def ai_search(query: str) -> dict:
    """用自然语言搜索 DeFi 金库"""
    return requests.post(
        "http://localhost:3000/search/parse",
        json={"query": query}
    ).json()

@tool
def get_portfolio(wallet: str) -> dict:
    """查询钱包持仓"""
    return requests.get(f"http://localhost:3000/portfolio/{wallet}").json()

# 执行工具（需要 viem 本地签名）
@tool
def execute_deposit(from_chain_id: int, from_token: str, from_amount: str,
                    vault_chain_id: int, vault_address: str) -> dict:
    """
    执行 DeFi 存款：获取报价 + 本地签名 + 广播。
    from_amount 需已按 decimals 换算（USDC 6位：1 USDC = '1000000'）
    """
    import os
    from eth_account import Account
    from web3 import Web3

    private_key = os.environ["AGENT_PRIVATE_KEY"]
    wallet = Account.from_key(private_key).address

    # 1. 获取报价
    quote = requests.post("http://localhost:3000/deposit/quote", json={
        "fromChainId": from_chain_id, "fromToken": from_token,
        "fromAmount": from_amount, "vaultChainId": vault_chain_id,
        "vaultAddress": vault_address, "userWallet": wallet
    }).json()
    tx = quote["transactionRequest"]

    # 2. ERC-20 授权（略，参考 execute_deposit 在 skill.ts 中的实现）

    # 3. 签名广播
    rpc_urls = {42161: "https://arb1.arbitrum.io/rpc", 8453: "https://mainnet.base.org"}
    w3 = Web3(Web3.HTTPProvider(rpc_urls[from_chain_id]))
    nonce = w3.eth.get_transaction_count(wallet)
    signed = w3.eth.account.sign_transaction({
        "to": tx["to"], "data": tx["data"],
        "value": int(tx.get("value", "0x0"), 16),
        "gas": int(tx["gasLimit"], 16) if tx.get("gasLimit") else 300000,
        "gasPrice": w3.eth.gas_price, "nonce": nonce, "chainId": from_chain_id
    }, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return {"txHash": tx_hash.hex(), "status": receipt.status}
```

---

## 完整对话示例

以下展示 Claude Agent 调用 Skill 的完整流程。

### 示例 1：查询最优收益

```
用户：帮我找 Arbitrum 上 USDC APY 超过 5% 的 vault

Agent 内部：
  → ai_search({ query: "Arbitrum 上 USDC APY 超过 5%" })
  ← [{ name: "Morpho USDC", apy: 12.5, address: "0x...", chainId: 42161 }, ...]

Agent 回复：
  找到 3 个符合条件的 vault：
  🥇 Morpho USDC Vault — APY 12.5%，TVL $45M
  🥈 Aave USDC — APY 8.2%，TVL $120M
  🥉 Euler USDC — APY 6.1%，TVL $23M
```

### 示例 2：执行存款

```
用户：把 1 USDC 存入 Arbitrum 上 APY 最高的 vault

Agent 内部：
  → get_agent_wallet()
  ← { address: "0xAgentWallet..." }

  → get_vaults({ asset: "USDC", chainId: 42161, sortBy: "apy", limit: 1 })
  ← [{ address: "0xMorpho...", name: "Morpho USDC", apy: 12.5 }]

Agent 回复（确认）：
  将从钱包 0xAgent... 向 Arbitrum 上的 Morpho USDC Vault（APY 12.5%）
  存入 1 USDC（1,000,000 raw）。确认执行？

用户：确认

Agent 内部：
  → execute_deposit({
      fromChainId: 42161,
      fromToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // Arbitrum USDC
      fromAmount: "1000000",
      fromTokenDecimals: 6,
      vaultChainId: 42161,
      vaultAddress: "0xMorpho..."
    })
  [本地] 检查 allowance → 不足 → 发送 approve 交易 → 等待确认
  [本地] 签名存款交易 → 广播 → 等待确认
  ← { txHash: "0xabc...", status: "success" }

Agent 回复：
  ✅ 存款成功！
  交易哈希：0xabc...
  可在 Arbiscan 查看：https://arbiscan.io/tx/0xabc...
```

### 示例 3：跨链存款

```
用户：我在以太坊主网有 100 USDC，存到 Base 上 APY 最高的 vault

Agent 内部：
  → get_vaults({ asset: "USDC", chainId: 8453, sortBy: "apy", limit: 1 })
  ← [{ address: "0xBaseVault...", apy: 9.8 }]

  → execute_deposit({
      fromChainId: 1,           // 来自 Ethereum
      fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  // Mainnet USDC
      fromAmount: "100000000",  // 100 USDC × 10^6
      vaultChainId: 8453,       // 目标 Base
      vaultAddress: "0xBaseVault..."
    })
  // LI.FI Composer 自动处理跨链 bridge，单笔交易完成
```

---

## fromAmount 精度换算

**规则：** `fromAmount = 数量 × 10^decimals`，结果取整，转为字符串。

| 代币 | decimals | 1 单位 = | 示例 |
|------|----------|---------|------|
| USDC | 6 | `"1000000"` | 5 USDC → `"5000000"` |
| USDT | 6 | `"1000000"` | 10 USDT → `"10000000"` |
| ETH / WETH | 18 | `"1000000000000000000"` | 0.1 ETH → `"100000000000000000"` |
| WBTC | 8 | `"100000000"` | 0.5 WBTC → `"50000000"` |
| DAI | 18 | `"1000000000000000000"` | 100 DAI → `"100000000000000000000"` |

**TypeScript 换算：**
```typescript
import { parseUnits } from 'viem'
const amount = parseUnits('1', 6).toString()   // USDC: "1000000"
const amount = parseUnits('0.1', 18).toString() // ETH: "100000000000000000"
```

**Python 换算：**
```python
from web3 import Web3
amount = str(Web3.to_wei(1, 'mwei'))    # USDC 6位: "1000000"
amount = str(Web3.to_wei(0.1, 'ether')) # ETH 18位: "100000000000000000"
```

---

## 安全须知

| 事项 | 说明 |
|------|------|
| **私钥不离本机** | `AGENT_PRIVATE_KEY` 只存在本地 `.env`，viem 在本机签名，不发送给 API 或 Claude |
| **使用专用钱包** | 建议创建一个专用的测试/Agent 钱包，不要使用主钱包或存有大量资金的钱包 |
| **不要提交 .env** | `.gitignore` 已包含 `.env`，请确认不将私钥提交到 git |
| **最小余额原则** | 钱包只存入执行任务所需的代币和少量 gas，其余资金放其他地方 |
| **API 无需私钥** | 后端 API 完全不需要也不应存储私钥，如果有人要求提供私钥请拒绝 |
| **确认再执行** | 内置 System Prompt 要求模型在执行链上操作前向用户确认，建议保留此逻辑 |

---

## 常见问题

**Q：Composer 返回 422 / code 1001 "No routes available"**  
A：常见原因：流动性不足、fromToken/vaultAddress 组合不支持、fromAmount 过小（< 最低限额）。  
尝试：换更大金额、换 fromToken（如 ETH 换 USDC）、换流动性更好的 vault。

**Q：approve 交易失败**  
A：检查 Agent 钱包是否有足够的 native token 支付 gas，以及 fromToken 地址是否正确。

**Q：`status: "reverted"` — 交易已上链但回滚了**  
A：通常是 approve 未确认就发了存款交易，或者 vault 暂停存款。Skill 文件已加入 `waitForTransactionReceipt` 等待 approve 确认，请确保使用最新版本。

**Q：赎回时 `fromAmount` 填多少？**  
A：需要填 vault 份额数量（ERC-4626 份额，decimals 通常为 18）。  
可通过 `GET /portfolio/:wallet` 查询 `balanceNative` 字段获取当前持有的份额数量。

**Q：跨链存款需要多长时间？**  
A：LI.FI Composer 自动选路，通常 30 秒～5 分钟，视目标链和流动性而定。  
`/deposit/quote` 响应的 `estimate.executionDuration` 字段给出预计时间（秒）。

**Q：如何在不执行交易的情况下测试查询功能？**  
A：只调用 `get_vaults`、`ai_search`、`get_portfolio` 这三个工具，不调用 `execute_deposit` / `execute_redeem`，不会发生任何链上操作。
