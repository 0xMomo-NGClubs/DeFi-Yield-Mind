import { Hono } from 'hono'
import NodeCache from 'node-cache'
import { fetchVaults, fetchChains, fetchProtocols } from '../services/earn.js'

export const searchRouter = new Hono()

// 链/协议参考数据缓存 10 分钟（不再缓存 vault 列表，改由工具实时查）
const refCache = new NodeCache({ stdTTL: 600 })

// ---- 类型 ----
interface SearchParams {
  asset?: string
  protocol?: string
  chainId?: number
  minApy?: number
  sortBy?: string
  limit?: number
}

export interface Recommendation {
  chainId: number
  address: string
  name: string
  protocol: string
  tokens: string[]
  apy: number
  tvlUsd: string
  reason: string
}

export interface SearchResult {
  params: SearchParams
  recommendations: Recommendation[]
  explanation: string
  description: string
  model: string
}

// ---- 参考数据（只含链/协议，不注入 vault 列表）----
// 去掉静态 vault context，原因：
//   1. 静态数据是 APY 前 50，以高风险 vault 为主，会干扰稳定币/低风险查询
//   2. 模型应当完全依赖工具实时查询，才能精确响应用户的 minApy/chainId/asset 条件
async function buildRefContext(): Promise<string> {
  const cached = refCache.get<string>('ref')
  if (cached) return cached

  const [chainsRaw, protocolsRaw] = await Promise.all([
    fetchChains(),
    fetchProtocols(),
  ])

  const chains = chainsRaw as { chainId: number; name: string }[]
  const protocols = (protocolsRaw as { name: string }[]).map(p => p.name)
  const chainList = chains.map(c => `${c.name}(id:${c.chainId})`).join(', ')

  const ctx = `支持的链：${chainList}
支持的协议：${protocols.join(', ')}`

  refCache.set('ref', ctx)
  return ctx
}

function formatTvl(usd: string): string {
  const n = parseFloat(usd)
  if (isNaN(n)) return '--'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

// ---- 工具定义（增加了 minApy、minTvl）----
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_vaults',
      description: '实时查询 DeFi 金库列表。必须调用此工具获取真实数据，不得从记忆或上下文中编造 vault 地址。',
      parameters: {
        type: 'object',
        properties: {
          asset:    { type: 'string', description: '代币符号，如 USDC、USDT、ETH、WBTC、DAI' },
          protocol: { type: 'string', description: '协议名称，如 aave-v3、morpho-v1、euler-v2' },
          chainId:  { type: 'number', description: '链 ID：1=Ethereum, 42161=Arbitrum, 8453=Base, 10=Optimism, 137=Polygon, 56=BSC' },
          minApy:   { type: 'number', description: '最低年化收益率（%）。用户说"APY 超过 X%"时传此参数' },
          minTvl:   { type: 'number', description: '最低 TVL（USD）。用户要求"安全/大协议/流动性好"时可设 1000000 以上' },
          sortBy:   { type: 'string', enum: ['apy', 'tvl'], description: '排序方式，默认 apy' },
          limit:    { type: 'number', description: '返回数量，默认 10，最多 20' },
        },
      },
    },
  },
]

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'search_vaults') {
    const resp = await fetchVaults({
      asset:    args.asset as string | undefined,
      protocol: args.protocol as string | undefined,
      chainId:  args.chainId as number | undefined,
      minApy:   args.minApy as number | undefined,
      minTvl:   args.minTvl as number | undefined,
      sortBy:   (args.sortBy as string | undefined) ?? 'apy',
      limit:    Math.min((args.limit as number | undefined) ?? 10, 20),
    })

    const chainsRaw = await fetchChains()
    const chainMap = Object.fromEntries(
      (chainsRaw as { chainId: number; name: string }[]).map(c => [c.chainId, c.name])
    )

    const rows = resp.vaults
      .filter(v => v.analytics.apy.total != null)
      .map(v => ({
        chainId:  v.chainId,
        chain:    chainMap[v.chainId] ?? `Chain${v.chainId}`,
        address:  v.address,
        name:     v.name,
        protocol: v.protocol.name,
        tokens:   v.underlyingTokens.map(t => t.symbol),
        apy:      v.analytics.apy.total,
        apyBase:  v.analytics.apy.base,
        apyReward: v.analytics.apy.reward,
        apy7d:    v.analytics.apy7d,
        tvlUsd:   v.analytics.tvl.usd,
        tvlFmt:   formatTvl(v.analytics.tvl.usd),
        isTransactional: v.isTransactional,
      }))

    console.log(`[AI Search] search_vaults(${JSON.stringify(args)}) → ${rows.length} 条`)
    return JSON.stringify(rows)
  }
  return JSON.stringify({ error: `未知工具: ${name}` })
}

// ---- GLM API 调用 ----
type Message = {
  role: string
  content: string | null
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

interface ToolCall {
  id: string
  type: string
  function: { name: string; arguments: string }
}

async function callGLM(
  messages: Message[],
  useTools: boolean,
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const apiKey = process.env.BIGMODEL_API_KEY
  if (!apiKey) throw new Error('未配置 BIGMODEL_API_KEY')

  const body: Record<string, unknown> = {
    model: 'glm-4-flash-250414',
    messages,
    temperature: 0.1,   // 降低随机性，让推荐更确定
    max_tokens: 2048,   // 增大 token 上限，允许更丰富的推荐理由
  }
  if (useTools) {
    body.tools = TOOLS
    body.tool_choice = 'auto'
  }

  const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const err = await resp.text()
    console.error('GLM API 错误:', resp.status, err)
    throw new Error(`GLM API 错误: ${resp.status}`)
  }

  const data = await resp.json() as {
    choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[]
  }
  return data.choices[0].message
}

