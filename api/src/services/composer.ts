const COMPOSER_BASE_URL = 'https://li.quest'

export interface DepositQuoteRequest {
  fromChainId: number
  fromToken: string      // 用户持有的代币地址
  fromAmount: string     // 数量（已按 decimals 换算）
  vaultChainId: number
  vaultAddress: string   // Vault 地址（即 Composer 的 toToken）
  userWallet: string
}

export interface TransactionRequest {
  to: string
  data: string
  value: string
  gasLimit?: string
  chainId: number
}

export interface DepositQuoteResponse {
  transactionRequest: TransactionRequest
  estimate: {
    fromAmount: string
    toAmount: string
    executionDuration: number
    feeCosts: unknown[]
    gasCosts: unknown[]
  }
  action: {
    fromChainId: number
    toChainId: number
    fromToken: { address: string; symbol: string; decimals: number }
    toToken: { address: string; symbol: string; decimals: number }
    fromAmount: string
  }
}

export interface RedeemQuoteRequest {
  vaultChainId: number
  vaultAddress: string    // Vault 地址（即用户持有的份额代币，ERC-4626）
  toToken: string         // 赎回后想收到的底层代币地址
  fromAmount: string      // 赎回份额数量（已按 decimals 换算）
  userWallet: string
}

// 构建赎回交易报价（fromToken=vault，toToken=底层代币，和存款完全对称）
export async function buildRedeemQuote(req: RedeemQuoteRequest): Promise<DepositQuoteResponse> {
  const apiKey = process.env.LIFI_API_KEY
  if (!apiKey) throw new Error('缺少 LIFI_API_KEY 环境变量')

  const params = new URLSearchParams({
    fromChain: String(req.vaultChainId),
    toChain: String(req.vaultChainId),
    fromToken: req.vaultAddress,   // ← 金库份额 token（即 vault 地址本身）
    toToken: req.toToken,           // ← 底层代币（如 USDC）
    fromAddress: req.userWallet,
    toAddress: req.userWallet,
    fromAmount: req.fromAmount,
  })

  const res = await fetch(`${COMPOSER_BASE_URL}/v1/quote?${params}`, {
    headers: { 'x-lifi-api-key': apiKey },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Composer 赎回报价错误: ${res.status} - ${err}`)
  }

  return res.json()
}

// 构建存款交易报价（注意：Composer 用 GET + query params，不是 POST）
export async function buildDepositQuote(req: DepositQuoteRequest): Promise<DepositQuoteResponse> {
  const apiKey = process.env.LIFI_API_KEY
  if (!apiKey) throw new Error('缺少 LIFI_API_KEY 环境变量')

  const params = new URLSearchParams({
    fromChain: String(req.fromChainId),
    toChain: String(req.vaultChainId),
    fromToken: req.fromToken,
    toToken: req.vaultAddress,   // ← 关键：目标是 vault 地址，不是底层 token
    fromAddress: req.userWallet,
    toAddress: req.userWallet,
    fromAmount: req.fromAmount,
  })

  const res = await fetch(`${COMPOSER_BASE_URL}/v1/quote?${params}`, {
    headers: { 'x-lifi-api-key': apiKey },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Composer 错误: ${res.status} - ${err}`)
  }

  return res.json()
}
