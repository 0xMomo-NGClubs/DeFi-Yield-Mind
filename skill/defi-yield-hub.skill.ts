/**
 * DeFi Yield Mind — Agent Skill
 *
 * 供 Claude API、LangChain 等 Agent 框架直接调用的技能文件。
 * 签名和广播交易在本地完成，私钥不经过任何 API。
 *
 * 使用方式：
 *   1. 复制 .env.example 为 .env，填入私钥和 API Key
 *   2. npm install
 *   3. 直接运行：npm run dev "帮我找 USDC 收益最高的 vault"
 *      或在代码中 import { runDeFiAgent, DEFI_TOOLS } 使用
 *
 * 环境变量（必填）：
 *   AGENT_PRIVATE_KEY   — 执行交易的钱包私钥（0x 开头）
 *   ANTHROPIC_API_KEY   — Claude API Key
 *
 * 环境变量（可选）：
 *   DEFI_API_URL        — 后端地址，默认 http://localhost:3000
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  createWalletClient,
  createPublicClient,
  http,
  erc20Abi,
  maxUint256,
  type Hash,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, arbitrum, base, optimism, polygon, bsc } from 'viem/chains'

// ============================================================
// 链配置（chainId → viem chain + 公共 RPC）
// ============================================================

const CHAIN_CONFIG: Record<number, { chain: Chain; rpc: string }> = {
  1:     { chain: mainnet,  rpc: 'https://eth.llamarpc.com' },
  42161: { chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc' },
  8453:  { chain: base,     rpc: 'https://mainnet.base.org' },
  10:    { chain: optimism, rpc: 'https://mainnet.optimism.io' },
  137:   { chain: polygon,  rpc: 'https://polygon-rpc.com' },
  56:    { chain: bsc,      rpc: 'https://bsc-dataseed.binance.org' },
}

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const API_URL = process.env.DEFI_API_URL ?? 'http://localhost:3000'

// ============================================================
// viem 客户端工厂（私钥只在本地读取，不经过任何 API）
// ============================================================

function getAccount() {
  const pk = process.env.AGENT_PRIVATE_KEY
  if (!pk) throw new Error('请设置环境变量 AGENT_PRIVATE_KEY')
  return privateKeyToAccount(pk as `0x${string}`)
}

function getClients(chainId: number) {
  const cfg = CHAIN_CONFIG[chainId]
  if (!cfg) throw new Error(`不支持的链 ID: ${chainId}，支持：${Object.keys(CHAIN_CONFIG).join(', ')}`)
  const account = getAccount()
  const transport = http(cfg.rpc)
  return {
    account,
    walletClient: createWalletClient({ account, chain: cfg.chain, transport }),
    publicClient: createPublicClient({ chain: cfg.chain, transport }),
  }
}

// ============================================================
// ERC-20 授权助手
// 检查 allowance，不足时发 approve(spender, maxUint256) 并等待确认
// ============================================================

async function ensureERC20Approval(
  chainId: number,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  requiredAmount: bigint,
): Promise<Hash | null> {
  const { account, walletClient, publicClient } = getClients(chainId)

  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  })

  if (allowance >= requiredAmount) {
    console.log(`[Skill] allowance 充足 (${allowance})，无需授权`)
    return null
  }

  console.log(`[Skill] allowance 不足，发送 approve 交易...`)
  const approveTxHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  })
  console.log(`[Skill] approve 已提交: ${approveTxHash}，等待链上确认...`)
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
  console.log(`[Skill] approve 已确认`)
  return approveTxHash
}

// ============================================================
// API 调用助手
// ============================================================

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${path} 错误 ${res.status}: ${body}`)
  }
  return res.json()
}

// ============================================================
// Tool Handlers（供 Claude tool_use 调用）
// ============================================================

interface DepositInput {
  fromChainId: number
  fromToken: string
  fromAmount: string
  fromTokenDecimals?: number
  vaultChainId: number
  vaultAddress: string
}

interface RedeemInput {
  vaultChainId: number
  vaultAddress: string
  toToken: string
  fromAmount: string
}

const toolHandlers = {

  // 查询 Vault 列表
  async get_vaults(input: Record<string, unknown>) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(input)) {
      if (v != null) params.set(k, String(v))
    }
    return apiFetch(`/vaults?${params}`)
  },

  // AI 自然语言搜索
  async ai_search(input: { query: string }) {
    return apiFetch('/search/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input.query }),
    })
  },

  // 查询钱包持仓
  async get_portfolio(input: { wallet: string }) {
    return apiFetch(`/portfolio/${input.wallet}`)
  },

  // 查询 Agent 钱包地址（不暴露私钥，只返回地址）
  async get_agent_wallet(_input: Record<string, unknown>) {
    const account = getAccount()
    return { address: account.address }
  },

  // ──────────────────────────────────────────────────────────
  // 存款执行：
  //   ① 后端 /deposit/quote → 拿到未签名 transactionRequest
  //   ② 本地 viem 检查 ERC-20 allowance，不足则 approve
  //   ③ 本地 viem 签名并广播存款交易
  //   ④ 等待链上确认，返回 txHash
  //   私钥全程在本地，不经过 API
  // ──────────────────────────────────────────────────────────
  async execute_deposit(input: DepositInput) {
    const account = getAccount()
    const userWallet = account.address

    // 1. 从后端获取报价（不需要私钥，只需要钱包地址）
    console.log(`[Skill] 获取存款报价，vault=${input.vaultAddress}，amount=${input.fromAmount}`)
    const quote = await apiFetch('/deposit/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, userWallet }),
    }) as { transactionRequest: { to: string; data: string; value: string; gasLimit?: string }; estimate: unknown }

    const { transactionRequest } = quote
    // LI.FI 路由合约地址即为 spender
    const spender = transactionRequest.to as `0x${string}`

    // 2. ERC-20 授权（native token 跳过）
    if (input.fromToken.toLowerCase() !== NATIVE_TOKEN) {
      await ensureERC20Approval(
        input.fromChainId,
        input.fromToken as `0x${string}`,
        spender,
        BigInt(input.fromAmount),
      )
    }

    // 3. 本地签名并广播（私钥在本地，不发给任何人）
    const { walletClient, publicClient } = getClients(input.fromChainId)
    console.log(`[Skill] 发送存款交易...`)
    const txHash = await walletClient.sendTransaction({
      to:    transactionRequest.to as `0x${string}`,
      data:  transactionRequest.data as `0x${string}`,
      value: BigInt(transactionRequest.value ?? '0x0'),
      gas:   transactionRequest.gasLimit ? BigInt(transactionRequest.gasLimit) : undefined,
    })
    console.log(`[Skill] 交易已提交: ${txHash}，等待确认...`)

    // 4. 等待确认
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    console.log(`[Skill] 存款完成，status=${receipt.status}`)
    return {
      txHash,
      status:      receipt.status,  // 'success' | 'reverted'
      agentWallet: userWallet,
      estimate:    quote.estimate,
    }
  },

  // ──────────────────────────────────────────────────────────
  // 迁移机会扫描：
  //   ① 拉取 Agent 钱包持仓
  //   ② 对每个仓位，查询同链同资产 vault 列表
  //   ③ 筛选 APY 提升 >= minApyImprovement 且 TVL >= minTvlUsd 的目标
  //   ④ 返回按年化增收排序的机会列表（纯查询，不执行交易）
  // ──────────────────────────────────────────────────────────
  async scan_migration_opportunities(input: {
    walletAddress?: string
    minApyImprovement?: number
    minTvlUsd?: number
  }) {
    const minApyImprovement = input.minApyImprovement ?? 2
    const minTvlUsd         = input.minTvlUsd         ?? 1_000_000
    const wallet = input.walletAddress ?? getAccount().address

    const CHAIN_NAMES: Record<number, string> = {
      1: 'Ethereum', 42161: 'Arbitrum', 8453: 'Base',
      10: 'Optimism', 137: 'Polygon', 56: 'BSC',
    }

    // 1. 获取持仓
    const portfolio = await apiFetch(`/portfolio/${wallet}`) as {
      positions: Array<{
        chainId: number
        protocolName: string
        asset: { symbol: string; address: string }
        balanceUsd: string
        balanceNative: string
      }>
    }

    if (!portfolio.positions?.length) {
      return { opportunities: [], totalPositions: 0, migratable: 0, message: '当前钱包无持仓' }
    }

    const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    type VaultItem = {
      address: string; name: string
      protocol: { name: string; url?: string }
      analytics: { apy: { total: number | null }; tvl: { usd: string } }
      underlyingTokens: Array<{ symbol: string; address: string; decimals: number }>
      isTransactional?: boolean
    }

    const opportunities: MigrationOpportunity[] = []

    for (const pos of portfolio.positions) {
      // 2. 查同链同资产 vault 列表
      const vaultRes = await apiFetch(
        `/vaults?chainId=${pos.chainId}&asset=${encodeURIComponent(pos.asset.symbol)}&sortBy=apy&limit=20`,
      ) as { vaults: VaultItem[] }

      if (!vaultRes.vaults?.length) continue

      // 3. 按协议名模糊匹配当前仓位对应的 vault
      const currentVault = vaultRes.vaults.find(v =>
        normalizeStr(v.protocol.name).includes(normalizeStr(pos.protocolName).slice(0, 5)) ||
        normalizeStr(pos.protocolName).includes(normalizeStr(v.protocol.name).slice(0, 5))
      )
      if (!currentVault) continue

      const currentApy = currentVault.analytics.apy.total ?? 0
      const underlying = currentVault.underlyingTokens[0]

      // 4. 筛选更优 vault
      const candidates = vaultRes.vaults.filter(v => {
        const vApy = v.analytics.apy.total ?? 0
        const vTvl = parseFloat(v.analytics.tvl.usd)
        return (
          v.address.toLowerCase() !== currentVault.address.toLowerCase() &&
          v.isTransactional !== false &&
          vApy >= currentApy + minApyImprovement &&
          vTvl >= minTvlUsd
        )
      }).sort((a, b) => (b.analytics.apy.total ?? 0) - (a.analytics.apy.total ?? 0))

      if (!candidates.length) continue

      const best    = candidates[0]
      const bestApy = best.analytics.apy.total ?? 0
      const balUsd  = parseFloat(pos.balanceUsd)

      opportunities.push({
        chainId:   pos.chainId,
        chainName: CHAIN_NAMES[pos.chainId] ?? `Chain ${pos.chainId}`,
        currentVaultAddress:     currentVault.address,
        currentVaultName:        currentVault.name,
        currentProtocol:         currentVault.protocol.name,
        currentApy,
        currentBalanceUsd:       balUsd,
        currentSharesAmount:     pos.balanceNative,
        underlyingToken:         underlying?.address ?? pos.asset.address,
        underlyingTokenSymbol:   underlying?.symbol  ?? pos.asset.symbol,
        underlyingTokenDecimals: underlying?.decimals ?? 18,
        targetVaultAddress: best.address,
        targetVaultName:    best.name,
        targetProtocol:     best.protocol.name,
        targetApy:          bestApy,
        targetTvlUsd:       parseFloat(best.analytics.tvl.usd),
        apyImprovement:               bestApy - currentApy,
        estimatedExtraAnnualYieldUsd: balUsd * (bestApy - currentApy) / 100,
      })
    }

    opportunities.sort((a, b) => b.estimatedExtraAnnualYieldUsd - a.estimatedExtraAnnualYieldUsd)
    const totalExtra = opportunities.reduce((s, o) => s + o.estimatedExtraAnnualYieldUsd, 0)

    return {
      opportunities,
      totalPositions: portfolio.positions.length,
      migratable:     opportunities.length,
      message: opportunities.length > 0
        ? `发现 ${opportunities.length} 个迁移机会，每年可多赚约 $${totalExtra.toFixed(2)}`
        : `当前 ${portfolio.positions.length} 个持仓已是同链同资产中的最优选择（阈值：APY +${minApyImprovement}%，TVL $${(minTvlUsd / 1e6).toFixed(1)}M）`,
    }
  },

  // ──────────────────────────────────────────────────────────
  // 原子化迁移：
  //   ① execute_redeem 从旧 vault 赎回底层代币
  //   ② 链上读取赎回后实际余额（ERC-20 balanceOf，避免估算误差）
  //   ③ execute_deposit 将全部底层代币存入新 vault
  //   同链内完成，两笔交易均等待链上确认
  // ──────────────────────────────────────────────────────────
  async execute_migration(input: {
    fromVaultChainId:         number
    fromVaultAddress:         string
    fromSharesAmount:         string
    toVaultAddress:           string
    underlyingTokenAddress:   string
    underlyingTokenDecimals?: number
    reason?:                  string
  }) {
    const account          = getAccount()
    const { publicClient } = getClients(input.fromVaultChainId)
    const decimals         = input.underlyingTokenDecimals ?? 18

    console.log(`[Skill] 开始迁移: ${input.fromVaultAddress} → ${input.toVaultAddress}`)
    if (input.reason) console.log(`[Skill] 迁移原因: ${input.reason}`)

    // 1. 赎回旧 vault
    const redeemResult = await toolHandlers.execute_redeem({
      vaultChainId: input.fromVaultChainId,
      vaultAddress: input.fromVaultAddress,
      toToken:      input.underlyingTokenAddress,
      fromAmount:   input.fromSharesAmount,
    })

    if (redeemResult.status !== 'success') {
      throw new Error(`赎回失败，status=${redeemResult.status}，txHash=${redeemResult.txHash}`)
    }

    // 2. 读取赎回后链上实际余额（避免估算误差）
    const receivedAmount = await publicClient.readContract({
      address:      input.underlyingTokenAddress as `0x${string}`,
      abi:          erc20Abi,
      functionName: 'balanceOf',
      args:         [account.address],
    }) as bigint

    console.log(`[Skill] 赎回成功，余额 ${receivedAmount} (×10^${decimals})，准备存入新 vault...`)

    if (receivedAmount === 0n) {
      throw new Error('赎回后底层代币余额为 0，请检查赎回参数或等待结算')
    }

    // 3. 存入新 vault
    const depositResult = await toolHandlers.execute_deposit({
      fromChainId:       input.fromVaultChainId,
      fromToken:         input.underlyingTokenAddress,
      fromAmount:        receivedAmount.toString(),
      fromTokenDecimals: decimals,
      vaultChainId:      input.fromVaultChainId,
      vaultAddress:      input.toVaultAddress,
    })

    console.log(`[Skill] 迁移完成 ✅  赎回: ${redeemResult.txHash}  存款: ${depositResult.txHash}`)

    return {
      success:          depositResult.status === 'success',
      redeemTxHash:     redeemResult.txHash,
      depositTxHash:    depositResult.txHash,
      fromVault:        input.fromVaultAddress,
      toVault:          input.toVaultAddress,
      transferredAmount: receivedAmount.toString(),
      reason:           input.reason,
    }
  },

  // ──────────────────────────────────────────────────────────
  // 赎回执行：
  //   ① 后端 /redeem/quote → 拿到未签名 transactionRequest
  //   ② 本地 viem 检查 vault 份额的 allowance，不足则 approve
  //   ③ 本地 viem 签名并广播赎回交易
  // ──────────────────────────────────────────────────────────
  async execute_redeem(input: RedeemInput) {
    const account = getAccount()
    const userWallet = account.address

    // 1. 获取赎回报价
    console.log(`[Skill] 获取赎回报价，vault=${input.vaultAddress}，amount=${input.fromAmount}`)
    const quote = await apiFetch('/redeem/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, userWallet }),
    }) as { transactionRequest: { to: string; data: string; value: string; gasLimit?: string }; estimate: unknown }

    const { transactionRequest } = quote
    const spender = transactionRequest.to as `0x${string}`

    // 2. 授权 vault 份额（赎回时 fromToken 是 vault 合约本身）
    await ensureERC20Approval(
      input.vaultChainId,
      input.vaultAddress as `0x${string}`,
      spender,
      BigInt(input.fromAmount),
    )

    // 3. 本地签名并广播
    const { walletClient, publicClient } = getClients(input.vaultChainId)
    console.log(`[Skill] 发送赎回交易...`)
    const txHash = await walletClient.sendTransaction({
      to:    transactionRequest.to as `0x${string}`,
      data:  transactionRequest.data as `0x${string}`,
      value: BigInt(transactionRequest.value ?? '0x0'),
      gas:   transactionRequest.gasLimit ? BigInt(transactionRequest.gasLimit) : undefined,
    })
    console.log(`[Skill] 赎回交易已提交: ${txHash}，等待确认...`)

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    console.log(`[Skill] 赎回完成，status=${receipt.status}`)
    return {
      txHash,
      status:      receipt.status,
      agentWallet: userWallet,
      estimate:    quote.estimate,
    }
  },
}

// ============================================================
// Claude Tool 定义（供传入 client.messages.create 的 tools 参数）
// ============================================================

export const DEFI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_vaults',
    description: '查询 DeFi 收益 Vault 列表，支持按代币、链、协议、APY 筛选和排序',
    input_schema: {
      type: 'object',
      properties: {
        asset:    { type: 'string',  description: '代币符号，如 USDC、ETH、WBTC、DAI' },
        chainId:  { type: 'integer', description: '链 ID：1=Ethereum, 42161=Arbitrum, 8453=Base, 10=Optimism, 137=Polygon, 56=BSC' },
        protocol: { type: 'string',  description: '协议名，如 morpho-v1、aave-v3、euler-v2' },
        minApy:   { type: 'number',  description: '最低 APY（百分比，如 5 表示 5%）' },
        sortBy:   { type: 'string',  enum: ['apy', 'tvl'], description: '排序字段，默认 apy' },
        limit:    { type: 'integer', description: '返回数量，最大 100，默认 10' },
      },
    },
  },
  {
    name: 'ai_search',
    description: '用自然语言搜索 DeFi 金库，AI 自动解析意图并推荐最优 vault（最多 5 个）',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: '自然语言查询，如「USDC 收益最高的」「Arbitrum 上稳定币 vault」「APY 超过 15%」' },
      },
    },
  },
  {
    name: 'get_portfolio',
    description: '查询指定钱包在所有支持 DeFi 协议的持仓和收益',
    input_schema: {
      type: 'object',
      required: ['wallet'],
      properties: {
        wallet: { type: 'string', description: 'EVM 钱包地址（0x...）' },
      },
    },
  },
  {
    name: 'get_agent_wallet',
    description: '查询当前 Agent 使用的钱包地址，执行存款/赎回前先确认地址',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'execute_deposit',
    description: [
      '执行 DeFi 存款全流程：',
      '① 调用后端获取 LI.FI Composer 报价（拿到未签名交易）',
      '② 在本地检查 ERC-20 allowance，不足时本地签名 approve',
      '③ 本地签名并广播存款交易',
      '④ 等待链上确认，返回 txHash',
      '私钥全程在本地，不发送给任何服务器。',
      '支持跨链：fromChainId 和 vaultChainId 可以不同。',
    ].join(' '),
    input_schema: {
      type: 'object',
      required: ['fromChainId', 'fromToken', 'fromAmount', 'vaultChainId', 'vaultAddress'],
      properties: {
        fromChainId:       { type: 'integer', description: '资金来源链 ID' },
        fromToken:         { type: 'string',  description: '来源代币合约地址（native ETH/BNB 等用 0x0000000000000000000000000000000000000000）' },
        fromAmount:        { type: 'string',  description: '存款数量，已按代币 decimals 换算的整数字符串。USDC/USDT 是 6 位：1 USDC = "1000000"；ETH/大多数代币是 18 位：1 ETH = "1000000000000000000"' },
        fromTokenDecimals: { type: 'integer', description: '来源代币精度（USDC/USDT=6，ETH/大多数=18），用于日志展示，不影响执行' },
        vaultChainId:      { type: 'integer', description: 'Vault 所在链 ID' },
        vaultAddress:      { type: 'string',  description: 'Vault 合约地址，来自 get_vaults 或 ai_search 结果的 address 字段' },
      },
    },
  },
  {
    name: 'execute_redeem',
    description: [
      '执行 DeFi 赎回全流程：',
      '① 调用后端获取 LI.FI Composer 赎回报价',
      '② 在本地检查 vault 份额的 allowance，不足时本地签名 approve',
      '③ 本地签名并广播赎回交易',
      '④ 等待链上确认，返回 txHash',
      '赎回后收到底层代币（如 USDC），而非 vault 份额。',
    ].join(' '),
    input_schema: {
      type: 'object',
      required: ['vaultChainId', 'vaultAddress', 'toToken', 'fromAmount'],
      properties: {
        vaultChainId: { type: 'integer', description: 'Vault 所在链 ID' },
        vaultAddress: { type: 'string',  description: 'Vault 合约地址（持有的 ERC-4626 份额 token）' },
        toToken:      { type: 'string',  description: '赎回后想收到的底层代币地址，如 Arbitrum USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"' },
        fromAmount:   { type: 'string',  description: '赎回的 vault 份额数量（已按 vault lpToken decimals 换算，通常 18 位）' },
      },
    },
  },
  {
    name: 'scan_migration_opportunities',
    description: [
      '扫描 Agent 钱包当前持仓，寻找同链同资产中 APY 更高、TVL 更大的迁移机会。',
      '纯查询，不执行任何交易。',
      '返回按年化增收排序的机会列表，每条包含：当前/目标 vault 信息、APY 提升幅度、预计年化增收（USD）。',
      '适合在定时任务中定期调用，发现机会后再由 execute_migration 执行。',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        walletAddress:      { type: 'string',  description: '要扫描的钱包地址，不填则使用 Agent 自身钱包（AGENT_PRIVATE_KEY 派生）' },
        minApyImprovement:  { type: 'number',  description: '最低 APY 提升幅度（百分比），默认 2，即至少比现有 vault 高 2%' },
        minTvlUsd:          { type: 'number',  description: '目标 vault 最低 TVL（USD），默认 1000000（$1M），过滤低流动性 vault' },
      },
    },
  },
  {
    name: 'execute_migration',
    description: [
      '原子化执行同链 vault 迁移：',
      '① 赎回旧 vault，底层代币返回钱包',
      '② 链上读取实际收到的代币余额（ERC-20 balanceOf，精准无误差）',
      '③ 将全部余额存入新 vault',
      '两笔交易均等待链上确认。适合在 scan_migration_opportunities 发现机会后调用。',
      '注意：仅支持同链迁移；跨链迁移请分别调用 execute_redeem + execute_deposit。',
    ].join(' '),
    input_schema: {
      type: 'object',
      required: ['fromVaultChainId', 'fromVaultAddress', 'fromSharesAmount', 'toVaultAddress', 'underlyingTokenAddress'],
      properties: {
        fromVaultChainId:        { type: 'integer', description: '迁出 vault 所在链 ID' },
        fromVaultAddress:        { type: 'string',  description: '迁出的旧 vault 合约地址' },
        fromSharesAmount:        { type: 'string',  description: '赎回的 vault 份额数量（来自 scan_migration_opportunities 的 currentSharesAmount 字段）' },
        toVaultAddress:          { type: 'string',  description: '迁入的新 vault 合约地址（来自 scan_migration_opportunities 的 targetVaultAddress 字段）' },
        underlyingTokenAddress:  { type: 'string',  description: '底层代币地址（来自 scan_migration_opportunities 的 underlyingToken 字段）' },
        underlyingTokenDecimals: { type: 'integer', description: '底层代币精度（来自 underlyingTokenDecimals 字段），默认 18' },
        reason:                  { type: 'string',  description: '迁移原因描述，用于日志记录，如「APY 提升 3.2%，预计年增收 $240」' },
      },
    },
  },
]

// ============================================================
// Agent 主循环
// 传入用户消息，Claude 自主决策调用哪些工具，完成整个流程
// ============================================================

const SYSTEM_PROMPT = `你是 DeFi Yield Mind 的 AI 投资助手，可以帮用户查询、分析、执行 DeFi 存款/赎回，并支持定时盯盘与自动迁移。

你有以下能力：
- 查询多链 DeFi Vault 的实时 APY 和 TVL 数据
- 用自然语言智能搜索最优收益机会
- 查询钱包持仓和收益情况
- 直接执行存款和赎回（本地签名，不暴露私钥）
- 扫描持仓迁移机会（scan_migration_opportunities）
- 原子化执行同链 vault 迁移（execute_migration：赎回旧 vault → 存入更优 vault）

执行链上操作的原则：
1. 执行前先调用 get_agent_wallet 确认操作钱包地址
2. 明确告知用户将执行的操作（链、代币、金额、Vault 名称、APY 对比）
3. 交易完成后展示 txHash 供用户核查

迁移策略建议：
- 先调用 scan_migration_opportunities 发现机会，向用户展示 APY 提升和预计年化增收
- 用户确认后再调用 execute_migration 执行，reason 字段填写 APY 提升和年化增收数字
- 迁移失败时不重试，报告错误并保留原有持仓

fromAmount 计算规则：
- USDC / USDT（6 decimals）：1 USDC = "1000000"
- ETH / 大多数 ERC-20（18 decimals）：1 ETH = "1000000000000000000"
- 可用公式：amount * 10^decimals`

export async function runDeFiAgent(
  userMessage: string,
  options: { verbose?: boolean; maxRounds?: number } = {},
): Promise<string> {
  const { verbose = true, maxRounds = 10 } = options
  const client = new Anthropic()

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ]

  if (verbose) console.log(`\n[Agent] 用户: ${userMessage}\n`)

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      tools:      DEFI_TOOLS,
      messages,
    })

    if (verbose) {
      for (const block of response.content) {
        if (block.type === 'text')     console.log(`[Agent] ${block.text}`)
        if (block.type === 'tool_use') console.log(`[Agent] → 调用工具: ${block.name}`, JSON.stringify(block.input))
      }
    }

    // 模型已完成，返回最终文字
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text')
      return textBlock?.type === 'text' ? textBlock.text : ''
    }

    // 把 assistant 回复追加到消息历史
    messages.push({ role: 'assistant', content: response.content })

    // 执行所有工具调用并收集结果
    const toolUses = response.content.filter(b => b.type === 'tool_use')
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const tu of toolUses) {
      try {
        const handler = toolHandlers[tu.name as keyof typeof toolHandlers]
        if (!handler) throw new Error(`未知工具: ${tu.name}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (handler as (i: any) => Promise<unknown>)(tu.input)
        if (verbose) {
          const preview = JSON.stringify(result).slice(0, 200)
          console.log(`[Tool] ${tu.name} 返回: ${preview}${preview.length >= 200 ? '...' : ''}`)
        }
        toolResults.push({
          type:        'tool_result',
          tool_use_id: tu.id,
          content:     JSON.stringify(result),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Tool Error] ${tu.name}: ${msg}`)
        toolResults.push({
          type:        'tool_result',
          tool_use_id: tu.id,
          content:     `执行失败: ${msg}`,
          is_error:    true,
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  throw new Error(`超过最大轮次 (${maxRounds})，请缩短任务或增大 maxRounds`)
}

// ============================================================
// 迁移机会数据结构（scan_migration_opportunities 返回，execute_migration 消费）
// ============================================================

export interface MigrationOpportunity {
  chainId:   number
  chainName: string
  // 当前仓位
  currentVaultAddress:     string
  currentVaultName:        string
  currentProtocol:         string
  currentApy:              number
  currentBalanceUsd:       number
  currentSharesAmount:     string
  underlyingToken:         string
  underlyingTokenSymbol:   string
  underlyingTokenDecimals: number
  // 推荐目标
  targetVaultAddress: string
  targetVaultName:    string
  targetProtocol:     string
  targetApy:          number
  targetTvlUsd:       number
  // 收益提升
  apyImprovement:               number
  estimatedExtraAnnualYieldUsd: number
}

// ============================================================
// 定时盯盘函数（runMonitorCron）
//
// 设计为"单次执行"：外部调度器（node-cron / GitHub Actions /
// 系统 cron）负责触发间隔，本函数每次调用完成一轮扫描 + 可选迁移。
//
// 推荐用法：
//   import cron from 'node-cron'
//   cron.schedule('0 * * * *', () => runMonitorCron({ autoMigrate: true }))
// ============================================================

export interface MonitorConfig {
  /** 最低 APY 提升幅度（百分比），默认 2 */
  minApyImprovement?: number
  /** 目标 vault 最低 TVL（USD），默认 $1M */
  minTvlUsd?: number
  /**
   * 是否自动迁移。
   * false（默认）= 仅扫描并打印机会，不执行交易；
   * true           = 发现机会后自动执行 execute_migration。
   * 建议先以 false 观察一段时间，确认逻辑后再开启。
   */
  autoMigrate?: boolean
  /** 扫描特定钱包地址，不填则用 AGENT_PRIVATE_KEY 派生的地址 */
  walletAddress?: string
  /**
   * 自定义机会通知回调。
   * 提供此回调时，将替代默认的 console.log 输出，
   * 可用于发送 Telegram / Discord / 邮件通知。
   */
  onOpportunity?: (opportunities: MigrationOpportunity[]) => Promise<void>
}

