'use client'

import { useState, useEffect } from 'react'
import { useAccount, useConnect, useSendTransaction, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useChainId } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseUnits, formatUnits, erc20Abi, maxUint256 } from 'viem'
import { createDepositQuote, createRedeemQuote, Vault, Position } from '@/lib/api'
import { SUPPORTED_CHAINS, COMMON_TOKENS } from './tokenList'
import { WalletAssets } from './WalletAssets'

interface Props {
  vault: Vault
  onClose: () => void
  initialTab?: 'deposit' | 'redeem'
  position?: Position | null
}

type Step = 'input' | 'quoting' | 'confirm' | 'done'

function formatUsd(v: number) {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function DepositModal({ vault, onClose, initialTab = 'deposit', position }: Props) {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const currentChainId = useChainId()

  const [tab, setTab] = useState<'deposit' | 'redeem'>(initialTab)
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>('input')
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof createDepositQuote>> | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [approving, setApproving] = useState(false)
  // 授权交易 hash，用于等待链上确认
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>(undefined)
  // 显式追踪授权状态，避免依赖链上 allowance 刷新时机
  const [approved, setApproved] = useState(false)

  // 来源链 & 来源代币（存款时可自定义）
  const [fromChainId, setFromChainId] = useState<number>(vault.chainId)
  const [fromToken, setFromToken] = useState<{ symbol: string; address: string; decimals: number } | null>(null)

  const vaultToken = vault.underlyingTokens[0]
  const apy = vault.analytics.apy.total
  const isDeposit = tab === 'deposit'

  // 等待授权交易上链确认
  const { isLoading: waitingApprove, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    chainId: isDeposit ? fromChainId : vault.chainId,
    query: { enabled: !!approveTxHash },
  })

  // 授权确认后直接标记已授权，不依赖链上 allowance 刷新时机
  useEffect(() => {
    if (approveConfirmed) {
      setApproving(false)
      setApproveTxHash(undefined)
      setApproved(true)
    }
  }, [approveConfirmed])

  // 来源代币列表（根据选择的来源链）
  const fromChainTokens = COMMON_TOKENS[fromChainId] ?? []

  // 初始化来源代币：优先选 vault 同链同名代币，否则选 native
  useEffect(() => {
    const tokens = COMMON_TOKENS[fromChainId] ?? []
    const match = tokens.find(t => t.symbol === vaultToken?.symbol)
    setFromToken(match ?? tokens[0] ?? null)
  }, [fromChainId, vaultToken?.symbol])

  // 是否跨链
  const isCrossChain = fromChainId !== vault.chainId
  // 来源代币是否 native
  const isFromNative = fromToken?.address === '0x0000000000000000000000000000000000000000'
  // 赎回时的 fromToken 是 vault 份额
  const redeemFromDecimals = vault.lpTokens?.[0]?.decimals ?? 18

  // LI.FI spender（来自 quote）
  const spender = quote?.transactionRequest?.to as `0x${string}` | undefined

  // 授权 fromToken（存款场景）
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: fromToken?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    chainId: fromChainId,
    query: {
      enabled: !!address && !!spender && !!fromToken && !isFromNative && isDeposit && step === 'confirm',
    },
  })

  // 赎回时授权 vault 份额
  const { data: redeemAllowanceRaw, refetch: refetchRedeemAllowance } = useReadContract({
    address: vault.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    chainId: vault.chainId,
    query: {
      enabled: !!address && !!spender && !isDeposit && step === 'confirm',
    },
  })

  const fromAmountBig = (() => {
    try {
      const decimals = isDeposit ? (fromToken?.decimals ?? 18) : redeemFromDecimals
      return amount ? parseUnits(amount as `${number}`, decimals) : 0n
    } catch { return 0n }
  })()

  const needsApproval = !approved && (isDeposit
    ? (!isFromNative && allowanceRaw != null && (allowanceRaw as bigint) < fromAmountBig)
    : (redeemAllowanceRaw != null && (redeemAllowanceRaw as bigint) < fromAmountBig))

  // 钱包余额（native）
  const { data: nativeBalance } = useBalance({
    address,
    chainId: fromChainId,
    query: { enabled: !!address && isFromNative && isDeposit },
  })

  // 钱包余额（ERC-20）
  const { data: erc20BalanceRaw } = useReadContract({
    address: fromToken?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: fromChainId,
    query: { enabled: !!address && !!fromToken && !isFromNative && isDeposit },
  })

  const walletBalance = (() => {
    if (!isDeposit || !fromToken) return null
    if (isFromNative && nativeBalance) return parseFloat(formatUnits(nativeBalance.value, nativeBalance.decimals))
    if (!isFromNative && erc20BalanceRaw != null) return parseFloat(formatUnits(erc20BalanceRaw as bigint, fromToken.decimals))
    return null
  })()

  function switchTab(t: 'deposit' | 'redeem') {
    setTab(t)
    setAmount('')
    setStep('input')
    setQuote(null)
    setError(null)
    setApproved(false)
  }

  const posBalanceUsd = position ? parseFloat(position.balanceUsd) : null
  const posBalanceNative = position ? parseFloat(position.balanceNative) : null

  // ---- 存款报价 ----
  async function handleDepositQuote() {
    if (!address || !amount || !fromToken) return
    setError(null)
    setLoading(true)
    setStep('quoting')
    try {
      const amountRaw = parseUnits(amount as `${number}`, fromToken.decimals).toString()
      const q = await createDepositQuote({
        fromChainId,
        fromToken: fromToken.address,
        fromAmount: amountRaw,
        vaultChainId: vault.chainId,
        vaultAddress: vault.address,
        userWallet: address,
      })
      setQuote(q)
      setStep('confirm')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '获取报价失败'
      setError(
        msg.includes('1001') || msg.includes('no route') || msg.includes('routes')
          ? '暂无可用路由，可能是流动性不足或该代币暂不支持，请换一种代币试试或前往协议官网操作'
          : msg
      )
      setStep('input')
    } finally {
      setLoading(false)
    }
  }

  // ---- 赎回报价 ----
  async function handleRedeemQuote() {
    if (!address || !amount || !vaultToken) return
    setError(null)
    setLoading(true)
    setStep('quoting')
    try {
      const amountRaw = parseUnits(amount as `${number}`, redeemFromDecimals).toString()
      const q = await createRedeemQuote({
        vaultChainId: vault.chainId,
        vaultAddress: vault.address,
        toToken: vaultToken.address,
        fromAmount: amountRaw,
        userWallet: address,
      })
      setQuote(q)
      setStep('confirm')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '获取赎回报价失败'
      setError(
        msg.includes('1001') || msg.includes('routes')
          ? '该金库暂时没有可用的赎回路由，请前往协议官网手动赎回'
          : msg
      )
      setStep('input')
    } finally {
      setLoading(false)
    }
  }

  // ---- 授权 ----
  async function handleApprove() {
    if (!spender || !address) return
    setError(null)
    setApproving(true)
    try {
      const approveChainId = isDeposit ? fromChainId : vault.chainId
      const approveTokenAddress = isDeposit ? fromToken!.address : vault.address
      if (currentChainId !== approveChainId) {
        await switchChainAsync({ chainId: approveChainId })
      }
      // 发出授权交易，拿到 hash 后保存，等 useWaitForTransactionReceipt 确认
      const hash = await writeContractAsync({
        address: approveTokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, maxUint256],
        chainId: approveChainId,
      })
      setApproveTxHash(hash)
      // approving 状态保持，由 approveConfirmed effect 清除
    } catch (e) {
      setError(e instanceof Error ? e.message : '授权失败')
      setApproving(false)
    }
  }

  // ---- 发送交易 ----
  async function handleSendTx() {
    if (!quote) return
    setError(null)
    setLoading(true)
    try {
      const tx = quote.transactionRequest
      const targetChainId = tx.chainId ?? fromChainId
      if (currentChainId !== targetChainId) {
        try { await switchChainAsync({ chainId: targetChainId }) }
        catch { throw new Error(`请在钱包中切换到目标链（Chain ID: ${targetChainId}）后重试`) }
      }
      const hash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value || '0'),
        chainId: targetChainId,
      })
      setTxHash(hash)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '交易失败')
    } finally {
      setLoading(false)
    }
  }

  const canRedeem = vault.isRedeemable && position != null

  function calcEarn(days: number) {
    if (!amount || !apy) return null
    return Number(amount) * (apy / 100 / 365) * days
  }

  const redeemEstimate = quote?.estimate?.toAmount && vaultToken
    ? parseFloat(formatUnits(BigInt(quote.estimate.toAmount), vaultToken.decimals))
    : null

  const fromSymbol = isDeposit ? (fromToken?.symbol ?? '?') : (vault.lpTokens?.[0]?.symbol ?? vaultToken?.symbol ?? '?')

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* ── 标题 ── */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-800">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-base text-white truncate">{vault.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-gray-500">{vault.protocol.name}</span>
              <span className="text-gray-700">·</span>
              <span className="text-xs text-green-400 font-medium">APY {apy?.toFixed(2) ?? '--'}%</span>
              {vault.analytics.apy.reward != null && vault.analytics.apy.reward > 0 && (
                <>
                  <span className="text-gray-700">·</span>
                  <span className="text-xs text-yellow-500">+{vault.analytics.apy.reward.toFixed(2)}% 奖励</span>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none ml-4 flex-shrink-0">×</button>
        </div>

        {/* ── Tab 切换 ── */}
        {canRedeem && step === 'input' && (
          <div className="flex mx-6 mt-4 bg-gray-800 rounded-xl p-1">
            <button onClick={() => switchTab('deposit')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${isDeposit ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
              存款
            </button>
            <button onClick={() => switchTab('redeem')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${!isDeposit ? 'bg-red-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
              赎回
            </button>
          </div>
        )}

        <div className="px-6 pb-6 pt-4 space-y-4">

          {/* ── 未连接钱包 ── */}
          {!isConnected && (
            <div className="text-center py-6">
              <p className="text-gray-400 mb-4 text-sm">请先连接钱包</p>
              <button onClick={() => connect({ connector: injected() })}
                className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-lg text-sm font-medium">
                连接钱包
              </button>
            </div>
          )}

          {/* ── 输入阶段 ── */}
          {isConnected && step === 'input' && (
            <>
              {/* 存款：来源链 + 来源代币选择器 */}
              {isDeposit && (
                <div className="space-y-3">
                  {/* 钱包资产扫描 */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 block">
                      我的钱包资产（点击选择）
                    </label>
                    <WalletAssets
                      address={address!}
                      onSelect={(chainId, token) => {
                        setFromChainId(chainId)
                        setFromToken(token)
                      }}
                    />
                  </div>

                  <div className="border-t border-gray-800/80 pt-3">
                  {/* 来源链选择 */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 block">
                      或手动选择链
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {SUPPORTED_CHAINS.map(chain => (
                        <button
                          key={chain.id}
                          onClick={() => setFromChainId(chain.id)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                            fromChainId === chain.id
                              ? 'bg-blue-600/30 border-blue-500/60 text-blue-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          {chain.name}
                          {chain.id === vault.chainId && (
                            <span className="ml-1 text-[9px] text-emerald-500">目标链</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 来源代币选择 */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 block">
                      用哪种代币存入
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {fromChainTokens.map(token => (
                        <button
                          key={token.address}
                          onClick={() => setFromToken(token)}
                          className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition-all ${
                            fromToken?.address === token.address
                              ? 'bg-blue-600/30 border-blue-500/60 text-blue-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          {token.symbol}
                          {token.symbol === vaultToken?.symbol && (
                            <span className="ml-1 text-[9px] text-emerald-500">直存</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 跨链/跨代币提示 */}
                  {(isCrossChain || (fromToken && fromToken.symbol !== vaultToken?.symbol)) && (
                    <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-xl px-3 py-2.5 flex items-start gap-2">
                      <span className="text-indigo-400 text-sm mt-0.5">⚡</span>
                      <p className="text-[11px] text-indigo-300 leading-relaxed">
                        LI.FI 将自动完成{isCrossChain ? ' 跨链桥接 + ' : ' '}Swap
                        {fromToken && vaultToken ? ` (${fromToken.symbol} → ${vaultToken.symbol})` : ''}
                        {isCrossChain ? ` → 存入 ${SUPPORTED_CHAINS.find(c => c.id === vault.chainId)?.name ?? 'vault'} 链` : ''}，一步到位
                      </p>
                    </div>
                  )}
                  </div>{/* 手动选择区块结束 */}

                  {/* 钱包余额 */}
                  <div className="flex items-center justify-between bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">钱包余额</span>
                      <span className="text-xs font-semibold text-white">
                        {walletBalance != null
                          ? `${walletBalance.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${fromToken?.symbol}`
                          : <span className="text-gray-600">加载中...</span>
                        }
                      </span>
                    </div>
                    {walletBalance != null && walletBalance > 0 && fromToken && (
                      <button
                        onClick={() => setAmount(walletBalance.toFixed(fromToken.decimals <= 6 ? 4 : 6))}
                        className="text-[10px] text-blue-400 hover:text-blue-300 border border-blue-800/50 px-2 py-0.5 rounded transition-colors"
                      >
                        全部
                      </button>
                    )}
                  </div>

                  {/* 已有仓位 */}
                  {position && posBalanceUsd != null && (
                    <div className="bg-emerald-950/30 border border-emerald-800/30 rounded-xl px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span className="text-[10px] text-emerald-500">已存仓位</span>
                          <span className="text-xs font-semibold text-white">{formatUsd(posBalanceUsd)}</span>
                        </div>
                        <span className="text-[10px] text-gray-500">≈ {posBalanceNative?.toFixed(4)} {vaultToken?.symbol}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 赎回：显示当前持仓 */}
              {!isDeposit && posBalanceUsd != null && (
                <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-2">当前持仓</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xl font-bold text-white">{formatUsd(posBalanceUsd)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">≈ {posBalanceNative?.toFixed(4)} {vaultToken?.symbol}</p>
                    </div>
                    {apy != null && (
                      <div className="text-right text-xs text-gray-500 space-y-0.5">
                        <p>日收益 <span className="text-green-400">+${(posBalanceUsd * apy / 100 / 365).toFixed(2)}</span></p>
                        <p>月收益 <span className="text-green-400">+${(posBalanceUsd * apy / 100 / 365 * 30).toFixed(2)}</span></p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 金额输入 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm text-gray-400">
                    {isDeposit ? '存款金额' : '赎回金额'}（{fromSymbol}）
                  </label>
                  {!isDeposit && posBalanceNative != null && (
                    <button
                      onClick={() => setAmount(posBalanceNative.toFixed(redeemFromDecimals <= 6 ? 4 : 6))}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      全部赎回
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-500 pr-20"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500 font-medium">
                    {fromSymbol}
                  </span>
                </div>
                {isDeposit && walletBalance != null && amount && Number(amount) > walletBalance && (
                  <p className="text-xs text-red-400 mt-1.5">⚠ 余额不足，钱包仅有 {walletBalance.toFixed(4)} {fromToken?.symbol}</p>
                )}
              </div>

              {/* 存款收益预测 */}
              {isDeposit && amount && Number(amount) > 0 && apy != null && (
                <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-2">
                  <p className="text-xs text-gray-400 font-medium">📈 预期收益（以 {vaultToken?.symbol} 计）</p>
                  {[{ label: '每日', days: 1 }, { label: '每月', days: 30 }, { label: '每年', days: 365 }].map(({ label, days }) => {
                    const earn = calcEarn(days)!
                    return (
                      <div key={days} className="flex justify-between text-sm">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-green-400 font-medium">+{earn.toFixed(earn < 0.01 ? 4 : 2)} {vaultToken?.symbol}</span>
                      </div>
                    )
                  })}
                  <div className="border-t border-gray-700/60 pt-2 flex justify-between text-xs text-gray-600">
                    <span>基础 APY</span><span>{vault.analytics.apy.base?.toFixed(2) ?? '--'}%</span>
                  </div>
                  {vault.analytics.apy.reward != null && vault.analytics.apy.reward > 0 && (
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>奖励 APY</span><span className="text-yellow-500">+{vault.analytics.apy.reward.toFixed(2)}%</span>
                    </div>
                  )}
                </div>
              )}

              {!isDeposit && !vault.isRedeemable && (
                <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-xl p-3 text-xs text-yellow-500">
                  该金库不支持通过 LI.FI 赎回，请前往协议官网操作。
                </div>
              )}

              <button
                onClick={isDeposit ? handleDepositQuote : handleRedeemQuote}
                disabled={!amount || Number(amount) <= 0 || loading ||
                  (isDeposit && walletBalance != null && Number(amount) > walletBalance)}
                className={`w-full py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDeposit ? 'bg-blue-600 hover:bg-blue-500' : 'bg-red-700 hover:bg-red-600'
                }`}
              >
                获取{isDeposit ? '存款' : '赎回'}报价
              </button>
            </>
          )}

          {/* ── 报价获取中 ── */}
          {isConnected && step === 'quoting' && (
            <div className="text-center py-10">
              <div className="flex justify-center gap-1 mb-3">
                {[0,1,2].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full bg-blue-400"
                    style={{ animation: `bounce 0.9s ${i*0.15}s ease-in-out infinite` }} />
                ))}
              </div>
              <p className="text-gray-400 text-sm">
                {isCrossChain ? '正在规划跨链路由...' : '正在获取报价...'}
              </p>
            </div>
          )}

          {/* ── 确认报价 ── */}
          {isConnected && step === 'confirm' && quote && (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-xl p-4 space-y-3 text-sm">
                {/* 流程图 */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-center">
                    <p className="text-xs text-gray-500 mb-1">
                      {isDeposit ? `从 ${SUPPORTED_CHAINS.find(c => c.id === fromChainId)?.name}` : '赎回'}
                    </p>
                    <p className="font-semibold text-white text-sm">{amount} {fromSymbol}</p>
                  </div>
                  {isCrossChain && isDeposit && (
                    <>
                      <div className="text-indigo-400 text-base">⚡</div>
                      <div className="flex-1 text-center">
                        <p className="text-[10px] text-gray-600 mb-1">Bridge + Swap</p>
                        <p className="text-xs text-indigo-300">自动路由</p>
                      </div>
                    </>
                  )}
                  <div className="text-gray-600 text-lg">→</div>
                  <div className="flex-1 text-center">
                    <p className="text-xs text-gray-500 mb-1">{isDeposit ? '存入' : '收到'}</p>
                    <p className="font-semibold text-green-400 text-sm">
                      {isDeposit
                        ? `${vault.protocol.name} 份额`
                        : redeemEstimate != null ? `≈ ${redeemEstimate.toFixed(4)} ${vaultToken?.symbol}` : '--'
                      }
                    </p>
                  </div>
                </div>

                <div className="border-t border-gray-700/60 pt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>预计执行时间</span>
                    <span className="text-gray-300">{quote.estimate.executionDuration}s</span>
                  </div>
                  {isDeposit && fromToken && fromToken.symbol !== vaultToken?.symbol && (
                    <div className="flex justify-between text-gray-500">
                      <span>Swap 路径</span>
                      <span className="text-gray-300">{fromToken.symbol} → {vaultToken?.symbol}</span>
                    </div>
                  )}
                  {isCrossChain && isDeposit && (
                    <div className="flex justify-between text-gray-500">
                      <span>跨链路由</span>
                      <span className="text-indigo-300">
                        {SUPPORTED_CHAINS.find(c => c.id === fromChainId)?.name} → {vault.network ?? `Chain ${vault.chainId}`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-500">
                    <span>目标协议</span>
                    <span className="text-gray-300">{vault.protocol.name}</span>
                  </div>
                </div>
              </div>

              {/* ── 授权步骤 ── */}
              {needsApproval ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-[10px] font-bold text-black">1</div>
                      <span className="text-xs font-medium text-yellow-400">授权代币</span>
                    </div>
                    <div className="flex-1 h-px bg-gray-700" />
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-500">2</div>
                      <span className="text-xs text-gray-500">确认交易</span>
                    </div>
                  </div>

                  <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl px-4 py-3 space-y-1">
                    <p className="text-xs font-medium text-yellow-400">需要授权 {fromSymbol}</p>
                    <p className="text-[11px] text-gray-500">
                      首次使用需授权 LI.FI 合约使用您的代币，授权一次即可，后续无需重复操作
                    </p>
                  </div>

                  <button onClick={handleApprove} disabled={approving || waitingApprove}
                    className="w-full py-3 rounded-xl font-semibold bg-yellow-600 hover:bg-yellow-500 transition-all disabled:opacity-60">
                    {waitingApprove ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        等待链上确认...
                      </span>
                    ) : approving ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        钱包签名中...
                      </span>
                    ) : `授权 ${fromSymbol}`}
                  </button>
                  {approveTxHash && (
                    <p className="text-[10px] text-gray-600 text-center font-mono">
                      授权 Tx: {approveTxHash.slice(0, 10)}...{approveTxHash.slice(-6)}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {!isFromNative && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center text-[10px] font-bold text-white">✓</div>
                        <span className="text-xs text-green-400">已授权</span>
                      </div>
                      <div className="flex-1 h-px bg-gray-700" />
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">2</div>
                        <span className="text-xs font-medium text-white">确认交易</span>
                      </div>
                    </div>
                  )}

                  {currentChainId !== (isCrossChain ? fromChainId : vault.chainId) && (
                    <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl px-4 py-2.5 flex items-center gap-2">
                      <span className="text-yellow-400 text-sm">⚠</span>
                      <p className="text-xs text-yellow-400">
                        点击确认后将自动切换到 {SUPPORTED_CHAINS.find(c => c.id === (isCrossChain ? fromChainId : vault.chainId))?.name ?? `Chain ${isCrossChain ? fromChainId : vault.chainId}`}，请在钱包中确认
                      </p>
                    </div>
                  )}

                  <button onClick={handleSendTx} disabled={loading}
                    className={`w-full py-3 rounded-xl font-semibold transition-all disabled:opacity-50 ${
                      isDeposit ? 'bg-green-700 hover:bg-green-600' : 'bg-red-700 hover:bg-red-600'
                    }`}>
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        {currentChainId !== (isCrossChain ? fromChainId : vault.chainId) ? '切换链中...' : '签名中...'}
                      </span>
                    ) : `确认${isDeposit ? '存款' : '赎回'}`}
                  </button>
                </div>
              )}

              <button onClick={() => setStep('input')} className="w-full text-gray-500 hover:text-white text-sm py-1 transition-colors">
                返回修改
              </button>
            </div>
          )}

          {/* ── 完成 ── */}
          {step === 'done' && txHash && (
            <div className="text-center space-y-4 py-4">
              <div className={`text-5xl ${isDeposit ? 'text-green-400' : 'text-blue-400'}`}>
                {isDeposit ? '✓' : '↩'}
              </div>
              <div>
                <p className="font-semibold text-white text-lg">{isDeposit ? '存款交易已提交' : '赎回交易已提交'}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {isCrossChain && isDeposit ? 'LI.FI 将自动完成跨链桥接，请等待几分钟' : '交易正在链上确认中'}
                </p>
              </div>
              <div className="bg-gray-800 rounded-xl px-4 py-3">
                <p className="text-[10px] text-gray-500 mb-1">交易哈希</p>
                <p className="text-xs text-gray-300 font-mono break-all">{txHash}</p>
              </div>
              <button onClick={onClose} className="bg-gray-700 hover:bg-gray-600 px-8 py-2.5 rounded-xl text-sm font-medium transition-colors">
                关闭
              </button>
            </div>
          )}

          {/* ── 错误提示 ── */}
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-xl p-3">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
