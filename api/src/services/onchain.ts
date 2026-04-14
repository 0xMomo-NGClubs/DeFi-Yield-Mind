/**
 * 链上余额精确查询
 * 对匹配的金库合约批量调用 balanceOf(wallet)，以合约地址作为唯一标识
 */
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  type Chain,
} from 'viem'
import {
  mainnet, arbitrum, base, optimism, polygon, bsc, avalanche,
  linea, scroll, gnosis, fantom, zksync, mantle, mode, blast,
} from 'viem/chains'
import NodeCache from 'node-cache'

// 链上结果缓存 90 秒（余额变化不会太频繁）
const balanceCache = new NodeCache({ stdTTL: 90 })

// chainId → viem chain 对象
const CHAIN_MAP: Record<number, Chain> = {
  1:       mainnet,
  42161:   arbitrum,
  8453:    base,
  10:      optimism,
  137:     polygon,
  56:      bsc,
  43114:   avalanche,
  59144:   linea,
  534352:  scroll,
  100:     gnosis,
  250:     fantom,
  324:     zksync,
  5000:    mantle,
  34443:   mode,
  81457:   blast,
}

// ERC-20 / ERC-4626 balanceOf ABI（最小集）
const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// 获取或创建该链的 PublicClient（懒加载，按链缓存）
const clientMap = new Map<number, PublicClient>()
function getClient(chainId: number): PublicClient | null {
  if (!CHAIN_MAP[chainId]) return null
  if (!clientMap.has(chainId)) {
    clientMap.set(
      chainId,
      createPublicClient({
        chain: CHAIN_MAP[chainId],
        transport: http(),    // 使用链的默认公共 RPC
      }) as PublicClient,
    )
  }
  return clientMap.get(chainId)!
}

/**
 * 批量查询钱包在若干金库合约中的余额（shares）
 * 返回：Map<`${chainId}:${vaultAddress}`, bigint>，余额为 0 的不包含在内
 *
 * @param wallet   钱包地址
 * @param vaults   待查询的金库列表，格式 { chainId, address }[]
 */
export async function fetchVaultBalances(
  wallet: string,
  vaults: { chainId: number; address: string }[],
): Promise<Map<string, bigint>> {
  const cacheKey = `balances:${wallet}:${vaults.map(v => `${v.chainId}:${v.address}`).join(',')}`
  const cached = balanceCache.get<Map<string, bigint>>(cacheKey)
  if (cached) return cached

  // 按链分组
  const byChain = new Map<number, string[]>()
  for (const v of vaults) {
    if (!byChain.has(v.chainId)) byChain.set(v.chainId, [])
    byChain.get(v.chainId)!.push(v.address)
  }

  const result = new Map<string, bigint>()

  // 对每条链做 multicall
  await Promise.allSettled(
    [...byChain.entries()].map(async ([chainId, addresses]) => {
      const client = getClient(chainId)
      if (!client) return

      try {
        // multicall：同一条链上所有金库并发读取
        const calls = addresses.map(addr => ({
          address: addr as Address,
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf' as const,
          args: [wallet as Address],
        }))

        const results = await client.multicall({ contracts: calls, allowFailure: true })

        results.forEach((res, i) => {
          if (res.status === 'success' && res.result > 0n) {
            result.set(`${chainId}:${addresses[i].toLowerCase()}`, res.result)
          }
        })
      } catch (err) {
        console.warn(`[onchain] chainId=${chainId} multicall 失败:`, err instanceof Error ? err.message : err)
      }
    }),
  )

  balanceCache.set(cacheKey, result)
  return result
}
