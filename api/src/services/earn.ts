import NodeCache from 'node-cache'

const EARN_BASE_URL = 'https://earn.li.fi'

// Vault 数据缓存 60 秒，chains/protocols 缓存 5 分钟
const cache = new NodeCache({ stdTTL: 60 })
const longCache = new NodeCache({ stdTTL: 300 })

export interface UnderlyingToken {
  symbol: string
  address: string
  decimals: number
}

export interface VaultAnalytics {
  apy: {
    base: number | null
    reward: number | null
    total: number | null
  }
  apy1d: number | null
  apy7d: number | null
  apy30d: number | null
  tvl: { usd: string }
}

export interface Vault {
  address: string
  chainId: number
  name: string
  protocol: { name: string }
  underlyingTokens: UnderlyingToken[]
  tags: string[]
  analytics: VaultAnalytics
  isTransactional: boolean
  isRedeemable: boolean
}

// LI.FI Earn API 实际返回 { data: [...], nextCursor, total }
interface EarnVaultsRaw {
  data: Vault[]
  nextCursor?: string
  total?: number
}

export interface VaultsResponse {
  vaults: Vault[]
  nextCursor?: string
  total?: number
}

export interface Position {
  chainId: number
  protocolName: string
  asset: {
    address: string
    name: string
    symbol: string
    decimals: number
  }
  balanceUsd: string
  balanceNative: string
  // 链上精确匹配后填入，可通过 vaultAddress 与 Vault.address 精准对应
  vaultAddress?: string
}

export interface VaultsQueryParams {
  chainId?: number
  asset?: string
  protocol?: string
  minApy?: number
  minTvl?: number
  sortBy?: string
  limit?: number
  cursor?: string
}

// 查询 Vault 列表（带分页）
export async function fetchVaults(params: VaultsQueryParams): Promise<VaultsResponse> {
  const query = new URLSearchParams()
  if (params.chainId) query.set('chainId', String(params.chainId))
  if (params.asset) query.set('asset', params.asset)
  if (params.minTvl) query.set('minTvl', String(params.minTvl))
  // LI.FI API 只支持 apy 和 tvl 排序，其余值忽略
  if (params.sortBy && ['apy', 'tvl'].includes(params.sortBy)) {
    query.set('sortBy', params.sortBy)
  }
  if (params.limit) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)

  const cacheKey = `vaults:${query.toString()}`
  const cached = cache.get<VaultsResponse>(cacheKey)
  if (cached) return cached

  const res = await fetch(`${EARN_BASE_URL}/v1/earn/vaults?${query}`)
  if (!res.ok) throw new Error(`Earn API 错误: ${res.status} ${res.statusText}`)

  const raw: EarnVaultsRaw = await res.json()

  // 统一转换为内部格式（data → vaults）
  const result: VaultsResponse = {
    vaults: raw.data ?? [],
    nextCursor: raw.nextCursor,
    total: raw.total,
  }

  // 本地过滤 protocol（Earn API 不支持该参数）
  if (params.protocol) {
    result.vaults = result.vaults.filter(v => v.protocol.name === params.protocol)
  }
  // 本地过滤 minApy（Earn API 不支持，本地过滤）
  if (params.minApy != null) {
    result.vaults = result.vaults.filter(v => (v.analytics.apy.total ?? 0) >= params.minApy!)
  }

  cache.set(cacheKey, result)
  return result
}

// 查询单个 Vault
export async function fetchVault(chainId: number, address: string): Promise<Vault> {
  const cacheKey = `vault:${chainId}:${address}`
  const cached = cache.get<Vault>(cacheKey)
  if (cached) return cached

  const res = await fetch(`${EARN_BASE_URL}/v1/earn/vaults/${chainId}/${address}`)
  if (!res.ok) throw new Error(`Earn API 错误: ${res.status} ${res.statusText}`)

  const data: Vault = await res.json()
  cache.set(cacheKey, data)
  return data
}

