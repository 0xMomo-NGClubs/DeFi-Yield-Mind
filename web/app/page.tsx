'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useInfiniteQuery, useQuery, useMutation } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { getVaults, getVaultDetail, getChains, getProtocols, getPortfolio, Vault, Position, parseSearchQuery, SearchRecommendation } from '@/lib/api'
import { VaultFilter } from '@/components/VaultFilter'
import { DepositModal } from '@/components/DepositModal'
import { VaultCard } from '@/components/VaultCard'
import { FeaturedVaultCard } from '@/components/FeaturedVaultCard'

// ---- 思考步骤组件（顺序推进，不循环）----
function ThinkingSteps({
  steps, activeStep, doneSteps,
}: {
  steps: { icon: string; label: string }[]
  activeStep: number
  doneSteps: Set<number>
}) {
  return (
    <div className="bg-gray-900/80 border border-indigo-900/40 rounded-xl px-4 py-3 space-y-2">
      {steps.map((step, idx) => {
        const isDone   = doneSteps.has(idx)
        const isActive = activeStep === idx
        const isPending = !isDone && !isActive

        return (
          <div key={idx} className={`flex items-center gap-3 transition-all duration-300 ${isPending ? 'opacity-30' : 'opacity-100'}`}>
            {/* 状态图标 */}
            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
              {isDone ? (
                // 完成：绿色勾
                <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : isActive ? (
                // 进行中：旋转圆圈
                <svg className="w-4 h-4 text-indigo-400 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 17" strokeLinecap="round" />
                </svg>
              ) : (
                // 待执行：空心圆
                <svg className="w-4 h-4 text-gray-700" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </div>

            {/* 步骤文字 */}
            <span className={`text-xs font-medium transition-colors duration-200 ${
              isDone   ? 'text-emerald-400/80' :
              isActive ? 'text-indigo-200'     :
                         'text-gray-600'
            }`}>
              {step.icon} {step.label}
              {isActive && <span className="ml-1 text-indigo-400 animate-pulse">…</span>}
            </span>

            {/* 完成时的淡出线条 */}
            {isDone && (
              <div className="flex-1 h-px bg-emerald-900/40 ml-1" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- 协议颜色（与 VaultCard 保持一致）----
const AI_PROTOCOL_COLORS: Record<string, string> = {
  'morpho-v1':    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'aave-v3':      'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'euler-v2':     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'pendle-v2':    'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'ethena':       'bg-green-500/20 text-green-300 border-green-500/30',
  'etherfi':      'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'compound-v3':  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}
function aiProtocolColor(name: string) {
  return AI_PROTOCOL_COLORS[name] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30'
}

// ---- AI 推荐金库卡片（对齐 VaultCard 风格）----
function AiRecommendCard({
  rec, rank, chainName, positions, onDeposit,
}: {
  rec: SearchRecommendation
  rank: number
  chainName: string
  positions: Position[]
  onDeposit: (vault: Vault, tab?: 'deposit' | 'redeem') => void
}) {
  const rankEmoji = ['🥇', '🥈', '🥉']

  // 非合法 EVM 地址（模型幻觉）直接跳过请求
  const isValidAddr = /^0x[0-9a-fA-F]{40}$/.test(rec.address)

  const { data: vault, isLoading } = useQuery({
    queryKey: ['vault', rec.chainId, rec.address],
    queryFn: () => getVaultDetail(rec.chainId, rec.address),
    staleTime: 5 * 60 * 1000,
    enabled: isValidAddr,
    retry: 0,          // 详情接口失败不重试，避免刷屏报错
    throwOnError: false, // 错误静默降级，用 rec 数据兜底
  })

  const displayName      = vault?.name ?? rec.name
  const displayProtocol  = vault?.protocol.name ?? rec.protocol
  const displayTokens    = vault?.underlyingTokens.map(t => t.symbol) ?? rec.tokens
  // 运行时 AI 可能返回 string / null，统一转为 number 避免 .toFixed 报错
  const displayApy       = Number(vault?.analytics.apy.total ?? rec.apy ?? 0) || 0
  const displayApyBase   = vault?.analytics.apy.base   != null ? Number(vault.analytics.apy.base)   : null
  const displayApyReward = vault?.analytics.apy.reward != null ? Number(vault.analytics.apy.reward) : null
  const displayTvl       = vault?.analytics.tvl.usd ?? rec.tvlUsd
  const protocolUrl      = vault?.protocol.url

  const position = positions.find(pos =>
    pos.chainId === rec.chainId &&
    displayTokens.some(t => t.toUpperCase() === pos.asset.symbol.toUpperCase()) &&
    pos.protocolName.toLowerCase().replace(/[^a-z0-9]/g, '').includes(
      displayProtocol.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)
    )
  ) ?? null

  const posBalanceUsd    = position ? parseFloat(position.balanceUsd) : null
  const posBalanceNative = position ? parseFloat(position.balanceNative) : null
  const dailyEarn   = posBalanceUsd != null ? posBalanceUsd * (displayApy / 100 / 365)      : null
  const monthlyEarn = posBalanceUsd != null ? posBalanceUsd * (displayApy / 100 / 365 * 30) : null

  const tvlStr = (() => {
    const n = parseFloat(displayTvl)
    if (isNaN(n)) return '--'
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
    return `$${n.toFixed(0)}`
  })()

  return (
    <div className={`group relative flex flex-col rounded-2xl border transition-all duration-200 hover:shadow-lg hover:shadow-black/30 ${
      position
        ? 'bg-emerald-950/20 border-emerald-800/40 hover:border-emerald-700/50 hover:bg-emerald-950/30'
        : 'bg-gray-900 border-gray-800 hover:border-gray-600 hover:bg-gray-800/50'
    }`}>
      {/* 排名角标 */}
      <div className="absolute top-3 right-3 text-base select-none">{rankEmoji[rank] ?? `#${rank + 1}`}</div>

      {/* ── 顶部：协议 + 链 ── */}
      <div className="flex items-center gap-2 px-4 pt-4 pr-10 flex-wrap">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${aiProtocolColor(displayProtocol)}`}>
          {displayProtocol}
        </span>
        <span className="text-[11px] text-gray-500 bg-gray-800/80 px-2 py-0.5 rounded-full">{chainName}</span>
      </div>

      {/* ── 名称 + 代币 ── */}
      <div className="px-4 pt-2.5">
        {isLoading ? (
          <div className="space-y-1.5">
            <div className="h-4 w-36 bg-gray-800 rounded animate-pulse" />
            <div className="h-3 w-20 bg-gray-800 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-white text-sm leading-snug line-clamp-1" title={displayName}>
              {displayName}
            </h3>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {displayTokens.map(t => (
                <span key={t} className="text-[11px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono border border-gray-700/50">
                  {t}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── APY + TVL ── */}
      <div className="flex items-end justify-between px-4 pt-3">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">APY</p>
          <span className={`text-2xl font-black tracking-tight ${displayApy > 20 ? 'text-green-400' : 'text-white'}`}>
            {displayApy.toFixed(2)}%
          </span>
          <div className="flex gap-2 mt-1">
            {displayApyBase != null && displayApyBase > 0 && (
              <span className="text-[10px] text-gray-500">基础 <span className="text-gray-400">{displayApyBase.toFixed(2)}%</span></span>
            )}
            {displayApyReward != null && displayApyReward > 0 && (
              <span className="text-[10px] text-yellow-600">+奖励 <span className="text-yellow-500 font-medium">{displayApyReward.toFixed(2)}%</span></span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-600">TVL</p>
          <p className="text-xs font-semibold text-gray-300">{tvlStr}</p>
        </div>
      </div>

      <div className="mx-4 mt-3 border-t border-gray-800/80" />

      {/* ── 推荐理由（紧凑两行）── */}
      {rec.reason && (
        <p className="px-4 pt-2 text-[10px] text-indigo-300/60 line-clamp-2 leading-relaxed">✦ {rec.reason}</p>
      )}

      {/* ── 持仓区（有仓位时展示）── */}
      {position && posBalanceUsd != null && (
        <div className="mx-4 mt-2 rounded-xl bg-emerald-950/30 border border-emerald-800/30 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-semibold text-emerald-400">我的仓位</span>
            </div>
            <span className="text-[10px] text-gray-600">{position.asset.symbol}</span>
          </div>
          <div className="flex items-end justify-between mt-2">
            <div>
              <p className="text-base font-black text-white">
                ${posBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-gray-500">≈ {posBalanceNative?.toFixed(4)} {position.asset.symbol}</p>
            </div>
            <div className="text-right space-y-0.5">
              {dailyEarn != null && (
                <p className="text-[10px] text-gray-600">日 <span className="text-green-400 font-medium">+${dailyEarn.toFixed(2)}</span></p>
              )}
              {monthlyEarn != null && (
                <p className="text-[10px] text-gray-600">月 <span className="text-green-400 font-medium">+${monthlyEarn.toFixed(2)}</span></p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 操作行 ── */}
      <div className="px-4 pt-2.5 pb-4 flex items-center gap-2 mt-auto">
        {protocolUrl && (
          <a href={protocolUrl} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors">
            官网 ↗
          </a>
        )}
        {isLoading ? (
          <span className="ml-auto text-[11px] text-gray-600">加载中...</span>
        ) : vault ? (
          // 详情加载成功：根据 vault 能力展示按钮
          position ? (
            <div className="flex gap-2 ml-auto">
              {vault.isRedeemable && (
                <button onClick={() => onDeposit(vault, 'redeem')}
                  className="text-xs font-semibold bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-700/60 text-gray-300 hover:text-red-300 active:scale-95 px-3 py-1.5 rounded-lg transition-all">
                  赎回
                </button>
              )}
              {vault.isTransactional && (
                <button onClick={() => onDeposit(vault, 'deposit')}
                  className="text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 active:scale-95 px-3 py-1.5 rounded-lg transition-all">
                  加仓 +
                </button>
              )}
            </div>
          ) : vault.isTransactional ? (
            <button onClick={() => onDeposit(vault, 'deposit')}
              className="flex-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 active:scale-95 py-1.5 rounded-lg transition-all">
              存款
            </button>
          ) : (
            <span className="ml-auto text-[11px] text-gray-700">不支持存款</span>
          )
        ) : (
          // 详情未加载（失败或未请求）：静默降级，显示协议地址供参考
          <span className="ml-auto text-[10px] text-gray-700 font-mono">
            {rec.address.slice(0, 6)}…{rec.address.slice(-4)}
          </span>
        )}
      </div>
    </div>
  )
}

interface FilterState {
  chainId: string
  asset: string
  protocol: string
  minApy: string
  sortBy: string
}

const defaultFilter: FilterState = {
  chainId: '',
  asset: '',
  protocol: '',
  minApy: '',
  sortBy: 'apy',
}

// 快捷资产 tab
const ASSET_TABS = [
  { label: '全部', value: '' },
  { label: 'USDC', value: 'USDC' },
  { label: 'USDT', value: 'USDT' },
  { label: 'ETH', value: 'ETH' },
  { label: 'BTC', value: 'BTC' },
]

// 协议名模糊匹配（API 返回名和 vault protocol.name 可能有差异）
function matchProtocol(posProtocol: string, vaultProtocol: string) {
  const p = posProtocol.toLowerCase().replace(/[^a-z0-9]/g, '')
  const v = vaultProtocol.toLowerCase().replace(/[^a-z0-9]/g, '')
  return p.includes(v) || v.includes(p)
}

// 找到 vault 对应的持仓
function findPosition(vault: Vault, positions: Position[]): Position | null {
  return positions.find(pos =>
    pos.chainId === vault.chainId &&
    matchProtocol(pos.protocolName, vault.protocol.name) &&
    vault.underlyingTokens.some(t =>
      t.symbol.toUpperCase() === pos.asset.symbol.toUpperCase()
    )
  ) ?? null
}

export default function VaultsPage() {
  const { address: connectedAddress } = useAccount()
  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [modalTab, setModalTab] = useState<'deposit' | 'redeem'>('deposit')
  const [aiSearch, setAiSearch] = useState('')
  const [activeAsset, setActiveAsset] = useState('')
  const [selectedVault, setSelectedVault] = useState<Vault | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // ---- AI 对话状态 ----
  interface ConvTurn { query: string; result: import('@/lib/api').SearchParseResult }
  const [conversation, setConversation] = useState<ConvTurn[]>([])
  // 折叠历史轮次：默认除最新一轮外全部折叠，可点击展开
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())
  const convEndRef = useRef<HTMLDivElement>(null)

  // 思考步骤：顺序推进，不循环
  // activeStep = 当前正在进行的步骤索引（-1 = 未开始）
  // doneSteps  = 已完成的步骤集合
  const [activeStep, setActiveStep]  = useState(-1)
  const [doneSteps,  setDoneSteps]   = useState<Set<number>>(new Set())
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const STEPS = [
    { icon: '🔍', label: '理解搜索意图' },
    { icon: '⚡', label: '查询实时金库数据' },
    { icon: '🧠', label: 'AI 分析最优组合' },
    { icon: '✨', label: '整理推荐结果' },
  ]
  // 各步骤的触发时间（ms），根据后端实际耗时调整
  const STEP_DELAYS = [0, 1200, 2800, 4600]

  // 最新一轮结果
  const latestResult = conversation[conversation.length - 1]?.result ?? null

  const { mutate: runAiSearch, isPending: aiLoading } = useMutation({
    mutationFn: ({ query, history }: { query: string; history: { role: string; content: string }[] }) =>
      parseSearchQuery(query, history),
    onSuccess: (result, { query }) => {
      // 先把所有步骤标为完成，短暂停顿后再渲染结果（视觉上更自然）
      setDoneSteps(new Set([0, 1, 2, 3]))
      setActiveStep(-1)
      setTimeout(() => {
        setConversation(prev => {
          // 新轮次加入后，把之前所有轮次折叠，新轮次默认展开（不在 expandedTurns 内 = 展开）
          setExpandedTurns(new Set())
          return [...prev, { query, result }]
        })
        const p = result.params
        setFilter({
          chainId: p.chainId ? String(p.chainId) : '',
          asset: p.asset ?? '',
          protocol: p.protocol ?? '',
          minApy: p.minApy ? String(p.minApy) : '',
          sortBy: p.sortBy ?? 'apy',
        })
        setActiveAsset(p.asset ?? '')
        setTimeout(() => convEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
      }, 400)
    },
  })

  // 发送搜索（自动携带对话历史）
  function sendSearch(query: string) {
    if (!query.trim() || aiLoading) return
    const history = conversation.flatMap(turn => [
      { role: 'user',      content: turn.query },
      { role: 'assistant', content: turn.result.explanation || turn.result.description },
    ])
    setAiSearch('')
    runAiSearch({ query: query.trim(), history })
  }

  // 清空对话
  function clearConversation() {
    setConversation([])
    setExpandedTurns(new Set())
    setFilter(defaultFilter)
    setActiveAsset('')
  }

  // 步骤顺序推进（aiLoading 开始时触发，依次激活每个步骤）
  useEffect(() => {
    // 清理上一轮的定时器
    stepTimersRef.current.forEach(clearTimeout)
    stepTimersRef.current = []

    if (!aiLoading) {
      // 加载结束时重置（onSuccess 里已经处理完成态，这里只管非完成情况）
      if (activeStep >= 0) {
        setActiveStep(-1)
        setDoneSteps(new Set())
      }
      return
    }

    // 重置状态，开始新一轮
    setActiveStep(0)
    setDoneSteps(new Set())

    STEPS.forEach((_, idx) => {
      if (idx === 0) return // 第 0 步已在上面直接设置
      const t = setTimeout(() => {
        // 把上一步标为完成，激活当前步
        setDoneSteps(prev => new Set([...prev, idx - 1]))
        setActiveStep(idx)
      }, STEP_DELAYS[idx])
      stepTimersRef.current.push(t)
    })

    return () => stepTimersRef.current.forEach(clearTimeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiLoading])

  // 参数标签（基于最新结果）
  const paramTags = useMemo(() => {
    if (!latestResult) return []
    const p = latestResult.params
    const chainMap: Record<number, string> = { 1: 'Ethereum', 42161: 'Arbitrum', 10: 'Optimism', 8453: 'Base', 137: 'Polygon', 56: 'BSC', 43114: 'Avalanche' }
    const tags = []
    if (p.asset) tags.push({ label: p.asset, color: 'bg-blue-900/50 text-blue-300 border-blue-700/50' })
    if (p.protocol) tags.push({ label: p.protocol, color: 'bg-purple-900/50 text-purple-300 border-purple-700/50' })
    if (p.chainId) tags.push({ label: chainMap[p.chainId] ?? `Chain ${p.chainId}`, color: 'bg-green-900/50 text-green-300 border-green-700/50' })
    if (p.minApy) tags.push({ label: `≥ ${p.minApy}% APY`, color: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50' })
    return tags
  }, [latestResult])

  const baseParams = {
    chainId: filter.chainId ? Number(filter.chainId) : undefined,
    asset: (activeAsset || filter.asset) || undefined,
    protocol: filter.protocol || undefined,
    minApy: filter.minApy ? Number(filter.minApy) : undefined,
    sortBy: filter.sortBy || undefined,
    limit: 20,
  }

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['vaults', baseParams],
    queryFn: ({ pageParam }) =>
      getVaults({ ...baseParams, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  // 累积所有 vaults
  const allVaults = data?.pages.flatMap((p) => p.vaults) ?? []

  const total = data?.pages[0]?.total

  // 滚动到底部自动加载
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // 链名称映射
  const { data: chainsData } = useQuery({
    queryKey: ['chains'],
    queryFn: getChains,
    staleTime: Infinity,
  })
  const chainNames = Object.fromEntries(
    ((chainsData?.chains ?? []) as { chainId: number; name: string }[])
      .map((c) => [c.chainId, c.name])
  )

  // 顶部统计数字
  const { data: protocolsData } = useQuery({
    queryKey: ['protocols'],
    queryFn: getProtocols,
    staleTime: Infinity,
  })
  const protocolCount = (protocolsData?.protocols as unknown[])?.length ?? '--'
  const chainCount = (chainsData?.chains as unknown[])?.length ?? '--'

  // 从已加载数据计算统计值
  const bestApy = allVaults.length > 0
    ? Math.max(...allVaults.map(v => v.analytics.apy.total ?? 0))
    : null
  const bestStableApy = allVaults.length > 0
    ? Math.max(...allVaults
        .filter(v => v.underlyingTokens.some(t => ['USDC','USDT','DAI','USDS','FRAX'].includes(t.symbol)))
        .map(v => v.analytics.apy.total ?? 0))
    : null

  // Top Picks：已排好序（sortBy=apy），取前 3
  const topVaults = allVaults.slice(0, 3)

  // 已连接钱包时拉取持仓
  const { data: portfolioData } = useQuery({
    queryKey: ['portfolio', connectedAddress],
    queryFn: () => getPortfolio(connectedAddress!),
    enabled: !!connectedAddress,
    staleTime: 2 * 60 * 1000,
  })
  const positions = portfolioData?.positions ?? []

  const handleFilterChange = useCallback((f: FilterState) => {
    setFilter(f)
  }, [])

  return (
    <div className="space-y-6">

      {/* Hero 统计条 */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-950/60 via-gray-900 to-gray-900 border border-blue-900/30 px-6 py-5">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">DeFi Yield Hub</h1>
            <p className="text-gray-400 text-sm">发现最优收益机会，一键跨链存款</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 mb-0.5">最高 APY</p>
            <p className="text-3xl font-black text-green-400 tracking-tight">
              {bestApy != null ? `${bestApy.toFixed(2)}%` : '--'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 pt-4 border-t border-white/5">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Vault 总数</p>
            <p className="text-xl font-bold text-white">{total ?? '--'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">支持协议</p>
            <p className="text-xl font-bold text-white">{protocolCount}+</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">支持链数</p>
            <p className="text-xl font-bold text-white">{chainCount}+</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">稳定币最高 APY</p>
            <p className="text-xl font-bold text-blue-300">
              {bestStableApy != null && bestStableApy > 0 ? `${bestStableApy.toFixed(2)}%` : '--'}
            </p>
          </div>
        </div>
      </div>

      {/* Top Picks 精选区 */}
      {topVaults.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-white">🏆 Top Picks</span>
            <span className="text-xs text-gray-500">当前最高收益</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {topVaults.map((vault, i) => (
              <FeaturedVaultCard
                key={`${vault.chainId}-${vault.address}`}
                vault={vault}
                chainName={chainNames[vault.chainId] ?? `Chain ${vault.chainId}`}
                rank={i}
                onDeposit={setSelectedVault}
              />
            ))}
          </div>
        </div>
      )}

      {/* AI 对话区 */}
      <div className="space-y-3">

        {/* 对话历史 */}
        {conversation.length > 0 && (
          <div className="space-y-3">
            {conversation.map((turn, turnIdx) => {
              const isLatest  = turnIdx === conversation.length - 1
              // 非最新轮：默认折叠；expandedTurns 里的表示手动展开
              const isExpanded = isLatest || expandedTurns.has(turnIdx)
              const p = turn.result.params
              const chainMap: Record<number, string> = { 1: 'Ethereum', 42161: 'Arbitrum', 10: 'Optimism', 8453: 'Base', 137: 'Polygon', 56: 'BSC', 43114: 'Avalanche' }
              const tags = [
                p.asset    && { label: p.asset,                                   color: 'bg-blue-900/50 text-blue-300 border-blue-700/50' },
                p.protocol && { label: p.protocol,                                color: 'bg-purple-900/50 text-purple-300 border-purple-700/50' },
                p.chainId  && { label: chainMap[p.chainId] ?? `Chain ${p.chainId}`, color: 'bg-green-900/50 text-green-300 border-green-700/50' },
                p.minApy   && { label: `≥ ${p.minApy}% APY`,                     color: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50' },
              ].filter(Boolean) as { label: string; color: string }[]
              const recCount = turn.result.recommendations?.length ?? 0

              return (
                <div key={turnIdx} className="space-y-1.5">
                  {/* 用户气泡 */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] bg-indigo-600/20 border border-indigo-700/40 rounded-2xl rounded-tr-md px-3.5 py-2">
                      <p className="text-sm text-indigo-100">{turn.query}</p>
                    </div>
                  </div>

                  {/* AI 回复 */}
                  {isExpanded ? (
                    <div className="space-y-2">
                      {/* 摘要条 */}
                      <div className="bg-gray-900/80 border border-indigo-900/40 rounded-xl px-3.5 py-2.5 space-y-1.5">
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map((tag, i) => (
                              <span key={i} className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${tag.color}`}>
                                {tag.label}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-start gap-1.5">
                          <span className="text-indigo-500 text-xs flex-shrink-0 mt-px">✦</span>
                          <p className="text-xs text-indigo-200 leading-relaxed">
                            {turn.result.explanation || turn.result.description}
                          </p>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] text-gray-700 font-mono">by {turn.result.model ?? 'glm-4-flash'}</p>
                          {/* 非最新轮可手动折叠 */}
                          {!isLatest && (
                            <button
                              onClick={() => setExpandedTurns(prev => { const s = new Set(prev); s.delete(turnIdx); return s })}
                              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                            >
                              收起 ↑
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 推荐卡片 —— 2 列网格 */}
                      {recCount > 0 ? (
                        <div className="grid grid-cols-2 gap-3">
                          {turn.result.recommendations.map((rec, i) => (
                            <AiRecommendCard
                              key={`${rec.chainId}-${rec.address}-${turnIdx}`}
                              rec={rec}
                              rank={i}
                              chainName={chainNames[rec.chainId] ?? `Chain ${rec.chainId}`}
                              positions={positions}
                              onDeposit={(v, tab) => { setSelectedVault(v); setModalTab(tab ?? 'deposit') }}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-600 px-1">未找到符合条件的 vault，试试调整搜索条件</p>
                      )}

                      {/* 最新轮：筛选同步提示 */}
                      {isLatest && tags.length > 0 && (
                        <p className="text-[10px] text-gray-600 px-1">↑ 以上筛选条件已同步到下方列表</p>
                      )}
                    </div>
                  ) : (
                    /* 折叠态：一行摘要 + 展开按钮 */
                    <button
                      onClick={() => setExpandedTurns(prev => new Set([...prev, turnIdx]))}
                      className="w-full flex items-center gap-2 bg-gray-900/60 border border-gray-800 hover:border-indigo-800/60 rounded-xl px-3.5 py-2 transition-all text-left group/fold"
                    >
                      <span className="text-indigo-500 text-xs flex-shrink-0">✦</span>
                      <p className="flex-1 text-xs text-gray-500 line-clamp-1 group-hover/fold:text-gray-300 transition-colors">
                        {turn.result.explanation || turn.result.description || `找到 ${recCount} 个 vault`}
                      </p>
                      {recCount > 0 && (
                        <span className="text-[10px] text-indigo-500 bg-indigo-950/50 border border-indigo-800/40 px-1.5 py-0.5 rounded flex-shrink-0">
                          {recCount} 个结果
                        </span>
                      )}
                      <span className="text-[10px] text-gray-600 group-hover/fold:text-gray-400 flex-shrink-0">展开 ↓</span>
                    </button>
                  )}
                </div>
              )
            })}

            {/* 思考中（有历史时） */}
            {aiLoading && <ThinkingSteps steps={STEPS} activeStep={activeStep} doneSteps={doneSteps} />}

            <div ref={convEndRef} />
          </div>
        )}

        {/* 首次加载：思考中（无历史时） */}
        {conversation.length === 0 && aiLoading && (
          <ThinkingSteps steps={STEPS} activeStep={activeStep} doneSteps={doneSteps} />
        )}

        {/* 输入框 */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            {aiLoading && (
              <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                <div className="absolute inset-x-0 h-px bg-indigo-400/60 animate-[scan_1.2s_ease-in-out_infinite]" />
              </div>
            )}
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 text-sm select-none">✨</span>
            <input
              type="text"
              value={aiSearch}
              onChange={(e) => setAiSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendSearch(aiSearch)}
              placeholder={
                conversation.length > 0
                  ? '继续追问，如「那 Base 上的呢？」「TVL 大一点的有吗？」'
                  : '用自然语言搜索，如「USDC APY 超过 10%」「Arbitrum 上 Morpho 的 vault」'
              }
              className={`w-full bg-gray-900 border rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none transition-all duration-300 ${
                aiLoading
                  ? 'border-indigo-500/80 shadow-[0_0_12px_rgba(99,102,241,0.2)]'
                  : 'border-indigo-800/60 focus:border-indigo-500'
              }`}
            />
          </div>
          <button
            onClick={() => sendSearch(aiSearch)}
            disabled={aiLoading || !aiSearch.trim()}
            className="relative text-sm px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 border border-indigo-500 text-white transition-colors overflow-hidden flex-shrink-0"
          >
            {aiLoading && <span className="absolute inset-0 bg-indigo-400/20 animate-pulse" />}
            <span className="relative">{aiLoading ? '...' : conversation.length > 0 ? '追问' : '搜索'}</span>
          </button>
          {conversation.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-xs px-3 py-2.5 rounded-xl border border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors flex-shrink-0"
            >
              清空
            </button>
          )}
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`text-xs px-3 py-2.5 rounded-xl border transition-colors flex-shrink-0 ${
              showFilter ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600'
            }`}
          >
            {showFilter ? '收起 ▲' : '筛选 ▼'}
          </button>
        </div>

        {/* 示例提示词（仅无对话时显示，分类展示）*/}
        {conversation.length === 0 && !aiLoading && (
          <div className="flex gap-2 flex-wrap">
            {[
              'USDC 收益最高',
              'ETH APY 超过 5%',
              'Arbitrum Morpho',
              'Base 链稳定币',
              'TVL 最大的 vault',
              'APY 超过 20%',
            ].map(ex => (
              <button
                key={ex}
                onClick={() => sendSearch(ex)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-gray-900 border border-gray-800 text-gray-500 hover:text-indigo-300 hover:border-indigo-800/60 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 高级筛选栏（可折叠） */}
      {showFilter && (
        <VaultFilter value={filter} onChange={handleFilterChange} />
      )}

      {/* 资产快捷 Tab */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ASSET_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveAsset(tab.value)}
            className={`flex-shrink-0 text-xs font-medium px-4 py-1.5 rounded-full border transition-all ${
              activeAsset === tab.value
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 已加载数量 */}
      {!isLoading && allVaults.length > 0 && (
        <p className="text-xs text-gray-600">
          显示 {allVaults.length} 个{total ? ` / 共 ${total} 个` : ''}
        </p>
      )}

      {/* 加载中 */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 h-48 animate-pulse" />
          ))}
        </div>
      )}

      {/* 错误 */}
      {isError && (
        <div className="text-center py-16 text-red-400 text-sm">
          加载失败，请确认后端服务已启动（http://localhost:3000）
        </div>
      )}

      {/* 卡片网格 */}
      {allVaults.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allVaults.map((vault) => (
            <VaultCard
              key={`${vault.chainId}-${vault.address}`}
              vault={vault}
              chainName={chainNames[vault.chainId] ?? `Chain ${vault.chainId}`}
              onDeposit={(v, tab) => { setSelectedVault(v); setModalTab(tab ?? 'deposit') }}
              position={findPosition(vault, positions)}
            />
          ))}
        </div>
      )}

      {/* 无结果 */}
      {!isLoading && allVaults.length === 0 && !isError && (
        <div className="text-center py-20 text-gray-600 text-sm">
          没有符合条件的 Vault
        </div>
      )}

      {/* 滚动加载 sentinel */}
      <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-700">
        {isFetchingNextPage
          ? '加载中...'
          : hasNextPage
          ? '向下滚动加载更多'
          : allVaults.length > 0 ? '已加载全部' : ''}
      </div>

      {/* 存款/赎回弹窗 */}
      {selectedVault && (
        <DepositModal
          vault={selectedVault}
          onClose={() => setSelectedVault(null)}
          initialTab={modalTab}
          position={findPosition(selectedVault, positions)}
        />
      )}
    </div>
  )
}
