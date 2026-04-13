'use client'

import { Vault } from '@/lib/api'
import { ApySparkline } from './ApySparkline'

interface Props {
  vault: Vault
  chainName: string
  rank: number
  onDeposit: (vault: Vault) => void
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

const RANK_STYLES = [
  { border: 'border-yellow-600/50', glow: 'shadow-yellow-900/30', from: 'from-yellow-900/30' },
  { border: 'border-slate-500/50',  glow: 'shadow-slate-900/30',  from: 'from-slate-700/20' },
  { border: 'border-amber-700/50',  glow: 'shadow-amber-900/30',  from: 'from-amber-900/20' },
]

const RANK_EMOJIS = ['🥇', '🥈', '🥉']

export function FeaturedVaultCard({ vault, chainName, rank, onDeposit }: Props) {
  const apy = vault.analytics.apy.total
  const base = vault.analytics.apy.base
  const reward = vault.analytics.apy.reward
  const style = RANK_STYLES[rank] ?? { border: 'border-gray-700/50', glow: 'shadow-black/20', from: 'from-gray-800/20' }
  const trend = apy != null && vault.analytics.apy7d != null
    ? apy >= vault.analytics.apy7d ? 'up' : 'down'
    : null
  const isInstant = vault.depositPacks?.some(p => p.stepsType === 'instant')
  const updated = timeAgo(vault.analytics.updatedAt)

  return (
    <div
      className={`relative bg-gradient-to-b ${style.from} via-gray-900 to-gray-900 border ${style.border} rounded-2xl flex flex-col shadow-lg ${style.glow} hover:scale-[1.02] hover:shadow-xl transition-all duration-200 cursor-pointer`}
      onClick={() => vault.isTransactional && onDeposit(vault)}
    >
      {/* 排名角标 */}
      <div className="absolute top-3 right-3 text-xl select-none">{RANK_EMOJIS[rank] ?? `#${rank + 1}`}</div>

      {/* ── 顶部：协议 + 链 ── */}
      <div className="px-4 pt-4 pr-10 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-gray-400 bg-gray-800/80 px-2 py-0.5 rounded-full border border-gray-700/50">
          {vault.protocol.name}
        </span>
        <span className="text-[11px] text-gray-600">{chainName}</span>
        {vault.tags?.includes('stablecoin') && (
          <span className="text-[10px] text-green-600 bg-green-950/40 border border-green-900/40 px-1.5 py-0.5 rounded">
            稳定币
          </span>
        )}
      </div>

      {/* ── 名称 + 代币 ── */}
      <div className="px-4 pt-2.5">
        <p className="text-sm font-semibold text-white line-clamp-1 leading-snug" title={vault.name}>
          {vault.name}
        </p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {vault.underlyingTokens.map((t) => (
            <span key={t.address} className="text-[11px] bg-gray-800/80 text-gray-300 px-1.5 py-0.5 rounded font-mono border border-gray-700/40">
              {t.symbol}
            </span>
          ))}
        </div>
      </div>

      {/* ── APY ── */}
      <div className="flex items-end justify-between px-4 pt-3">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">当前 APY</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-3xl font-black tracking-tight ${(apy ?? 0) > 20 ? 'text-green-400' : 'text-white'}`}>
              {formatApy(apy)}
            </span>
            {trend === 'up'   && <span className="text-sm text-green-400 font-bold">↑</span>}
            {trend === 'down' && <span className="text-sm text-red-400 font-bold">↓</span>}
          </div>

          {/* APY 分拆 */}
          <div className="flex gap-2 mt-0.5">
            {base != null && base > 0 && (
              <span className="text-[10px] text-gray-500">
                基础 <span className="text-gray-400">{formatApy(base)}</span>
              </span>
            )}
            {reward != null && reward > 0 && (
              <span className="text-[10px] text-yellow-600">
                +奖励 <span className="text-yellow-400 font-medium">{formatApy(reward)}</span>
              </span>
            )}
          </div>
        </div>
        <ApySparkline
          apy30d={vault.analytics.apy30d}
          apy7d={vault.analytics.apy7d}
          apy1d={vault.analytics.apy1d}
          apyCurrent={apy}
          width={72}
          height={36}
        />
      </div>

      {/* ── 分隔线 ── */}
      <div className="mx-4 mt-3 border-t border-white/5" />

      {/* ── meta 信息行 ── */}
      <div className="px-4 pt-2.5 flex items-center gap-2 flex-wrap">
        <div>
          <p className="text-[10px] text-gray-600">TVL</p>
          <p className="text-xs font-semibold text-gray-300">{formatTvl(vault.analytics.tvl.usd)}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
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
        </div>
      </div>

      {/* ── 操作行 ── */}
      <div className="px-4 pt-2 pb-4 flex gap-2">
        {vault.protocol.url && (
          <a
            href={vault.protocol.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[11px] text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            官网 ↗
          </a>
        )}
        {vault.isTransactional && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeposit(vault) }}
            className="flex-1 py-1.5 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white"
          >
            立即存款 →
          </button>
        )}
      </div>

      {/* 更新时间水印 */}
      {updated && (
        <div className="absolute bottom-2 right-3 text-[9px] text-gray-700 pointer-events-none">
          {updated}
        </div>
      )}
    </div>
  )
}