// 查询用户持仓（链上精确匹配金库合约地址）
export async function fetchPortfolio(wallet: string): Promise<{ positions: Position[]; totalUsd: string }> {
  const { fetchVaultBalances } = await import('./onchain.js')

  const res = await fetch(`${EARN_BASE_URL}/v1/earn/portfolio/${wallet}/positions`)
  if (!res.ok) throw new Error(`Earn API 错误: ${res.status} ${res.statusText}`)

  const data: { positions: Position[] } = await res.json()

  // 过滤有余额的持仓
  const activePositions = data.positions.filter(p => parseFloat(p.balanceUsd || '0') > 0)

  if (activePositions.length === 0) {
    return { positions: [], totalUsd: '0.00' }
  }

  // 针对每条有仓位的 (chainId, protocol, asset) 组合，查询匹配的金库列表
  const vaultCandidates: { chainId: number; address: string; posIdx: number }[] = []
  // 记录哪些 posIdx 找到了候选金库（用于区分"查到了但链上无余额"vs"压根没候选"）
  const posIdxWithCandidates = new Set<number>()

  await Promise.allSettled(
    activePositions.map(async (pos, posIdx) => {
      try {
        const q = new URLSearchParams({
          chainId: String(pos.chainId),
          asset: pos.asset.symbol,
          limit: '50',
        })
        const vRes = await fetch(`${EARN_BASE_URL}/v1/earn/vaults?${q}`)
        if (!vRes.ok) return
        const vData: { data?: Vault[] } = await vRes.json()
        const vaults = vData.data ?? []
        // 筛选同协议的金库（模糊匹配）
        const matched = vaults.filter(v => {
          const p = pos.protocolName.toLowerCase().replace(/[^a-z0-9]/g, '')
          const vp = v.protocol.name.toLowerCase().replace(/[^a-z0-9]/g, '')
          return p && vp && (p.includes(vp) || vp.includes(p))
        })
        if (matched.length > 0) posIdxWithCandidates.add(posIdx)
        for (const v of matched) {
          vaultCandidates.push({ chainId: v.chainId, address: v.address, posIdx })
        }
      } catch {
        // 单个查询失败不影响整体
      }
    }),
  )

  // 链上批量 balanceOf 查询，精确确认哪些金库有余额
  const balanceMap = vaultCandidates.length > 0
    ? await fetchVaultBalances(wallet, vaultCandidates)
    : new Map<string, bigint>()

  // 构建精确匹配的 positions（每个有余额的金库地址对应一条持仓记录）
  const precisePositions: Position[] = []
  for (const [key, _shares] of balanceMap.entries()) {
    const [chainIdStr, vaultAddr] = key.split(':')
    const chainId = Number(chainIdStr)
    const candidate = vaultCandidates.find(
      c => c.chainId === chainId && c.address.toLowerCase() === vaultAddr,
    )
    if (!candidate) continue
    const srcPos = activePositions[candidate.posIdx]
    precisePositions.push({
      ...srcPos,
      vaultAddress: candidate.address.toLowerCase(),
    })
  }

  // 降级策略：
  //   - 某条持仓找到了候选金库 → 以链上精确结果为准（即使 balanceOf 全为 0，也不回退，避免误显示）
  //   - 某条持仓没找到任何候选金库（协议不在 LI.FI Earn 索引内）→ 降级保留该条原始持仓（无法精确，但总比不显示好）
  const fallbackPositions = activePositions.filter((_, i) => !posIdxWithCandidates.has(i))
  const finalPositions = [...precisePositions, ...fallbackPositions]

  console.log(
    `[Portfolio] wallet=${wallet} ` +
    `active=${activePositions.length} candidates=${vaultCandidates.length} ` +
    `precise=${precisePositions.length} fallback=${fallbackPositions.length}`,
  )

  const totalUsd = finalPositions
    .reduce((sum, p) => sum + parseFloat(p.balanceUsd || '0'), 0)
    .toFixed(2)

  return { positions: finalPositions, totalUsd }
}

// 查询支持的链列表（API 直接返回数组）
export async function fetchChains(): Promise<unknown[]> {
  const cached = longCache.get<unknown[]>('chains')
  if (cached) return cached

  const res = await fetch(`${EARN_BASE_URL}/v1/earn/chains`)
  if (!res.ok) throw new Error(`Earn API 错误: ${res.status} ${res.statusText}`)

  const data: unknown[] = await res.json()
  longCache.set('chains', data)
  return data
}

// 查询支持的协议列表
export async function fetchProtocols(): Promise<unknown[]> {
  const cached = longCache.get<unknown[]>('protocols')
  if (cached) return cached

  const res = await fetch(`${EARN_BASE_URL}/v1/earn/protocols`)
  if (!res.ok) throw new Error(`Earn API 错误: ${res.status} ${res.statusText}`)

  // API 直接返回数组
  const data: unknown[] = await res.json()
  longCache.set('protocols', data)
  return data
}
