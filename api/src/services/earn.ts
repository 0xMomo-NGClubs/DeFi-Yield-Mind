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

// 查询用户持仓
export async function fetchPortfolio(wallet: string): Promise<{ positions: Position[]; totalUsd: string }> {
  const res = await fetch(`${EARN_BASE_URL}/v1/earn/portfolio/${wallet}/positions`)
  if (!res.ok) throw new Error(`Earn API 错误: ${res.status} ${res.statusText}`)

  const data: { positions: Position[] } = await res.json()

  // 计算总 USD
  const totalUsd = data.positions
    .reduce((sum, p) => sum + parseFloat(p.balanceUsd || '0'), 0)
    .toFixed(2)

  return { positions: data.positions, totalUsd }
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
