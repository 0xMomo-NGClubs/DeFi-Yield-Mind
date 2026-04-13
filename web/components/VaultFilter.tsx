'use client'

import { useEffect, useState } from 'react'
import { getChains, getProtocols } from '@/lib/api'

interface FilterState {
  chainId: string
  asset: string
  protocol: string
  minApy: string
  sortBy: string
}

interface Props {
  value: FilterState
  onChange: (f: FilterState) => void
}

export function VaultFilter({ value, onChange }: Props) {
  const [chains, setChains] = useState<{ chainId: number; name: string }[]>([])
  const [protocols, setProtocols] = useState<{ name: string }[]>([])

  useEffect(() => {
    getChains().then((r) => setChains((r.chains as { chainId: number; name: string }[]) ?? [])).catch(() => {})
    getProtocols().then((r) => setProtocols((r.protocols as { name: string }[]) ?? [])).catch(() => {})
  }, [])

  const update = (key: keyof FilterState, val: string) =>
    onChange({ ...value, [key]: val })

  return (
    <div className="flex flex-wrap gap-3 bg-gray-900 p-4 rounded-xl border border-gray-800">
      {/* 链筛选 */}
      <select
        value={value.chainId}
        onChange={(e) => update('chainId', e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
      >
        <option value="">全部链</option>
        {chains.map((c) => (
          <option key={c.chainId} value={c.chainId}>{c.name}</option>
        ))}
      </select>

      {/* 代币筛选 */}
      <input
        type="text"
        placeholder="代币符号（如 USDC）"
        value={value.asset}
        onChange={(e) => update('asset', e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-44"
      />

      {/* 协议筛选 */}
      <select
        value={value.protocol}
        onChange={(e) => update('protocol', e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
      >
        <option value="">全部协议</option>
        {protocols.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>

      {/* 最低 APY */}
      <input
        type="number"
        placeholder="最低 APY %"
        value={value.minApy}
        onChange={(e) => update('minApy', e.target.value)}
        min="0"
        step="0.5"
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-32"
      />

      {/* 排序 */}
      <select
        value={value.sortBy}
        onChange={(e) => update('sortBy', e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
      >
        <option value="apy">按 APY 排序</option>
        <option value="tvl">按 TVL 排序</option>
      </select>
    </div>
  )
}
