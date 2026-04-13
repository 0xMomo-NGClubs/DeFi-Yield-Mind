'use client'

import { useQuery } from '@tanstack/react-query'
import { getVaultHistory, Vault, Position } from '@/lib/api'
import { ApySparkline } from './ApySparkline'

interface Props {
  vault: Vault               // 要展示的金库
  currentVault?: Vault       // 当前持仓金库（用于对比，可选）
  position?: Position        // 当前持仓（用于计算收益，可选）
  onClose: () => void
  onMigrate?: () => void     // 从 portfolio 打开时显示迁移按钮
  onDeposit?: () => void     // 普通存款按钮
}

const PROTOCOL_COLORS: Record<string, string> = {
  'morpho-v1':   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'aave-v3':     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'euler-v2':    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'pendle-v2':   'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'ethena':      'bg-green-500/20 text-green-300 border-green-500/30',
  'compound-v3': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum', 10: 'Optimism', 56: 'BNB Chain', 100: 'Gnosis',
  137: 'Polygon', 8453: 'Base', 42161: 'Arbitrum', 43114: 'Avalanche', 59144: 'Linea',
}

function protocolColor(name: string) {
  return PROTOCOL_COLORS[name] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30'
}
function chainName(id: number) { return CHAIN_NAMES[id] ?? `Chain ${id}` }
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
function formatUsd(v: number) {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// APY 历史均值
function avgApy(snaps: { apy: number | null }[], days: number) {
  const recent = snaps.slice(-days).filter(s => s.apy != null)
  if (recent.length === 0) return null
  return recent.reduce((s, p) => s + p.apy!, 0) / recent.length
}

export function VaultDetailModal({ vault, currentVault, position, onClose, onMigrate, onDeposit }: Props) {
  const apy    = vault.analytics.apy.total
  const base   = vault.analytics.apy.base
  const reward = vault.analytics.apy.reward
  const tvl    = vault.analytics.tvl.usd

  const currentApy = currentVault?.analytics.apy.total ?? null
  const apyDiff    = apy != null && currentApy != null ? apy - currentApy : null
  const posUsd     = position ? parseFloat(position.balanceUsd) : null
  const yearlyGain = apyDiff != null && posUsd != null ? posUsd * (apyDiff / 100) : null

  const isInstant   = vault.depositPacks?.some(p => p.stepsType === 'instant')
  const trend       = apy != null && vault.analytics.apy7d != null
    ? apy >= vault.analytics.apy7d ? 'up' : 'down'
    : null

  // 历史 APY
  const { data: historyData, isLoading: histLoading } = useQuery({
    queryKey: ['history', vault.chainId, vault.address],
    queryFn: () => getVaultHistory(vault.chainId, vault.address, 90),
    staleTime: 5 * 60 * 1000,
  })
  const snapshots = historyData?.snapshots ?? []
  const avg7d  = avgApy(snapshots, 7)
  const avg30d = avgApy(snapshots, 30)

  const dailyEarn   = posUsd != null && apy != null ? posUsd * (apy / 100 / 365)      : null
  const monthlyEarn = posUsd != null && apy != null ? posUsd * (apy / 100 / 365 * 30) : null

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* ── 头部 ── */}
        <div className="flex items-start justify-between px-5 pt-5 pb-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${protocolColor(vault.protocol.name)}`}>
              {vault.protocol.name}
            </span>
            {vault.tags?.map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700/50">
                {tag === 'stablecoin' ? '稳定币' : tag}
              </span>
            ))}
            <span className="text-[11px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
              {chainName(vault.chainId)}
            </span>
            {isInstant && (
              <span className="text-[10px] text-indigo-400 bg-indigo-950/50 border border-indigo-800/40 px-1.5 py-0.5 rounded">
                ⚡ 即时
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none ml-3 flex-shrink-0">×</button>
        </div>

        {/* ── 名称 + 代币 ── */}
        <div className="px-5 pt-3">
          <h2 className="font-bold text-white text-base leading-snug">{vault.name}</h2>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {vault.underlyingTokens.map(t => (
              <span key={t.address} className="text-[11px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono border border-gray-700/50">
                {t.symbol}
              </span>
            ))}
          </div>
        </div>

        <div className="px-5 pt-4 space-y-4 pb-5">

          {/* ── APY 大卡 ── */}
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">APY</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-4xl font-black tracking-tight ${(apy ?? 0) > 20 ? 'text-green-400' : 'text-white'}`}>
                    {formatApy(apy)}
                  </span>
                  {trend === 'up'   && <span className="text-sm text-green-400 font-bold">↑</span>}
                  {trend === 'down' && <span className="text-sm text-red-400 font-bold">↓</span>}
                </div>
                <div className="flex gap-3 mt-1.5 flex-wrap">
                  {base != null && base > 0 && (
                    <span className="text-xs text-gray-500">基础 <span className="text-gray-300">{formatApy(base)}</span></span>
                  )}
                  {reward != null && reward > 0 && (
                    <span className="text-xs text-yellow-600">+奖励 <span className="text-yellow-400 font-medium">{formatApy(reward)}</span></span>
                  )}
                </div>
              </div>

              {/* 折线图 */}
              <div className="flex flex-col items-end gap-1">
                {histLoading ? (
                  <div className="w-24 h-10 bg-gray-800 rounded animate-pulse" />
                ) : snapshots.length >= 2 ? (
                  <ApySparkline mode="dynamic" snapshots={snapshots} width={120} height={44} />
                ) : (
                  <ApySparkline
                    apy30d={vault.analytics.apy30d}
                    apy7d={vault.analytics.apy7d}
                    apy1d={vault.analytics.apy1d}
                    apyCurrent={apy}
                    width={120} height={44}
                  />
                )}
                <span className="text-[9px] text-gray-700">
                  {snapshots.length >= 2 ? `${snapshots.length} 个历史点` : 'APY 趋势'}
                </span>
              </div>
            </div>

            {/* 历史均值 */}
            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-700/50">
              {[
                { label: '1d 均值', v: vault.analytics.apy1d ?? avg7d },
                { label: '7d 均值', v: vault.analytics.apy7d ?? avg7d },
                { label: '30d 均值', v: vault.analytics.apy30d ?? avg30d },
              ].map(({ label, v }) => (
                <div key={label} className="text-center">
                  <p className="text-[9px] text-gray-600 mb-0.5">{label}</p>
                  <p className="text-xs font-semibold text-gray-300">{formatApy(v)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── 统计数据 ── */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">TVL</p>
              <p className="text-sm font-bold text-white">{formatTvl(tvl)}</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">可赎回</p>
              <p className="text-sm font-bold">
                {vault.isRedeemable
                  ? <span className="text-emerald-400">✓ 是</span>
                  : <span className="text-gray-600">否</span>
                }
              </p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">存款方式</p>
              <p className="text-sm font-bold text-white">
                {vault.depositPacks?.length > 0
                  ? `${vault.depositPacks.length} 种`
                  : <span className="text-gray-600">--</span>
                }
              </p>
            </div>
          </div>

          {/* ── 与当前持仓对比 ── */}
          {currentVault && (
            <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-xl p-4">
              <p className="text-[11px] font-semibold text-yellow-400 mb-3">与当前持仓对比</p>

              <div className="flex items-stretch gap-2">
                {/* 当前 */}
                <div className="flex-1 bg-gray-900/60 rounded-xl p-3">
                  <p className="text-[10px] text-gray-600 mb-1">当前持仓</p>
                  <p className="text-[11px] text-gray-500 font-medium truncate mb-2">{currentVault.protocol.name}</p>
                  <p className="text-xl font-black text-gray-400">{formatApy(currentApy)}</p>
                  {posUsd != null && (
                    <p className="text-[10px] text-gray-600 mt-1">持仓 {formatUsd(posUsd)}</p>
                  )}
                </div>

                {/* 箭头 + 差值 */}
                <div className="flex flex-col items-center justify-center gap-1 px-1">
                  <span className="text-yellow-500 text-lg">→</span>
                  {apyDiff != null && (
                    <span className="text-xs font-bold text-yellow-400 whitespace-nowrap">+{apyDiff.toFixed(2)}%</span>
                  )}
                </div>

                {/* 目标 */}
                <div className="flex-1 bg-yellow-900/30 border border-yellow-700/40 rounded-xl p-3">
                  <p className="text-[10px] text-yellow-700 mb-1">迁移目标</p>
                  <p className="text-[11px] text-yellow-500 font-medium truncate mb-2">{vault.protocol.name}</p>
                  <p className="text-xl font-black text-yellow-300">{formatApy(apy)}</p>
                  {dailyEarn != null && (
                    <p className="text-[10px] text-yellow-700 mt-1">日 +${dailyEarn.toFixed(dailyEarn < 0.01 ? 4 : 2)}</p>
                  )}
                </div>
              </div>

              {/* 年化收益提升 */}
              {yearlyGain != null && yearlyGain > 0.01 && (
                <div className="mt-3 pt-3 border-t border-yellow-800/30 flex items-center justify-between">
                  <span className="text-xs text-yellow-700">迁移后年化预计多赚</span>
                  <span className="text-sm font-bold text-yellow-400">{formatUsd(yearlyGain)}</span>
                </div>
              )}
              {monthlyEarn != null && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-yellow-800">月收益预估</span>
                  <span className="text-xs font-semibold text-yellow-600">+{formatUsd(monthlyEarn)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── 合约地址 ── */}
          <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700/40 rounded-xl px-3 py-2">
            <span className="text-[10px] text-gray-600">合约地址</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-mono">
                {vault.address.slice(0, 10)}...{vault.address.slice(-8)}
              </span>
              {vault.protocol.url && (
                <a
                  href={vault.protocol.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  官网 ↗
                </a>
              )}
            </div>
          </div>

          {/* ── 操作按钮 ── */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 text-sm font-medium bg-gray-800 hover:bg-gray-700 border border-gray-700 py-2.5 rounded-xl transition-all"
            >
              关闭
            </button>
            {onMigrate && (
              <button
                onClick={() => { onClose(); onMigrate() }}
                className="flex-[2] text-sm font-semibold bg-yellow-600 hover:bg-yellow-500 active:scale-[0.98] text-black py-2.5 rounded-xl transition-all"
              >
                一键迁移 →
              </button>
            )}
            {onDeposit && !onMigrate && (
              <button
                onClick={() => { onClose(); onDeposit() }}
                className="flex-[2] text-sm font-semibold bg-blue-600 hover:bg-blue-500 active:scale-[0.98] py-2.5 rounded-xl transition-all"
              >
                存款
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
