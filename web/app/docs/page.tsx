'use client'

import { useState } from 'react'

const apiUrl = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000')
  : 'http://localhost:3000'

// 端点列表（含新增的 3 个）
const ENDPOINTS = [
  { method: 'GET',  path: '/vaults',                      desc: '获取 Vault 列表（支持筛选/分页）',    tag: 'Vaults' },
  { method: 'GET',  path: '/vaults/:chainId/:address',    desc: '获取单个 Vault 详情',                tag: 'Vaults' },
  { method: 'GET',  path: '/portfolio/:wallet',           desc: '查询钱包多协议持仓',                 tag: 'Portfolio' },
  { method: 'GET',  path: '/history/:chainId/:address',   desc: 'APY 历史快照（每小时采集）',          tag: 'History' },
  { method: 'POST', path: '/search/parse',                desc: 'AI 自然语言搜索金库',               tag: 'Search' },
  { method: 'POST', path: '/deposit/quote',               desc: '构建跨链存款交易（Composer）',        tag: 'Deposit' },
  { method: 'POST', path: '/redeem/quote',                desc: '构建赎回交易',                      tag: 'Redeem' },
  { method: 'GET',  path: '/chains',                      desc: '支持的链列表（21 条）',               tag: 'Ref' },
  { method: 'GET',  path: '/protocols',                   desc: '支持的协议列表（20+）',              tag: 'Ref' },
  { method: 'GET',  path: '/openapi.json',                desc: 'OpenAPI Spec（JSON 格式）',          tag: 'Ref' },
]

// Skill 文件快速上手步骤
const SKILL_SETUP_STEPS = [
  { step: '1', title: '安装依赖', code: 'cd skill && npm install' },
  { step: '2', title: '配置环境变量', code: 'cp .env.example .env\n# 编辑 .env，填入 AGENT_PRIVATE_KEY 和 ANTHROPIC_API_KEY' },
  { step: '3', title: '启动后端', code: 'cd ../api && npm run dev' },
  { step: '4', title: '运行 Agent', code: 'npm run dev "帮我找 USDC 收益最高的 vault"\nnpm run dev "把 10 USDC 存入 Arbitrum APY 最高的 vault"' },
]

