// 后端 API 客户端
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `请求失败: ${res.status}`)
  }
  return res.json()
}

// ---- 类型定义 ----
export interface VaultAnalytics {
  apy: { base: number | null; reward: number | null; total: number | null }
  apy1d: number | null
  apy7d: number | null
  apy30d: number | null
  tvl: { usd: string }
  updatedAt: string
}

export interface Vault {
  address: string
  chainId: number
  network: string
  slug: string
  name: string
  protocol: { name: string; url: string }
  underlyingTokens: { symbol: string; address: string; decimals: number }[]
  lpTokens: { symbol: string; address: string; decimals: number }[]
  tags: string[]
  analytics: VaultAnalytics
  isTransactional: boolean
  isRedeemable: boolean
  depositPacks: { name: string; stepsType: string }[]
  redeemPacks: { name: string; stepsType: string }[]
  provider: string
  syncedAt: string
}

export interface VaultsResponse {
  vaults: Vault[]
  nextCursor?: string
  total?: number
}

export interface Position {
  chainId: number
  protocolName: string
  asset: { address: string; name: string; symbol: string; decimals: number }
  balanceUsd: string
  balanceNative: string
  // 链上精确匹配后填入（小写），可与 Vault.address 精准对应
  vaultAddress?: string
}

export interface PortfolioResponse {
  positions: Position[]
  totalUsd: string
}

export interface DepositQuoteResponse {
  transactionRequest: {
    to: string
    data: string
    value: string
    gasLimit?: string
    chainId: number
  }
  estimate: {
    fromAmount: string
    toAmount: string
    executionDuration: number
    feeCosts: unknown[]
    gasCosts: unknown[]
  }
}

// ---- API 方法 ----
export interface VaultsQuery {
  chainId?: number
  asset?: string
  protocol?: string
  minApy?: number
  sortBy?: string
  cursor?: string
  limit?: number
}

export function getVaults(params: VaultsQuery = {}): Promise<VaultsResponse> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  })
  return request<VaultsResponse>(`/vaults?${q}`)
}

export function getVaultDetail(chainId: number, address: string): Promise<Vault> {
  return request<Vault>(`/vaults/${chainId}/${address}`)
}

export function getPortfolio(wallet: string): Promise<PortfolioResponse> {
  return request<PortfolioResponse>(`/portfolio/${wallet}`)
}

// 精确查询钱包在指定金库列表中的链上余额
// slugs 格式："chainId-address"，例如 "8453-0xabc..."
// 返回：{ "8453-0xabc...": "1234567" }（只含余额 > 0 的条目）
export function checkVaultBalances(
  wallet: string,
  slugs: string[],
): Promise<{ balances: Record<string, string> }> {
  return request<{ balances: Record<string, string> }>(`/portfolio/${wallet}/check`, {
    method: 'POST',
    body: JSON.stringify({ slugs }),
  })
}

export function getChains(): Promise<{ chains: unknown[] }> {
  return request<{ chains: unknown[] }>('/chains')
}

export function getProtocols(): Promise<{ protocols: unknown[] }> {
  return request<{ protocols: unknown[] }>('/protocols')
}

export interface HistorySnapshot {
  apy: number | null
  tvlUsd: string | null
  capturedAt: string
}

export function getVaultHistory(
  chainId: number,
  address: string,
  limit = 200
): Promise<{ vaultId: string; count: number; snapshots: HistorySnapshot[] }> {
  return request(`/history/${chainId}/${address}?limit=${limit}`)
}

export interface SearchRecommendation {
  chainId: number
  address: string
  name: string
  protocol: string
  tokens: string[]
  apy: number
  tvlUsd: string
  reason: string
}

export interface SearchParseResult {
  params: {
    asset?: string
    protocol?: string
    chainId?: number
    minApy?: number
    sortBy?: string
    limit?: number
  }
  recommendations: SearchRecommendation[]
  explanation: string
  description: string
  model?: string
}

export function parseSearchQuery(
  query: string,
  history: { role: string; content: string }[] = [],
): Promise<SearchParseResult> {
  return request<SearchParseResult>('/search/parse', {
    method: 'POST',
    body: JSON.stringify({ query, history }),
  })
}

export function createRedeemQuote(body: {
  vaultChainId: number
  vaultAddress: string
  toToken: string
  fromAmount: string
  userWallet: string
}): Promise<DepositQuoteResponse> {
  return request<DepositQuoteResponse>('/redeem/quote', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createDepositQuote(body: {
  fromChainId: number
  fromToken: string
  fromAmount: string
  vaultChainId: number
  vaultAddress: string
  userWallet: string
}): Promise<DepositQuoteResponse> {
  return request<DepositQuoteResponse>('/deposit/quote', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