// ---- System Prompt ----
function buildSystemPrompt(refCtx: string): string {
  return `你是 DeFi Yield Hub 的智能搜索助手，帮用户精准找到最适合的 DeFi 金库。

=== 平台参考数据 ===
${refCtx}

=== 工作原则 ===
1. 【必须调用工具】推荐前必须调用 search_vaults 获取真实数据。禁止从记忆中编造 vault 地址或 APY。
2. 【精准匹配参数】用户提到链名/代币/协议/APY门槛/TVL要求，对应填入工具参数：
   - "APY 超过 X%" → minApy: X
   - "稳定币" → asset: "USDC" 或先不限定 asset，搜索后从结果中筛选
   - "安全/大协议" → minTvl: 5000000（500万以上）
   - "Arbitrum 上" → chainId: 42161
3. 【多次调用】复杂查询可多次调用工具（不同资产/不同链），综合对比后推荐最优的
4. 【具体推荐理由】reason 必须包含具体数字，格式示例：
   "Arbitrum 最高 APY 12.5%（基础 8.2% + 奖励 4.3%），TVL $45M 流动性充足，Morpho 协议安全性高"
5. 【多轮对话】可以参考历史消息理解用户意图（如"那 Base 上的呢？"是在追问上一条件）

=== 输出格式（严格 JSON，不得有任何其他内容）===
address 字段必须是工具返回结果中的真实 0x 十六进制地址（42位），禁止填写占位符或说明文字。
{
  "params": { "asset": "USDC", "chainId": 42161, "minApy": 5, "sortBy": "apy" },
  "recommendations": [
    {
      "chainId": 42161,
      "address": "0x48f89d731c3571d527132d7e09f28f2f09c42ec0",
      "name": "USDC Morpho Vault",
      "protocol": "morpho-v1",
      "tokens": ["USDC"],
      "apy": 12.5,
      "tvlUsd": "45000000",
      "reason": "Arbitrum 最高 APY 12.5%（基础 8.2% + 奖励 4.3%），TVL $45M，Morpho 协议安全性高"
    }
  ],
  "explanation": "1-2句总结，说明找到了什么、为什么推荐",
  "description": "参数摘要，如：代币 USDC，链 Arbitrum，APY ≥ 5%"
}

不相关问题返回：{ "params": {}, "recommendations": [], "explanation": "说明原因", "description": "" }`
}

// ---- 主路由 ----
searchRouter.post('/parse', async (c) => {
  try {
    const body = await c.req.json()
    const query = body.query as string
    // 多轮对话：接收历史消息 [{ role: 'user'|'assistant', content: string }]
    const history = (body.history ?? []) as { role: string; content: string }[]

    if (!query || typeof query !== 'string') {
      return c.json({ error: '请提供 query 字段' }, 400)
    }

    console.log(`[AI Search] 查询: "${query}"，历史 ${history.length} 条`)

    const refCtx = await buildRefContext()
    const systemPrompt = buildSystemPrompt(refCtx)

    // 构建消息：system + 历史 + 当前问题
    // 历史只保留最近 6 条（3轮），避免 token 过多
    const recentHistory = history.slice(-6)
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: query },
    ]

    // 最多 5 轮工具调用
    let finalContent: string | null = null
    for (let round = 0; round < 5; round++) {
      const reply = await callGLM(messages, true)

      if (reply.tool_calls && reply.tool_calls.length > 0) {
        messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls })

        const toolResults = await Promise.all(
          reply.tool_calls.map(async tc => {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
            const result = await executeTool(tc.function.name, args)
            return { id: tc.id, name: tc.function.name, result }
          })
        )

        for (const tr of toolResults) {
          messages.push({ role: 'tool', tool_call_id: tr.id, name: tr.name, content: tr.result })
        }
      } else {
        finalContent = reply.content
        break
      }
    }

    if (!finalContent) throw new Error('模型未返回最终结果')

    // 提取 JSON，二次修正
    let jsonMatch = finalContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[AI Search] 模型未返回 JSON，尝试修正...')
      messages.push({ role: 'assistant', content: finalContent })
      messages.push({
        role: 'user',
        content: '请将你的回答转换为指定的 JSON 格式，不含任何其他文字。若与金库搜索无关，返回 {"params":{},"recommendations":[],"explanation":"该问题与 DeFi 金库搜索无关","description":""}',
      })
      const fixReply = await callGLM(messages, false)
      finalContent = fixReply.content ?? ''
      jsonMatch = finalContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('模型持续返回格式异常，请重试')
    }

    const result = JSON.parse(jsonMatch[0]) as SearchResult
    result.model = 'glm-4-flash-250414'

    // 过滤掉非合法 EVM 地址的推荐（防止模型输出占位符）
    const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/
    const before = result.recommendations?.length ?? 0
    result.recommendations = (result.recommendations ?? []).filter(r => EVM_ADDR_RE.test(r.address))
    const filtered = before - result.recommendations.length
    if (filtered > 0) {
      console.warn(`[AI Search] 过滤掉 ${filtered} 条非法地址推荐`)
    }

    console.log(`[AI Search] 完成，推荐 ${result.recommendations.length} 个金库`)
    return c.json(result)

  } catch (err) {
    const msg = err instanceof Error ? err.message : '搜索失败'
    console.error('[AI Search] 错误:', msg)
    return c.json({ error: msg }, 500)
  }
})