// 各框架接入代码片段
const SNIPPETS: Record<string, string> = {
  skill: `// skill/defi-yield-hub.skill.ts 已包含完整实现
// 以下演示如何在自己的代码中复用

import { runDeFiAgent, DEFI_TOOLS } from './defi-yield-hub.skill.js'

// 方式一：直接运行内置 Agent 对话
const result = await runDeFiAgent('帮我找 Arbitrum 上 USDC 收益最高的 3 个 vault')
console.log(result)

// 方式二：把 DEFI_TOOLS 接入自己的 Agent 系统
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()

const response = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  tools: DEFI_TOOLS,   // 直接复用 skill 中的工具定义
  messages: [{ role: 'user', content: '查询我的持仓' }],
})`,
  claude: `import anthropic from "@anthropic-ai/sdk";

const client = new anthropic.Anthropic();

// 定义 DeFi Yield Hub 工具
const tools = [
  {
    name: "get_vaults",
    description: "查询 DeFi 收益 Vault 列表，支持按链、代币、协议、APY 筛选",
    input_schema: {
      type: "object",
      properties: {
        asset:    { type: "string",  description: "代币符号，如 USDC、ETH" },
        chainId:  { type: "integer", description: "链 ID，如 42161=Arbitrum" },
        protocol: { type: "string",  description: "协议名，如 morpho-v1" },
        minApy:   { type: "number",  description: "最低 APY（百分比）" },
        sortBy:   { type: "string",  enum: ["apy", "tvl"] },
        limit:    { type: "integer", description: "返回数量，最大 100" },
      },
    },
  },
  {
    name: "get_portfolio",
    description: "查询钱包地址在所有支持协议的 DeFi 持仓",
    input_schema: {
      type: "object",
      required: ["wallet"],
      properties: {
        wallet: { type: "string", description: "EVM 钱包地址（0x...）" },
      },
    },
  },
  {
    name: "ai_search_vaults",
    description: "用自然语言搜索最优 DeFi 金库，AI 自动解析并推荐",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "自然语言查询，如「USDC 收益最高的」" },
      },
    },
  },
];

async function handleToolCall(name: string, input: Record<string, unknown>) {
  const BASE = "http://localhost:3000";
  if (name === "get_vaults") {
    const params = new URLSearchParams(input as Record<string, string>);
    const res = await fetch(\`\${BASE}/vaults?\${params}\`);
    return res.json();
  }
  if (name === "get_portfolio") {
    const res = await fetch(\`\${BASE}/portfolio/\${input.wallet}\`);
    return res.json();
  }
  if (name === "ai_search_vaults") {
    const res = await fetch(\`\${BASE}/search/parse\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: input.query }),
    });
    return res.json();
  }
}

// 多轮 Agent 对话
async function runDeFiAgent(userMessage: string) {
  const messages = [{ role: "user" as const, content: userMessage }];

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      return response.content.find(b => b.type === "text")?.text;
    }

    // 执行工具调用
    const toolUses = response.content.filter(b => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUses.map(async (tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: JSON.stringify(await handleToolCall(tu.name, tu.input)),
      }))
    );
    messages.push({ role: "user", content: toolResults });
  }
}

// 使用示例
runDeFiAgent("帮我找 Arbitrum 上 USDC 收益最高的 3 个 vault")
  .then(console.log);`,

  langchain: `from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
import requests

BASE_URL = "http://localhost:3000"

@tool
def get_vaults(asset: str = None, chain_id: int = None,
               min_apy: float = None, sort_by: str = "apy",
               limit: int = 10) -> dict:
    """查询 DeFi 收益 Vault 列表，支持按代币、链、APY 筛选排序"""
    params = {k: v for k, v in {
        "asset": asset, "chainId": chain_id,
        "minApy": min_apy, "sortBy": sort_by, "limit": limit
    }.items() if v is not None}
    return requests.get(f"{BASE_URL}/vaults", params=params).json()

@tool
def get_portfolio(wallet: str) -> dict:
    """查询指定钱包在所有 DeFi 协议的持仓和收益"""
    return requests.get(f"{BASE_URL}/portfolio/{wallet}").json()

@tool
def ai_search(query: str) -> dict:
    """用自然语言搜索最优 DeFi 金库，返回 AI 推荐列表"""
    return requests.post(
        f"{BASE_URL}/search/parse",
        json={"query": query}
    ).json()

llm = ChatAnthropic(model="claude-opus-4-6")
llm_with_tools = llm.bind_tools([get_vaults, get_portfolio, ai_search])

# 发起查询
response = llm_with_tools.invoke("帮我找 Base 链上 ETH 收益最高的 vault")
print(response)`,

  curl: `# 1. AI 自然语言搜索
curl -X POST http://localhost:3000/search/parse \\
  -H "Content-Type: application/json" \\
  -d '{"query": "USDC 收益最高的"}'

# 2. 查询 Arbitrum 上 USDC vault（APY 排序）
curl "http://localhost:3000/vaults?asset=USDC&chainId=42161&sortBy=apy&limit=5"

# 3. 查询钱包持仓
curl "http://localhost:3000/portfolio/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

# 4. 获取存款报价（跨链 USDC → Arbitrum Vault）
curl -X POST http://localhost:3000/deposit/quote \\
  -H "Content-Type: application/json" \\
  -d '{
    "fromChainId": 1,
    "fromToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "fromAmount": "1000000",
    "vaultChainId": 42161,
    "vaultAddress": "0x...",
    "userWallet": "0x..."
  }'

# 5. 查询 Vault APY 历史
curl "http://localhost:3000/history/42161/0x...?limit=100"`,
}

type SnippetKey = keyof typeof SNIPPETS

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-gray-500 hover:text-white transition-colors px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500"
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