export async function runMonitorCron(config: MonitorConfig = {}): Promise<void> {
  const {
    minApyImprovement = 2,
    minTvlUsd         = 1_000_000,
    autoMigrate       = false,
    walletAddress,
    onOpportunity,
  } = config

  const timestamp = new Date().toISOString()
  console.log(`\n[Monitor][${timestamp}] 开始扫描迁移机会`)
  console.log(`[Monitor] 参数: minApyImprovement=${minApyImprovement}%, minTvlUsd=$${(minTvlUsd / 1e6).toFixed(1)}M, autoMigrate=${autoMigrate}`)

  // 1. 扫描机会
  const scanResult = await toolHandlers.scan_migration_opportunities({
    walletAddress,
    minApyImprovement,
    minTvlUsd,
  }) as { opportunities: MigrationOpportunity[]; message: string }

  console.log(`[Monitor] ${scanResult.message}`)

  if (!scanResult.opportunities.length) return

  // 2. 通知
  if (onOpportunity) {
    await onOpportunity(scanResult.opportunities)
  } else {
    console.log('[Monitor] 迁移机会明细：')
    for (const opp of scanResult.opportunities) {
      console.log(
        `  📊 ${opp.chainName} · ${opp.underlyingTokenSymbol}\n` +
        `     当前: ${opp.currentVaultName} (${opp.currentApy.toFixed(2)}%，持仓 $${opp.currentBalanceUsd.toFixed(0)})\n` +
        `     目标: ${opp.targetVaultName} (${opp.targetApy.toFixed(2)}%，TVL $${(opp.targetTvlUsd / 1e6).toFixed(1)}M)\n` +
        `     ↑ APY +${opp.apyImprovement.toFixed(2)}%，预计年增收 +$${opp.estimatedExtraAnnualYieldUsd.toFixed(2)}\n`
      )
    }
  }

  // 3. 自动迁移
  if (!autoMigrate) {
    console.log('[Monitor] autoMigrate=false，跳过自动迁移。将 autoMigrate: true 传入可启用。')
    return
  }

  console.log(`[Monitor] autoMigrate=true，开始执行 ${scanResult.opportunities.length} 笔迁移...`)

  for (const opp of scanResult.opportunities) {
    console.log(`[Monitor] 迁移: ${opp.currentVaultName} → ${opp.targetVaultName}`)
    try {
      const result = await toolHandlers.execute_migration({
        fromVaultChainId:        opp.chainId,
        fromVaultAddress:        opp.currentVaultAddress,
        fromSharesAmount:        opp.currentSharesAmount,
        toVaultAddress:          opp.targetVaultAddress,
        underlyingTokenAddress:  opp.underlyingToken,
        underlyingTokenDecimals: opp.underlyingTokenDecimals,
        reason: `APY +${opp.apyImprovement.toFixed(2)}%，预计年增收 $${opp.estimatedExtraAnnualYieldUsd.toFixed(2)}`,
      })
      console.log(`[Monitor] ✅ 迁移完成  赎回: ${result.redeemTxHash}  存款: ${result.depositTxHash}`)
    } catch (err) {
      // 单笔失败不中断后续，记录错误继续
      console.error(`[Monitor] ❌ 迁移失败 (${opp.currentVaultName}):`, err instanceof Error ? err.message : err)
    }
  }
}

