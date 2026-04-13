'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVaults, Vault } from '@/lib/api'

const TOKENS = ['USDC', 'USDT', 'ETH', 'WBTC', 'DAI', 'WETH']

function formatApy(v: number | null | undefined) {
  if (v == null) return '--'
  return `${v.toFixed(2)}%`
}

function formatTvl(usd: string) {
  const n = parseFloat(usd)
  if (isNaN(n)) return '--'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

interface ChainBest {
  chainId: number
  chainName: string
  vault: Vault
  apy: number
}

export default function ComparePage() {
  const [selectedToken, setSelectedToken] = useState('USDC')

  // 加载该 token 的所有 vaults（分页获取全量）
  const { data, isLoading } = useQuery({
    queryKey: ['compare', selectedToken],
    queryFn: async () => {
      const results: Vault[] = []
      let cursor: string | undefined = undefined
      // 最多拉取 5 页，避免过多请求
      for (let i = 0; i < 5; i++) {
        const page = await getVaults({ asset: selectedToken, sortBy: 'apy', limit: 100, cursor })
        results.push(...page.vaults)
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      return results
    },
    staleTime: 2 * 60 * 1000,
  })

  // 加载链名称
  const { data: chainsRaw } = useQuery({
    queryKey: ['chains'],
    queryFn: () => fetch('http://localhost:3000/chains').then(r => r.json()),
    staleTime: Infinity,
  })
  const chainNames: Record<number, string> = useMemo(() => {
    const arr = (chainsRaw?.chains ?? []) as { chainId: number; name: string }[]
    return Object.fromEntries(arr.map(c => [c.chainId, c.name]))
  }, [chainsRaw])

  // 每条链取 APY 最高的 vault
  const chainBests: ChainBest[] = useMemo(() => {
    if (!data) return []
    const byChain = new Map<number, Vault>()
    for (const v of data) {
      if (v.analytics.apy.total == null) continue
      const cur = byChain.get(v.chainId)
      if (!cur || (cur.analytics.apy.total ?? 0) < v.analytics.apy.total) {
        byChain.set(v.chainId, v)
      }
    }
    return Array.from(byChain.entries())
      .map(([chainId, vault]) => ({
        chainId,
        chainName: chainNames[chainId] ?? `Chain ${chainId}`,
        vault,
        apy: vault.analytics.apy.total!,
      }))
      .sort((a, b) => b.apy - a.apy)
  }, [data, chainNames])

  const maxApy = chainBests.length > 0 ? chainBests[0].apy : 0

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-950/60 via-gray-900 to-gray-900 border border-purple-900/30 px-6 py-5">
        <h1 className="text-2xl font-bold text-white mb-1">跨链收益比较器</h1>
        <p className="text-gray-400 text-sm">选择代币，对比各链最优 APY，找到最佳存款机会</p>
      </div>

      {/* 代币选择 */}
      <div className="flex gap-2 flex-wrap">
        {TOKENS.map(token => (
          <button
            key={token}
            onClick={() => setSelectedToken(token)}
            className={`px-5 py-2 rounded-xl font-medium text-sm transition-all border ${
              selectedToken === token
                ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/30'
                : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            }`}
          >
            {token}
          </button>
        ))}
      </div>

      {/* 加载中 */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-900 border border-gray-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {/* 比较结果 */}
      {!isLoading && chainBests.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            共找到 {chainBests.length} 条链有 {selectedToken} vault，显示每链最优
          </p>

          {/* 图表区 */}
          <div className="space-y-3">
            {chainBests.map((item, idx) => {
              const barWidth = maxApy > 0 ? (item.apy / maxApy) * 100 : 0
              const isTop = idx === 0

              return (
                <div
                  key={item.chainId}
                  className={`rounded-2xl border p-4 transition-all ${
                    isTop
                      ? 'bg-gradient-to-r from-purple-950/50 via-gray-900 to-gray-900 border-purple-700/50'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* 排名 */}
                    <div className="w-8 text-center">
                      {idx === 0 && <span className="text-lg">🥇</span>}
                      {idx === 1 && <span className="text-lg">🥈</span>}
                      {idx === 2 && <span className="text-lg">🥉</span>}
                      {idx > 2 && (
                        <span className="text-xs text-gray-600 font-mono">#{idx + 1}</span>
                      )}
                    </div>

                    {/* 链名 */}
                    <div className="w-32 flex-shrink-0">
                      <p className="text-sm font-medium text-white truncate">{item.chainName}</p>
                      <p className="text-xs text-gray-500 truncate">{item.vault.protocol.name}</p>
                    </div>

                    {/* 横向柱状图 */}
                    <div className="flex-1 flex items-center gap-3">
                      <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isTop
                              ? 'bg-gradient-to-r from-purple-500 to-purple-400'
                              : 'bg-gradient-to-r from-blue-600 to-blue-500'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className={`text-base font-bold w-20 text-right ${isTop ? 'text-purple-300' : 'text-white'}`}>
                        {formatApy(item.apy)}
                      </span>
                    </div>

                    {/* TVL */}
                    <div className="w-24 text-right flex-shrink-0">
                      <p className="text-xs text-gray-500">TVL</p>
                      <p className="text-sm text-gray-300">{formatTvl(item.vault.analytics.tvl.usd)}</p>
                    </div>
                  </div>

                  {/* Vault 名（仅 top3 展示） */}
                  {idx < 3 && (
                    <div className="mt-2 pl-12">
                      <p className="text-xs text-gray-500 truncate">{item.vault.name}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {item.vault.underlyingTokens.map(t => (
                          <span key={t.address} className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">
                            {t.symbol}
                          </span>
                        ))}
                        {item.vault.analytics.apy.reward != null && item.vault.analytics.apy.reward > 0 && (
                          <span className="text-[10px] bg-yellow-900/40 text-yellow-400 border border-yellow-700/40 px-1.5 py-0.5 rounded">
                            +奖励 {item.vault.analytics.apy.reward.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 摘要统计 */}
          <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-800">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">最高 APY</p>
              <p className="text-2xl font-black text-purple-300">{formatApy(chainBests[0]?.apy)}</p>
              <p className="text-xs text-gray-600 mt-1">{chainBests[0]?.chainName}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">平均 APY</p>
              <p className="text-2xl font-black text-white">
                {chainBests.length > 0
                  ? formatApy(chainBests.reduce((s, c) => s + c.apy, 0) / chainBests.length)
                  : '--'}
              </p>
              <p className="text-xs text-gray-600 mt-1">{chainBests.length} 条链</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">最高 TVL</p>
              <p className="text-2xl font-black text-blue-300">
                {formatTvl(
                  chainBests.reduce((best, c) => {
                    const n = parseFloat(c.vault.analytics.tvl.usd)
                    return n > parseFloat(best) ? c.vault.analytics.tvl.usd : best
                  }, '0')
                )}
              </p>
              <p className="text-xs text-gray-600 mt-1">单 Vault</p>
            </div>
          </div>
        </div>
      )}

      {/* 无结果 */}
      {!isLoading && chainBests.length === 0 && (
        <div className="text-center py-20 text-gray-600 text-sm">
          未找到 {selectedToken} 的跨链 Vault 数据
        </div>
      )}
    </div>
  )
}
