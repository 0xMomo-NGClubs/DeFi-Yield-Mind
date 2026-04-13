'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Vault, Position, getVaultHistory } from '@/lib/api'
import { ApySparkline } from './ApySparkline'

interface Props {
  vault: Vault
  chainName: string
  onDeposit: (vault: Vault, tab?: 'deposit' | 'redeem') => void
  position?: Position | null
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

// 数据更新时间（几分钟/小时前）
function timeAgo(iso: string | undefined) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}m 前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h 前`
  return `${Math.floor(hrs / 24)}d 前`
}

const PROTOCOL_COLORS: Record<string, string> = {
  'morpho-v1':       'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'aave-v3':         'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'euler-v2':        'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'pendle-v2':       'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'ethena':          'bg-green-500/20 text-green-300 border-green-500/30',
  'etherfi':         'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'ether.fi-stake':  'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'compound-v3':     'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}

function protocolColor(name: string) {
  return PROTOCOL_COLORS[name] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30'
}

const TAG_STYLES: Record<string, string> = {
  'stablecoin': 'bg-green-950/60 text-green-500 border-green-800/40',
  'single':     'bg-gray-800/80 text-gray-500 border-gray-700/40',
}

export function VaultCard({ vault, chainName, onDeposit, position }: Props) {

  const [hovered, setHovered] = useState(false)

  const { data: historyData } = useQuery({
    queryKey: ['history', vault.chainId, vault.address],
    queryFn: () => getVaultHistory(vault.chainId, vault.address),
    enabled: hovered,
    staleTime: 5 * 60 * 1000,
  })

  const apy = vault.analytics.apy.total
  const base = vault.analytics.apy.base
  const reward = vault.analytics.apy.reward
  const tvl = vault.analytics.tvl.usd
  const trend = apy != null && vault.analytics.apy7d != null
    ? apy >= vault.analytics.apy7d ? 'up' : 'down'
    : null

  const snapshots = historyData?.snapshots ?? []
  const hasHistory = snapshots.length >= 2
  const isInstant = vault.depositPacks?.some(p => p.stepsType === 'instant')
  const updated = timeAgo(vault.analytics.updatedAt)

  // 持仓收益计算
  const posBalanceUsd = position ? parseFloat(position.balanceUsd) : null
  const dailyEarn   = posBalanceUsd != null && apy != null ? posBalanceUsd * (apy / 100 / 365)      : null
  const monthlyEarn = posBalanceUsd != null && apy != null ? posBalanceUsd * (apy / 100 / 365 * 30) : null

  return (
    <div
      className="group relative bg-gray-900 border border-gray-800 rounded-2xl flex flex-col hover:border-gray-600 hover:bg-gray-800/50 hover:shadow-lg hover:shadow-black/30 transition-all duration-200"
      onMouseEnter={() => setHovered(true)}
    >
      {/* ── 顶部 ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        {/* 协议徽章 */}
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${protocolColor(vault.protocol.name)}`}>
          {vault.protocol.name}
        </span>

        {/* 右侧：链 + tags */}
        <div className="flex items-center gap-1.5">
          {vault.tags?.map(tag => (
            <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded border ${TAG_STYLES[tag] ?? 'bg-gray-800 text-gray-600 border-gray-700'}`}>
              {tag === 'stablecoin' ? '稳定币' : tag}
            </span>
          ))}
          <span className="text-[11px] text-gray-500 bg-gray-800/80 px-2 py-0.5 rounded-full">
            {chainName}
          </span>
        </div>
      </div>

      {/* ── 名称 + 代币 ── */}
      <div className="px-4 pt-3 pb-0">
        <h3 className="font-semibold text-white text-sm leading-snug line-clamp-1" title={vault.name}>
          {vault.name}
        </h3>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {vault.underlyingTokens.map((t) => (
            <span key={t.address} className="text-[11px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono border border-gray-700/50">
              {t.symbol}
            </span>
          ))}
        </div>
      </div>

      {/* ── APY 区 ── */}
      <div className="flex items-end justify-between px-4 pt-3 pb-0">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">APY</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-black tracking-tight ${(apy ?? 0) > 20 ? 'text-green-400' : 'text-white'}`}>
              {formatApy(apy)}
            </span>
            {trend === 'up'   && <span className="text-xs text-green-400 font-bold">↑</span>}
            {trend === 'down' && <span className="text-xs text-red-400 font-bold">↓</span>}
          </div>

          {/* APY 分拆 */}
          <div className="flex gap-2 mt-1">
            {base != null && base > 0 && (
              <span className="text-[10px] text-gray-500">
                基础 <span className="text-gray-400">{formatApy(base)}</span>
              </span>
            )}
            {reward != null && reward > 0 && (
              <span className="text-[10px] text-yellow-600">
                +奖励 <span className="text-yellow-500 font-medium">{formatApy(reward)}</span>
              </span>
            )}
          </div>

          {/* 7d 均值 */}
          {vault.analytics.apy7d != null && (
            <p className="text-[10px] text-gray-600 mt-0.5">7d 均 {formatApy(vault.analytics.apy7d)}</p>
          )}
        </div>

        {/* 折线图 */}
        <div className="flex flex-col items-end gap-0.5">
          {hasHistory ? (
            <>
              <ApySparkline mode="dynamic" snapshots={snapshots} width={80} height={32} />
              <span className="text-[9px] text-gray-700">{snapshots.length}个历史点</span>
            </>
          ) : (
            <ApySparkline
              apy30d={vault.analytics.apy30d}
              apy7d={vault.analytics.apy7d}
              apy1d={vault.analytics.apy1d}
              apyCurrent={apy}
              width={80}
              height={32}
            />
          )}
        </div>
      </div>

      {/* ── 分隔线 ── */}
      <div className="mx-4 mt-3 border-t border-gray-800/80" />

      {/* ── 持仓区（有仓位时展示）── */}
      {position && posBalanceUsd != null ? (
        <>
          <div className="mx-4 mt-3 rounded-xl bg-emerald-950/30 border border-emerald-800/30 p-3 space-y-2">
            {/* 标题行 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] font-semibold text-emerald-400">我的仓位</span>
              </div>
              <span className="text-[10px] text-gray-600">{position.asset.symbol}</span>
            </div>

            {/* 持仓金额 */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-lg font-black text-white">
                  ${posBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  ≈ {parseFloat(position.balanceNative).toFixed(4)} {position.asset.symbol}
                </p>
              </div>

              {/* 预期收益 */}
              <div className="text-right space-y-0.5">
                {dailyEarn != null && (
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-600">日收益</span>
                    <span className="text-[11px] font-semibold text-green-400">
                      +${dailyEarn.toFixed(dailyEarn < 0.01 ? 4 : 2)}
                    </span>
                  </div>
                )}
                {monthlyEarn != null && (
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-600">月收益</span>
                    <span className="text-[11px] font-semibold text-green-400">
                      +${monthlyEarn.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 持仓状态下的操作行 */}
          <div className="px-4 pt-2.5 pb-4 flex items-center gap-2">
            {vault.protocol.url && (
              <a
                href={vault.protocol.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[11px] text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                官网 ↗
              </a>
            )}
            {vault.isRedeemable && (
              <button
                onClick={() => onDeposit(vault, 'redeem')}
                className="flex-1 text-xs font-semibold bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-700/60 text-gray-300 hover:text-red-300 active:scale-95 py-1.5 rounded-lg transition-all"
              >
                赎回
              </button>
            )}
            {vault.isTransactional && (
              <button
                onClick={() => onDeposit(vault, 'deposit')}
                className="flex-1 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 active:scale-95 py-1.5 rounded-lg transition-all"
              >
                加仓 +
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* ── 无仓位：正常底部 meta + 操作 ── */}
          <div className="px-4 pt-2.5 pb-0 flex items-center gap-3 flex-wrap">
            <div>
              <p className="text-[10px] text-gray-600">TVL</p>
              <p className="text-xs font-semibold text-gray-300">{formatTvl(tvl)}</p>
            </div>
            <span className="text-gray-700">·</span>
            {isInstant && (
              <span className="text-[10px] text-indigo-400 bg-indigo-950/50 border border-indigo-800/40 px-1.5 py-0.5 rounded">
                ⚡ 即时
              </span>
            )}
            {vault.isRedeemable && (
              <span className="text-[10px] text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                ✓ 可赎回
              </span>
            )}
            {updated && (
              <span className="text-[10px] text-gray-700 ml-auto">{updated}</span>
            )}
          </div>

          <div className="px-4 pt-2.5 pb-4 flex items-center gap-2 mt-auto">
            {vault.protocol.url && (
              <a
                href={vault.protocol.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[11px] text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                官网 ↗
              </a>
            )}
            {vault.isTransactional ? (
              <button
                onClick={() => onDeposit(vault)}
                className="flex-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 active:scale-95 py-1.5 rounded-lg transition-all"
              >
                存款
              </button>
            ) : (
              <span className="flex-1 text-center text-[11px] text-gray-700">不支持存款</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
