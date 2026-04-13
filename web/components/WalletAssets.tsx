'use client'

import { useBalance, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { COMMON_TOKENS, SUPPORTED_CHAINS } from './tokenList'

// 粗略价格（用于过滤和排序，不需要实时）
const PRICES: Record<string, number> = {
  ETH: 3000, WETH: 3000,
  USDC: 1, USDT: 1, DAI: 1, USDS: 1, FRAX: 1,
  WBTC: 60000,
  BNB: 300,
  MATIC: 0.5,
  AVAX: 25,
}

function estimateUsd(symbol: string, amount: number) {
  return amount * (PRICES[symbol] ?? 0)
}

interface TokenInfo {
  symbol: string
  address: string
  decimals: number
}

interface WalletAssetsProps {
  address: `0x${string}`
  onSelect: (chainId: number, token: TokenInfo) => void
}

// 构建 ERC-20 批量查询的元数据（固定顺序，避免 hook 依赖数组）
const ERC20_META: { chainId: number; chainName: string; token: TokenInfo }[] = []
const ERC20_CONTRACTS: {
  address: `0x${string}`
  abi: typeof erc20Abi
  functionName: 'balanceOf'
  chainId: number
}[] = []

for (const chain of SUPPORTED_CHAINS) {
  const tokens = COMMON_TOKENS[chain.id] ?? []
  for (const token of tokens) {
    if (token.address === '0x0000000000000000000000000000000000000000') continue
    ERC20_META.push({ chainId: chain.id, chainName: chain.name, token })
    ERC20_CONTRACTS.push({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      chainId: chain.id,
    })
  }
}

export function WalletAssets({ address, onSelect }: WalletAssetsProps) {
  // ---- native 余额（7 条链，固定数量的 hook）----
  const { data: b1 }     = useBalance({ address, chainId: 1,     query: { enabled: !!address } })
  const { data: b42161 } = useBalance({ address, chainId: 42161, query: { enabled: !!address } })
  const { data: b10 }    = useBalance({ address, chainId: 10,    query: { enabled: !!address } })
  const { data: b8453 }  = useBalance({ address, chainId: 8453,  query: { enabled: !!address } })
  const { data: b137 }   = useBalance({ address, chainId: 137,   query: { enabled: !!address } })
  const { data: b56 }    = useBalance({ address, chainId: 56,    query: { enabled: !!address } })
  const { data: b43114 } = useBalance({ address, chainId: 43114, query: { enabled: !!address } })

  const nativeData = [
    { chainId: 1,     chainName: 'Ethereum',  bal: b1 },
    { chainId: 42161, chainName: 'Arbitrum',  bal: b42161 },
    { chainId: 10,    chainName: 'Optimism',  bal: b10 },
    { chainId: 8453,  chainName: 'Base',      bal: b8453 },
    { chainId: 137,   chainName: 'Polygon',   bal: b137 },
    { chainId: 56,    chainName: 'BSC',       bal: b56 },
    { chainId: 43114, chainName: 'Avalanche', bal: b43114 },
  ]

  // ---- ERC-20 余额批量查询 ----
  const { data: erc20Results } = useReadContracts({
    contracts: ERC20_CONTRACTS.map(c => ({ ...c, args: [address] as [`0x${string}`] })),
    query: { enabled: !!address },
  })

  // ---- 汇总所有资产 ----
  type AssetItem = {
    chainId: number
    chainName: string
    token: TokenInfo
    amount: number
    usd: number
  }

  const assets: AssetItem[] = []

  // native
  for (const { chainId, chainName, bal } of nativeData) {
    if (!bal) continue
    const amount = parseFloat(formatUnits(bal.value, bal.decimals))
    const usd = estimateUsd(bal.symbol, amount)
    if (usd < 0.1) continue
    const nativeToken = COMMON_TOKENS[chainId]?.find(
      t => t.address === '0x0000000000000000000000000000000000000000'
    )
    if (!nativeToken) continue
    assets.push({ chainId, chainName, token: nativeToken, amount, usd })
  }

  // ERC-20
  if (erc20Results) {
    erc20Results.forEach((result, i) => {
      if (result.status !== 'success') return
      const raw = result.result as bigint
      const meta = ERC20_META[i]
      if (!meta) return
      const amount = parseFloat(formatUnits(raw, meta.token.decimals))
      const usd = estimateUsd(meta.token.symbol, amount)
      if (usd < 0.1) return
      assets.push({ chainId: meta.chainId, chainName: meta.chainName, token: meta.token, amount, usd })
    })
  }

  // 按 USD 价值降序
  assets.sort((a, b) => b.usd - a.usd)

  if (assets.length === 0) {
    return (
      <p className="text-xs text-gray-600 text-center py-2">
        扫描中... 或未检测到余额大于 $0.1 的代币
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {assets.map((a, i) => (
        <button
          key={`${a.chainId}-${a.token.address}-${i}`}
          onClick={() => onSelect(a.chainId, a.token)}
          className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-800/60 border border-gray-700/60 hover:border-blue-600/50 hover:bg-blue-950/20 transition-all"
        >
          <div className="text-left">
            <p className="text-xs font-mono font-semibold text-white">{a.token.symbol}</p>
            <p className="text-[10px] text-gray-500">{a.chainName}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-gray-200">
              {a.amount < 0.0001 ? a.amount.toExponential(2) : a.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })}
            </p>
            <p className="text-[10px] text-gray-500">${a.usd.toFixed(a.usd < 1 ? 2 : 0)}</p>
          </div>
        </button>
      ))}
    </div>
  )
}
