# DeFi Yield Mind

> ⚠️ **免责声明**：本参赛项目代码以及演示站仅供学习和交流，不要使用大资金操作。

> 多链 DeFi 收益聚合器，AI 驱动的智能选仓与自动迁移平台

**🔗 在线 Demo：[https://dym.0xmomo.com](https://dym.0xmomo.com)**  
**📄 API 文档：[https://dym.0xmomo.com/api/scalar](https://dym.0xmomo.com/api/scalar)**  
**🏆 参赛：[DeFi Mullet Hackathon #1: Builder Edition](https://lifi.notion.site/defi-mullet-hackathon-1-builder-edition)**  
**赛道：AI × Earn ＋ Yield Builder**

---

## 项目简介

**DeFi Yield Mind** 是一个由 AI 驱动的多链 DeFi 收益聚合平台，基于 **LI.FI Earn API** 构建。

用户可以用自然语言搜索全网最优收益机会，通过 LI.FI Composer 一笔完成跨链存款，并借助 Agent Skill 实现 7×24 自动盯盘与策略迁移——让 AI 帮你管理 DeFi 收益，不再需要手动跨协议比价。

```
用户："Arbitrum 上 USDC 收益超 8% 的有哪些？"
         ↓  AI 解析意图
DeFi Yield Mind 返回匹配的 Vault 列表，含 APY 分拆、TVL、推荐理由
         ↓  一键存款
LI.FI Composer 自动寻路，单笔交易完成跨链存款
         ↓  挂机盯盘
Agent Skill 定时扫描，发现更优 Vault 时自动迁移
```

---

## 核心功能

### 🤖 AI 智能搜索
- 自然语言理解：「Base 上 ETH 质押收益最高的」
- GLM-4-Flash 解析意图 + Function Calling，返回推荐结果含 APY 分拆、TVL、推荐理由
- 支持多轮追问：「那 Arbitrum 上的呢？」自动携带上下文

### 🏦 多链 Vault 聚合
- 接入 **300+ 收益金库**，覆盖 Morpho、Aave、Euler、Pendle、Ethena 等 **20+ 头部协议**
- 支持 **21 条 EVM 链**：Ethereum、Arbitrum、Base、Optimism、Polygon 等
- 实时 APY + 7d / 30d 均值、TVL 展示，每小时自动快照更新

### ⚡ 跨链一键存款
- LI.FI Composer 自动寻路，从任意链任意代币直接存入目标 Vault
- ERC-20 授权 + 存款原子化，预估手续费与执行时间
- 私钥全程本地签名，后端只返回未签名交易体，私钥不离开用户设备

### 📊 APY 历史追踪
- 每小时采集各 Vault APY 快照，折线图展示历史波动趋势
- 7d / 30d 均值对比，辅助判断收益稳定性

### 💼 Portfolio 持仓管理
- 连接钱包查看全链持仓，每个 Vault 显示当前余额、日 / 月预期收益
- 自动推荐同链更优 Vault，一键发起迁移操作

### ⚖️ Vault 横向对比
- 最多 4 个 Vault 同屏比较 APY、TVL、协议、底层代币
- APY 历史走势并排展示，辅助做出最优选择

### 🤖 Agent Skill / 自动化
- 提供 **8 个标准工具**，可直接传入 Claude API `tools` 参数
- 支持 Claude API、LangChain、AutoGen 等任意 AI 框架接入
- `runMonitorCron`：定时扫描迁移机会，发现更优 Vault 自动执行迁移

---

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                  DeFi Yield Mind                 │
│                                                  │
│  🖥️ 前端（Next.js）                              │
│   ├── Vault 列表 + AI 自然语言搜索               │
│   ├── APY 历史折线图                             │
│   ├── Portfolio 持仓管理 + 迁移                  │
│   └── Vault 横向对比                             │
│                    ↕ REST API                    │
│  ⚙️ 后端（Hono + Node.js）                       │
│   ├── GLM-4-Flash AI 搜索解析                    │
│   ├── APY 历史快照（SQLite）                     │
│   └── LI.FI Earn / Composer 封装                │
│                                                  │
│  🤖 Agent Skill（本地运行）                      │
│   ├── 8 个标准工具（查询 + 执行 + 分析）         │
│   ├── viem 本地签名，私钥不上传                   │
│   └── node-cron 定时盯盘 + 自动迁移              │
└─────────────────────────────────────────────────┘
           ↕                        ↕
  🔷 LI.FI Earn API          ⛓️ EVM 链 RPC
  （Vault 数据 + Composer）    （链上余额查询）
```

---

## Agent Skill 工具列表

| 工具 | 类型 | 说明 |
|------|------|------|
| `get_vaults` | 查询 | 按链 / 代币 / 协议 / APY 筛选 Vault 列表 |
| `ai_search` | 查询 | 自然语言搜索最优 Vault |
| `get_portfolio` | 查询 | 查询钱包全链持仓 |
| `get_agent_wallet` | 查询 | 获取 Agent 操作钱包地址 |
| `execute_deposit` | 执行 | 跨链存款（授权 + 签名 + 广播） |
| `execute_redeem` | 执行 | 赎回（授权 + 签名 + 广播） |
| `scan_migration_opportunities` | 分析 | 扫描同链更优 Vault 迁移机会 |
| `execute_migration` | 执行 | 原子化赎回旧 Vault → 存入新 Vault |

### 快速启动 Skill

```bash
cd skill
npm install
cp .env.example .env   # 填入 AGENT_PRIVATE_KEY 和 ANTHROPIC_API_KEY

# 对话模式
npm run dev "找 USDC 收益最高的 vault"

# 定时盯盘 + 自动迁移
npm run dev cron --auto-migrate \
  --min-apy=3 --min-tvl=5000000
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 16 · Tailwind CSS · wagmi v2 · TanStack Query v5 · Recharts |
| **后端** | Hono · TypeScript · SQLite · OpenAPI 3.0 · Scalar UI |
| **AI** | GLM-4-Flash（BigModel）· Function Calling · 多轮对话 |
| **Agent** | Anthropic SDK · viem · node-cron · LI.FI Composer |

---

## 本地运行

```bash
# 后端
cd api
cp .env.example .env   # 填入 LIFI_API_KEY 和 BIGMODEL_API_KEY
npm install
npm run dev            # http://localhost:3000

# 前端（新终端）
cd web
npm install
npm run dev            # http://localhost:3001
```

---

## LI.FI Earn API 使用

本项目深度集成 LI.FI Earn API，覆盖以下能力：

| 能力 | 接口 |
|------|------|
| Vault 列表查询 | `GET /v1/earn/vaults` |
| 单 Vault 详情 | `GET /v1/earn/vaults/:chainId/:address` |
| 持仓查询 | `GET /v1/earn/portfolio/:wallet/positions` |
| 链列表 | `GET /v1/earn/chains` |
| 协议列表 | `GET /v1/earn/protocols` |
| 跨链存款报价 | LI.FI Composer `GET /v1/quote` |

> API Key 申请：[portal.li.fi](https://portal.li.fi/)  
> Earn API 文档：[docs.li.fi/earn/overview](https://docs.li.fi/earn/overview)

---

## 参赛信息

| 项目 | 内容 |
|------|------|
| 黑客松 | DeFi Mullet Hackathon #1: Builder Edition |
| 主办方 | @lifiprotocol |
| 赛道 | AI × Earn ＋ Yield Builder |
| 奖池 | 5,000 USDC |
| 提交表单 | [forms.gle/1PCvD9BymH1EyRmV8](https://forms.gle/1PCvD9BymH1EyRmV8) |