// ============================================================
// CLI 直接运行
//
// 对话模式：
//   npm run dev "帮我找 USDC 收益最高的 vault"
//   npm run dev "把 10 USDC 存入 Arbitrum 上 APY 最高的 vault"
//
// 盯盘模式：
//   npm run dev cron                      # 扫描机会，不自动迁移
//   npm run dev cron --auto-migrate       # 扫描 + 自动迁移
//   npm run dev cron --min-apy=3          # APY 提升门槛 3%
//   npm run dev cron --min-tvl=5000000    # TVL 门槛 $5M
//
// 搭配 node-cron 定时运行（安装：npm install node-cron @types/node-cron）：
//   import cron from 'node-cron'
//   import { runMonitorCron } from './defi-yield-hub.skill.js'
//   cron.schedule('0 * * * *', () => runMonitorCron({ autoMigrate: true, minApyImprovement: 2 }))
// ============================================================

if (process.argv[2] === 'cron') {
  // 盯盘模式
  const autoMigrate       = process.argv.includes('--auto-migrate')
  const minApyImprovement = parseFloat(
    process.argv.find(a => a.startsWith('--min-apy='))?.split('=')[1] ?? '2'
  )
  const minTvlUsd = parseFloat(
    process.argv.find(a => a.startsWith('--min-tvl='))?.split('=')[1] ?? '1000000'
  )

  runMonitorCron({ autoMigrate, minApyImprovement, minTvlUsd })
    .then(() => console.log('[Monitor] 本轮扫描结束'))
    .catch(err => { console.error('[Monitor] 运行失败:', err); process.exit(1) })

} else if (process.argv[2]) {
  // 对话模式
  const query = process.argv.slice(2).join(' ')
  runDeFiAgent(query)
    .then(result => {
      console.log('\n========== 最终结果 ==========')
      console.log(result)
    })
    .catch(err => {
      console.error('Agent 运行失败:', err)
      process.exit(1)
    })
}