export default function SkillPage() {
  const [activeSnippet, setActiveSnippet] = useState<SnippetKey>('claude')
  const [showScalar, setShowScalar] = useState(false)

  const specUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/openapi.json`
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

  return (
    <div className="space-y-6">

      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-950/60 via-gray-900 to-gray-900 border border-violet-900/30 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono bg-violet-900/60 text-violet-300 border border-violet-700/50 px-2 py-0.5 rounded">Agent Skill</span>
              <span className="text-xs font-mono bg-green-900/40 text-green-400 border border-green-700/40 px-2 py-0.5 rounded">10 端点</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">DeFi Yield Hub Skill</h1>
            <p className="text-gray-400 text-sm max-w-xl">
              可直接接入 Claude、LangChain 等 Agent 框架的 DeFi 工具集。
              支持 Vault 发现、持仓查询、AI 搜索、跨链存款交易构建。
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-500 mb-0.5">OpenAPI Spec</p>
            <code className="text-xs text-violet-300 font-mono">/openapi.json</code>
          </div>
        </div>
      </div>

      {/* 接入坐标 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] text-gray-500 mb-1 font-mono uppercase tracking-wider">OpenAPI Spec URL</p>
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2">
            <code className="text-xs text-violet-300 flex-1 truncate font-mono">{specUrl}</code>
            <CopyButton text={specUrl} />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 mb-1 font-mono uppercase tracking-wider">Base URL</p>
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2">
            <code className="text-xs text-violet-300 flex-1 truncate font-mono">{baseUrl}</code>
            <CopyButton text={baseUrl} />
          </div>
        </div>
      </div>

      {/* 端点速览 */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">全部端点</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ENDPOINTS.map(ep => (
            <div key={ep.path} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 hover:border-gray-700 transition-colors">
              <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${
                ep.method === 'GET'
                  ? 'bg-green-900/60 text-green-400'
                  : 'bg-blue-900/60 text-blue-400'
              }`}>
                {ep.method}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-mono text-gray-300 truncate">{ep.path}</p>
                <p className="text-[10px] text-gray-600 truncate">{ep.desc}</p>
              </div>
              <span className="ml-auto text-[9px] text-gray-700 font-mono flex-shrink-0">{ep.tag}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI 搜索 Skill 重点介绍 */}
      <div className="bg-gray-900 border border-indigo-800/40 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">AI 搜索 Skill</span>
          <span className="text-[10px] bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 px-1.5 py-0.5 rounded font-mono">POST /search/parse</span>
        </div>
        <p className="text-xs text-gray-400">
          核心 AI 端点。发送自然语言查询，后端调用 GLM-4-Flash 解析意图并通过 Function Calling 查询实时 Vault 数据，返回推荐列表 + 参数标签。
          直接作为 Agent 的工具使用，用户无需了解 API 细节。
        </p>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-gray-800/60 rounded-xl p-3">
            <p className="text-gray-500 mb-1.5 font-mono text-[10px]">Request</p>
            <pre className="text-gray-300 font-mono text-[11px]">{`{
  "query": "USDC 收益最高的"
}`}</pre>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3">
            <p className="text-gray-500 mb-1.5 font-mono text-[10px]">Response</p>
            <pre className="text-gray-300 font-mono text-[11px] overflow-hidden">{`{
  "params": { "asset": "USDC" },
  "recommendations": [
    { "chainId": 42161, "apy": 12.5,
      "reason": "..." }
  ],
  "explanation": "找到 3 个 USDC vault...",
  "model": "glm-4-flash-250414"
}`}</pre>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {['USDC 收益最高的', 'Arbitrum 上 Aave ETH', 'APY 超过 20%', '稳定币最安全的 vault'].map(q => (
            <span key={q} className="text-[11px] font-mono bg-indigo-950/50 border border-indigo-800/40 text-indigo-300 px-2 py-0.5 rounded">
              "{q}"
            </span>
          ))}
        </div>
      </div>

      {/* Skill 文件快速上手 */}
      <div className="bg-gray-900 border border-violet-800/40 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">Skill 文件快速上手</span>
          <span className="text-[10px] font-mono bg-violet-900/50 text-violet-300 border border-violet-700/50 px-1.5 py-0.5 rounded">skill/defi-yield-hub.skill.ts</span>
        </div>
        <p className="text-xs text-gray-400">
          项目自带完整 Skill 文件。私钥只在本地读取，用 viem 在本机签名，<strong className="text-white">不发给任何服务器</strong>。
          API 只负责返回未签名的 <code className="text-green-300 font-mono">transactionRequest</code>，签名和广播由 Skill 文件在本地完成。
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {SKILL_SETUP_STEPS.map(s => (
            <div key={s.step} className="bg-gray-800/60 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-violet-700 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{s.step}</span>
                <span className="text-xs text-gray-300 font-medium">{s.title}</span>
              </div>
              <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap">{s.code}</pre>
            </div>
          ))}
        </div>
      </div>

      {/* 框架集成代码片段 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="flex border-b border-gray-800 overflow-x-auto">
          {([['skill', 'Skill 文件集成'], ['claude', 'Claude API (TypeScript)'], ['langchain', 'LangChain (Python)'], ['curl', 'cURL 示例']] as [SnippetKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveSnippet(key)}
              className={`flex-shrink-0 text-xs py-2.5 px-4 transition-colors ${
                activeSnippet === key
                  ? 'text-white bg-gray-800 border-b-2 border-violet-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <div className="absolute top-3 right-3 z-10">
            <CopyButton text={SNIPPETS[activeSnippet]} />
          </div>
          <pre className="overflow-x-auto p-4 text-[11px] text-gray-300 font-mono leading-relaxed max-h-96 overflow-y-auto">
            {SNIPPETS[activeSnippet]}
          </pre>
        </div>
      </div>

      {/* 存款流程说明 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-semibold text-white">存款/赎回交易流程</p>
        <p className="text-xs text-gray-400">
          本 API 不执行链上操作，仅返回 <code className="text-green-300 font-mono">transactionRequest</code>，由用户钱包签名后广播。支持跨链（LI.FI Composer 自动处理 Swap + Bridge）。
        </p>
        <div className="flex gap-2 flex-wrap text-[11px]">
          {[
            '① 调用 /deposit/quote 获取交易数据',
            '② ERC-20 approve（如需）',
            '③ 钱包签名 transactionRequest',
            '④ 广播上链',
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5">
              <span className="text-violet-400 font-mono">{step.slice(0, 1)}</span>
              <span className="text-gray-400">{step.slice(1)}</span>
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-2 pt-1 text-[10px]">
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
            <p className="text-green-400 font-mono mb-1">存款关键参数</p>
            <p className="text-gray-500 leading-relaxed">
              <span className="text-gray-300">toToken</span> = vault 合约地址（非底层 token）<br/>
              <span className="text-gray-300">fromToken</span> = 用户持有的代币地址<br/>
              支持跨链：fromChainId ≠ vaultChainId
            </p>
          </div>
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
            <p className="text-blue-400 font-mono mb-1">赎回关键参数</p>
            <p className="text-gray-500 leading-relaxed">
              <span className="text-gray-300">vaultAddress</span> = vault 合约（ERC-4626 份额）<br/>
              <span className="text-gray-300">toToken</span> = 底层代币地址（如 USDC）<br/>
              <span className="text-gray-300">fromAmount</span> = 份额数量（18 decimals）
            </p>
          </div>
        </div>
      </div>

      {/* Scalar 交互式文档 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">交互式 API 文档</p>
          <button
            onClick={() => setShowScalar(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 px-3 py-1 rounded-lg transition-colors"
          >
            {showScalar ? '收起 ▲' : '展开 Scalar UI ▼'}
          </button>
        </div>
        {showScalar && (
          <div className="rounded-2xl border border-gray-800 overflow-hidden bg-white" style={{ height: '75vh', minHeight: 600 }}>
            <iframe
              src={`${baseUrl}/scalar`}
              className="w-full h-full border-0"
              title="OpenAPI Playground"
              allow="clipboard-write"
            />
          </div>
        )}
        {!showScalar && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 text-center">
            <p className="text-xs text-gray-600 mb-2">基于 Scalar 的交互式测试界面，可直接在浏览器中调试所有接口</p>
            <button
              onClick={() => setShowScalar(true)}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-4 py-1.5 rounded-lg transition-colors"
            >
              打开 Scalar UI
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
