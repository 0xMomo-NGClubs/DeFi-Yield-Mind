'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { getPortfolio, getVaults, getVaultDetail, getVaultHistory, Vault, Position } from '@/lib/api'
import { ApySparkline } from '@/components/ApySparkline'
import { DepositModal } from '@/components/DepositModal'
import { MigrateModal } from '@/components/MigrateModal'
import { VaultDetailModal } from '@/components/VaultDetailModal'

// ---- 常量 ----
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum', 10: 'Optimism', 56: 'BNB Chain', 100: 'Gnosis',
  137: 'Polygon', 250: 'Fantom', 8453: 'Base', 42161: 'Arbitrum',
  43114: 'Avalanche', 59144: 'Linea',
}
const PROTOCOL_COLORS: Record<string, string> = {
  'morpho-v1':   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'aave-v3':     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'euler-v2':    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'pendle-v2':   'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'ethena':      'bg-green-500/20 text-green-300 border-green-500/30',
  'compound-v3': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}

function chainName(id: number) { return CHAIN_NAMES[id] ?? `Chain ${id}` }
function protocolColor(name: string) { return PROTOCOL_COLORS[name] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30' }

function formatUsd(v: string | number) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (isNaN(n)) return '$--'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
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

// ---- 持仓卡片 ----
function PositionCard({
  pos,
  onDeposit,
  onMigrate,
  onShowDetail,
}: {
  pos: Position
  // 回调直接携带 pos，无需外层再次查找
  onDeposit: (vault: Vault, pos: Position, tab?: 'deposit' | 'redeem') => void
  onMigrate: (fromVault: Vault, toVault: Vault, pos: Position) => void
  onShowDetail: (vault: Vault, fromVault: Vault, pos: Position) => void
}) {
  // 如果后端精确匹配了 vaultAddress，直接查详情；否则按 chainId+asset 列表查然后匹配
  const hasVaultAddr = !!pos.vaultAddress

  // 精确查询：通过 vaultAddress 获取 vault 详情
  const { data: exactVault, isLoading: exactLoading } = useQuery({
    queryKey: ['vault-exact', pos.chainId, pos.vaultAddress],
    queryFn: () => getVaultDetail(pos.chainId, pos.vaultAddress!),
    enabled: hasVaultAddr,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    throwOnError: false,
  })

  // 降级查询：无 vaultAddress 时，按协议名模糊匹配（仅用于 LI.FI Earn 未精确索引的协议）
  const { data: vaultsData, isLoading: listLoading } = useQuery({
    queryKey: ['vault-match', pos.chainId, pos.asset.symbol],
    queryFn: () => getVaults({ chainId: pos.chainId, asset: pos.asset.symbol, sortBy: 'apy', limit: 30 }),
    enabled: !hasVaultAddr,
    staleTime: 5 * 60 * 1000,
  })

  const isLoading = hasVaultAddr ? exactLoading : listLoading

  // 精确模式：直接用 exactVault；降级模式：协议名匹配（有 vaultAddress 时跳过，避免误判）
  const matchedVault = useMemo(() => {
    if (hasVaultAddr) return exactVault ?? null
    if (!vaultsData) return null
    const p = pos.protocolName.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!p) return null
    return vaultsData.vaults.find(v => {
      const vp = v.protocol.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      return vp && (p.includes(vp) || vp.includes(p))
    }) ?? null
  }, [hasVaultAddr, exactVault, vaultsData, pos.protocolName])

  // 同链同资产中找更优金库（APY 高 0.5% 以上）
  const bestAlternative = useMemo(() => {
    if (!vaultsData || !matchedVault) return null
    const cur = matchedVault.analytics.apy.total ?? 0
    return vaultsData.vaults.find(
      v => v.address !== matchedVault.address && (v.analytics.apy.total ?? 0) > cur + 0.5
    ) ?? null
  }, [vaultsData, matchedVault])

  // 当降级模式且需要更优金库比较时，也要拉 vault 列表
  const { data: altVaultsData } = useQuery({
    queryKey: ['vault-alt', pos.chainId, pos.asset.symbol],
    queryFn: () => getVaults({ chainId: pos.chainId, asset: pos.asset.symbol, sortBy: 'apy', limit: 30 }),
    enabled: hasVaultAddr && !!matchedVault,
    staleTime: 5 * 60 * 1000,
  })

  const bestAlternativeExact = useMemo(() => {
    if (!hasVaultAddr || !matchedVault || !altVaultsData) return null
    const cur = matchedVault.analytics.apy.total ?? 0
    return altVaultsData.vaults.find(
      v => v.address !== matchedVault.address && (v.analytics.apy.total ?? 0) > cur + 0.5
    ) ?? null
  }, [hasVaultAddr, matchedVault, altVaultsData])

  const finalBestAlt = hasVaultAddr ? bestAlternativeExact : bestAlternative

  const { data: historyData } = useQuery({
    queryKey: ['history', matchedVault?.chainId, matchedVault?.address],
    queryFn: () => getVaultHistory(matchedVault!.chainId, matchedVault!.address),
    enabled: !!matchedVault,
    staleTime: 5 * 60 * 1000,
  })

  // skeleton
  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse flex flex-col gap-3 min-h-[280px]">
        <div className="flex justify-between">
          <div className="h-5 w-20 bg-gray-800 rounded-full" />
          <div className="h-5 w-14 bg-gray-800 rounded-full" />
        </div>
        <div className="h-4 w-36 bg-gray-800 rounded" />
        <div className="h-8 w-16 bg-gray-800 rounded" />
        <div className="mt-auto h-16 bg-gray-800/60 rounded-xl" />
        <div className="h-8 bg-gray-800/40 rounded-lg" />
      </div>
    )
  }

  // 协议未收录降级
  if (!matchedVault) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-3 min-h-[120px]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{pos.protocolName}</span>
          <span className="text-xs text-gray-600">{chainName(pos.chainId)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{pos.asset.symbol}</span>
          <span className="text-xs text-gray-600">协议暂未收录</span>
        </div>
        <p className="font-semibold text-white mt-auto">{formatUsd(pos.balanceUsd)}</p>
      </div>
    )
  }

  const v = matchedVault
  const apy = v.analytics.apy.total
  const base = v.analytics.apy.base
  const reward = v.analytics.apy.reward
  const tvl = v.analytics.tvl.usd
  const trend = apy != null && v.analytics.apy7d != null ? (apy >= v.analytics.apy7d ? 'up' : 'down') : null
  const isInstant = v.depositPacks?.some(p => p.stepsType === 'instant')
  const snapshots = historyData?.snapshots ?? []

  const balanceUsd = parseFloat(pos.balanceUsd)
  const dailyEarn   = apy != null ? balanceUsd * (apy / 100 / 365)      : null
  const monthlyEarn = apy != null ? balanceUsd * (apy / 100 / 365 * 30) : null

  const bestApy    = finalBestAlt?.analytics.apy.total ?? null
  const apyDiff    = bestApy != null && apy != null ? bestApy - apy : null
  const yearlyGain = apyDiff != null ? balanceUsd * (apyDiff / 100) : null

  return (
    <div className={`group relative bg-gray-900 border rounded-2xl flex flex-col hover:border-gray-600 hover:bg-gray-800/50 hover:shadow-lg hover:shadow-black/30 transition-all duration-200 ${
      finalBestAlt ? 'border-yellow-800/40' : 'border-gray-800'
    }`}>
      {finalBestAlt && (
        <div className="absolute top-0 inset-x-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-yellow-600/0 via-yellow-500/70 to-yellow-600/0" />
      )}

      {/* 协议 + 链 + tags */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${protocolColor(v.protocol.name)}`}>
          {v.protocol.name}
        </span>
        <div className="flex items-center gap-1.5">
          {v.tags?.map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800/80 text-gray-500 border-gray-700/40">
              {tag === 'stablecoin' ? '稳定币' : tag}
            </span>
          ))}
          <span className="text-[11px] text-gray-500 bg-gray-800/80 px-2 py-0.5 rounded-full">
            {chainName(v.chainId)}
          </span>
        </div>
      </div>

      {/* 名称 + 代币 */}
      <div className="px-4 pt-2.5 pb-0">
        <h3 className="font-semibold text-white text-sm line-clamp-1" title={v.name}>{v.name}</h3>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {v.underlyingTokens.map(t => (
            <span key={t.address} className="text-[11px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono border border-gray-700/50">
              {t.symbol}
            </span>
          ))}
        </div>
      </div>

      {/* APY + 折线图 */}
      <div className="px-4 pt-2.5 pb-0 flex items-end justify-between">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">APY</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-black tracking-tight ${(apy ?? 0) > 20 ? 'text-green-400' : 'text-white'}`}>
              {formatApy(apy)}
            </span>
            {trend === 'up'   && <span className="text-xs text-green-400 font-bold">↑</span>}
            {trend === 'down' && <span className="text-xs text-red-400 font-bold">↓</span>}
          </div>
          <div className="flex gap-2 mt-0.5">
            {base != null && base > 0 && (
              <span className="text-[10px] text-gray-500">基础 <span className="text-gray-400">{formatApy(base)}</span></span>
            )}
            {reward != null && reward > 0 && (
              <span className="text-[10px] text-yellow-600">+奖励 <span className="text-yellow-500">{formatApy(reward)}</span></span>
            )}
          </div>
          {v.analytics.apy7d != null && (
            <p className="text-[10px] text-gray-600 mt-0.5">7d 均 {formatApy(v.analytics.apy7d)}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {snapshots.length >= 2
            ? <ApySparkline mode="dynamic" snapshots={snapshots} width={80} height={32} />
            : <ApySparkline apy30d={v.analytics.apy30d} apy7d={v.analytics.apy7d} apy1d={v.analytics.apy1d} apyCurrent={apy} width={80} height={32} />
          }
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-600">TVL</span>
            <span className="text-[11px] font-semibold text-gray-400">{formatTvl(tvl)}</span>
            {isInstant && (
              <span className="text-[10px] text-indigo-400 bg-indigo-950/50 border border-indigo-800/40 px-1 py-0.5 rounded">⚡</span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-4 mt-3 border-t border-gray-800/80" />

      {/* 我的仓位 */}
      <div className="mx-4 mt-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/30 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-emerald-400">我的仓位</span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xl font-black text-white">{formatUsd(pos.balanceUsd)}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              ≈ {parseFloat(pos.balanceNative).toFixed(4)} {pos.asset.symbol}
            </p>
          </div>
          <div className="text-right space-y-0.5">
            {dailyEarn != null && (
              <p className="text-[10px] text-gray-600">日 <span className="text-green-400 font-medium">+${dailyEarn.toFixed(dailyEarn < 0.01 ? 4 : 2)}</span></p>
            )}
            {monthlyEarn != null && (
              <p className="text-[10px] text-gray-600">月 <span className="text-green-400 font-medium">+${monthlyEarn.toFixed(2)}</span></p>
            )}
          </div>
        </div>
      </div>

      {/* 更优机会 */}
      {finalBestAlt && (
        <div className="mx-4 mt-2 rounded-xl border border-yellow-700/50 bg-yellow-950/30 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-900/25 border-b border-yellow-800/30">
            <span className="text-yellow-400 text-[11px]">💡</span>
            <span className="text-[11px] font-semibold text-yellow-300 tracking-wide">更优选择</span>
            <div className="flex items-center gap-1 ml-auto">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${protocolColor(finalBestAlt.protocol.name)}`}>
                {finalBestAlt.protocol.name}
              </span>
            </div>
          </div>
          <div className="px-3 pt-2.5 pb-2">
            <p className="text-[10px] text-gray-600 truncate mb-2">{finalBestAlt.name}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 text-center bg-gray-900/60 rounded-lg py-2">
                <p className="text-[9px] text-gray-600 mb-0.5">当前</p>
                <p className="text-base font-bold text-gray-400">{formatApy(apy)}</p>
              </div>
              <div className="flex flex-col items-center gap-0.5 px-0.5">
                <span className="text-yellow-500 text-base leading-none">→</span>
                {apyDiff != null && (
                  <span className="text-[9px] font-bold text-yellow-500">+{apyDiff.toFixed(2)}%</span>
                )}
              </div>
              <div className="flex-1 text-center bg-yellow-900/40 border border-yellow-700/50 rounded-lg py-2">
                <p className="text-[9px] text-yellow-700 mb-0.5">更优</p>
                <p className="text-base font-bold text-yellow-300">{formatApy(bestApy)}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 pb-3">
            {yearlyGain != null && yearlyGain > 0.01 && (
              <p className="text-[10px] text-yellow-700 flex-1">
                预计多赚 <span className="text-yellow-500 font-semibold">{formatUsd(yearlyGain.toFixed(0))}/yr</span>
              </p>
            )}
            <div className="flex gap-1.5 ml-auto">
              <button
                onClick={() => onShowDetail(finalBestAlt, v, pos)}
                className="text-xs font-medium border border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/40 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
              >
                详情
              </button>
              <button
                onClick={() => onMigrate(v, finalBestAlt, pos)}
                className="text-xs font-semibold bg-yellow-600 hover:bg-yellow-500 active:scale-95 text-black px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
              >
                迁移 →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="px-4 pt-2.5 pb-4 mt-auto flex items-center gap-2">
        {v.protocol.url && (
          <a href={v.protocol.url} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors">
            官网 ↗
          </a>
        )}
        {v.isRedeemable && (
          <button onClick={() => onDeposit(v, pos, 'redeem')}
            className="flex-1 text-xs font-semibold bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-700/60 text-gray-300 hover:text-red-300 active:scale-95 py-1.5 rounded-lg transition-all">
            赎回
          </button>
        )}
        {v.isTransactional && (
          <button onClick={() => onDeposit(v, pos, 'deposit')}
            className="flex-1 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 active:scale-95 py-1.5 rounded-lg transition-all">
            加仓 +
          </button>
        )}
      </div>
    </div>
  )
}

// ---- 主页面 ----
export default function PortfolioPage() {
  const { address: connectedAddress } = useAccount()
  const [inputAddress, setInputAddress] = useState('')
  const [mounted, setMounted] = useState(false)

  // 弹窗状态：直接携带 pos，无需再次 matchProtocol 搜索
  const [selectedVault, setSelectedVault] = useState<Vault | null>(null)
  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [modalTab, setModalTab] = useState<'deposit' | 'redeem'>('deposit')
  const [migrateFrom, setMigrateFrom] = useState<Vault | null>(null)
  const [migrateTo, setMigrateTo] = useState<Vault | null>(null)
  const [migratePos, setMigratePos] = useState<Position | null>(null)
  const [detailVault, setDetailVault] = useState<Vault | null>(null)
  const [detailFromVault, setDetailFromVault] = useState<Vault | null>(null)
  const [detailPos, setDetailPos] = useState<Position | undefined>(undefined)

  useEffect(() => { setMounted(true) }, [])

  const wallet =
    connectedAddress || (inputAddress.match(/^0x[0-9a-fA-F]{40}$/) ? inputAddress : '')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['portfolio', wallet],
    queryFn: () => getPortfolio(wallet),
    enabled: !!wallet,
  })

  // 回调直接携带 pos，彻底避免二次 matchProtocol 匹配
  function handleDeposit(vault: Vault, pos: Position, tab?: 'deposit' | 'redeem') {
    setSelectedVault(vault)
    setSelectedPos(pos)
    setModalTab(tab ?? 'deposit')
  }
  function handleMigrate(fromVault: Vault, toVault: Vault, pos: Position) {
    setMigrateFrom(fromVault)
    setMigrateTo(toVault)
    setMigratePos(pos)
  }
  function handleShowDetail(vault: Vault, fromVault: Vault, pos: Position) {
    setDetailVault(vault)
    setDetailFromVault(fromVault)
    setDetailPos(pos)
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-950/60 via-gray-900 to-gray-900 border border-blue-900/30 px-6 py-5">
        <h1 className="text-2xl font-bold text-white mb-1">我的持仓</h1>
        <p className="text-gray-400 text-sm">查看所有 DeFi 持仓详情，直接加仓、赎回，或一键迁移到更优 Vault</p>
      </div>

      {/* 地址输入 / 连接状态 */}
      {mounted && (
        <>
          {!connectedAddress && (
            <div className="flex gap-2">
              <input
                type="text"
                value={inputAddress}
                onChange={e => setInputAddress(e.target.value)}
                placeholder="输入钱包地址（0x...）"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={async () => {
                  const text = await navigator.clipboard.readText()
                  setInputAddress(text.trim())
                }}
                className="px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
              >
                粘贴
              </button>
            </div>
          )}
          {connectedAddress && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="w-2 h-2 bg-green-400 rounded-full" />
              已连接钱包：<span className="font-mono text-gray-300">{connectedAddress}</span>
            </div>
          )}
        </>
      )}

      {wallet && isLoading && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse">
            <div className="h-3 w-20 bg-gray-800 rounded mb-3" />
            <div className="h-8 w-36 bg-gray-800 rounded" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 h-72 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 text-sm rounded-xl p-4">
          {error instanceof Error ? error.message : '查询失败'}
        </div>
      )}

      {mounted && !wallet && (
        <div className="text-center py-16 text-gray-600 text-sm">请连接钱包或输入地址</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400 mb-1">总持仓价值</p>
              <p className="text-3xl font-bold text-white">{formatUsd(data.totalUsd)}</p>
            </div>
            <p className="text-sm text-gray-500">{data.positions.length} 个仓位</p>
          </div>

          {data.positions.length === 0 ? (
            <div className="text-center py-16 text-gray-500 text-sm">该地址暂无持仓记录</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.positions.map((pos, i) => (
                <PositionCard
                  key={`${pos.chainId}-${pos.vaultAddress ?? pos.protocolName}-${i}`}
                  pos={pos}
                  onDeposit={handleDeposit}
                  onMigrate={handleMigrate}
                  onShowDetail={handleShowDetail}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedVault && selectedPos && (
        <DepositModal
          vault={selectedVault}
          onClose={() => { setSelectedVault(null); setSelectedPos(null) }}
          initialTab={modalTab}
          position={selectedPos}
        />
      )}

      {migrateFrom && migrateTo && migratePos && (
        <MigrateModal
          fromVault={migrateFrom}
          toVault={migrateTo}
          position={migratePos}
          onClose={() => { setMigrateFrom(null); setMigrateTo(null); setMigratePos(null) }}
        />
      )}

      {detailVault && detailFromVault && (
        <VaultDetailModal
          vault={detailVault}
          currentVault={detailFromVault}
          position={detailPos}
          onClose={() => { setDetailVault(null); setDetailFromVault(null); setDetailPos(undefined) }}
          onMigrate={() => detailPos && handleMigrate(detailFromVault, detailVault, detailPos)}
        />
      )}
    </div>
  )
}
