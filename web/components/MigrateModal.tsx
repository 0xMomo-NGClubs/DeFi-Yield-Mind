'use client'

import { useState, useEffect } from 'react'
import {
  useAccount, useConnect, useSendTransaction, useReadContract,
  useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useChainId,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseUnits, formatUnits, erc20Abi, maxUint256 } from 'viem'
import { createRedeemQuote, createDepositQuote, Vault, Position } from '@/lib/api'

interface Props {
  fromVault: Vault      // 当前持仓的 vault
  toVault: Vault        // 更优 vault
  position: Position    // 当前持仓
  onClose: () => void
}

// 状态机：6 步
type Stage =
  | 'overview'        // 迁移概览
  | 'step1_confirm'   // 第一步：确认赎回报价
  | 'step1_quoting'   // 正在获取赎回报价
  | 'step1_approve'   // 授权 vault 份额
  | 'step1_send'      // 发送赎回交易
  | 'step1_done'      // 赎回成功，中间过渡
  | 'step2_quoting'   // 正在获取存款报价
  | 'step2_confirm'   // 第二步：确认存款报价
  | 'step2_approve'   // 授权存款代币
  | 'step2_send'      // 发送存款交易
  | 'done'            // 迁移完成

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '--'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
function fmtApy(v: number | null | undefined) {
  if (v == null) return '--'
  return `${v.toFixed(2)}%`
}

export function MigrateModal({ fromVault, toVault, position, onClose }: Props) {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const currentChainId = useChainId()

  const [stage, setStage] = useState<Stage>('overview')
  const [error, setError] = useState<string | null>(null)

  // 第一步报价（赎回）
  const [redeemQuote, setRedeemQuote] = useState<Awaited<ReturnType<typeof createRedeemQuote>> | null>(null)
  const [redeemTxHash, setRedeemTxHash] = useState<string | null>(null)
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>(undefined)

  // 第二步报价（存款）
  const [depositQuote, setDepositQuote] = useState<Awaited<ReturnType<typeof createDepositQuote>> | null>(null)
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null)
  const [depositApproveTxHash, setDepositApproveTxHash] = useState<`0x${string}` | undefined>(undefined)

  // 显式追踪授权状态，避免依赖链上 allowance 刷新时机
  const [redeemApproved, setRedeemApproved] = useState(false)
  const [depositApproved, setDepositApproved] = useState(false)

  // 赎回金额：默认全部
  const redeemDecimals = fromVault.lpTokens?.[0]?.decimals ?? 18
  const redeemAmountNative = position.balanceNative  // 原生数量字符串
  const underlyingToken = fromVault.underlyingTokens[0]
  const toUnderlyingToken = toVault.underlyingTokens[0]

  // 赎回预计拿回多少底层代币
  const redeemEstimate = redeemQuote?.estimate?.toAmount && underlyingToken
    ? parseFloat(formatUnits(BigInt(redeemQuote.estimate.toAmount), underlyingToken.decimals))
    : null

  const fromApy = fromVault.analytics.apy.total
  const toApy = toVault.analytics.apy.total
  const apyDiff = fromApy != null && toApy != null ? toApy - fromApy : null
  const posBalanceUsd = parseFloat(position.balanceUsd)
  const yearlyGain = apyDiff != null ? posBalanceUsd * (apyDiff / 100) : null

  // ---- 第一步：赎回授权 spender ----
  const redeemSpender = redeemQuote?.transactionRequest?.to as `0x${string}` | undefined

  const { data: redeemAllowance, refetch: refetchRedeemAllowance } = useReadContract({
    address: fromVault.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && redeemSpender ? [address, redeemSpender] : undefined,
    chainId: fromVault.chainId,
    query: { enabled: !!address && !!redeemSpender && stage === 'step1_confirm' },
  })

  const redeemAmountBig = (() => {
    try { return parseUnits(redeemAmountNative as `${number}`, redeemDecimals) }
    catch { return 0n }
  })()

  const needsRedeemApproval =
    !redeemApproved &&
    redeemAllowance != null && (redeemAllowance as bigint) < redeemAmountBig

  // 等待赎回授权上链
  const { isSuccess: redeemApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    chainId: fromVault.chainId,
    query: { enabled: !!approveTxHash },
  })
  useEffect(() => {
    if (redeemApproveConfirmed) {
      setApproveTxHash(undefined)
      setRedeemApproved(true)   // 直接标记已授权，不依赖链上数据刷新时机
      setStage('step1_confirm')
    }
  }, [redeemApproveConfirmed])

  // ---- 第二步：存款授权 ----
  const depositSpender = depositQuote?.transactionRequest?.to as `0x${string}` | undefined

  const { data: depositAllowance, refetch: refetchDepositAllowance } = useReadContract({
    address: toUnderlyingToken?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && depositSpender ? [address, depositSpender] : undefined,
    chainId: toVault.chainId,
    query: { enabled: !!address && !!depositSpender && stage === 'step2_confirm' && !!toUnderlyingToken },
  })

  const depositAmountBig = (() => {
    if (!redeemQuote?.estimate?.toAmount) return 0n
    return BigInt(redeemQuote.estimate.toAmount)
  })()

  const needsDepositApproval =
    !depositApproved &&
    depositAllowance != null && (depositAllowance as bigint) < depositAmountBig

  const { isSuccess: depositApproveConfirmed } = useWaitForTransactionReceipt({
    hash: depositApproveTxHash,
    chainId: toVault.chainId,
    query: { enabled: !!depositApproveTxHash },
  })
  useEffect(() => {
    if (depositApproveConfirmed) {
      setDepositApproveTxHash(undefined)
      setDepositApproved(true)  // 直接标记已授权，不依赖链上数据刷新时机
      setStage('step2_confirm')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositApproveConfirmed])

  // ---- 第一步：获取赎回报价 ----
  async function handleRedeemQuote() {
    if (!address) return
    setError(null)
    setStage('step1_quoting')
    try {
      const amountRaw = parseUnits(redeemAmountNative as `${number}`, redeemDecimals).toString()
      const q = await createRedeemQuote({
        vaultChainId: fromVault.chainId,
        vaultAddress: fromVault.address,
        toToken: underlyingToken.address,
        fromAmount: amountRaw,
        userWallet: address,
      })
      setRedeemQuote(q)
      setStage('step1_confirm')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '获取赎回报价失败'
      setError(msg.includes('routes') ? '该金库暂无可用赎回路由，请前往协议官网手动赎回' : msg)
      setStage('overview')
    }
  }

  // ---- 第一步：授权 vault 份额 ----
  async function handleRedeemApprove() {
    if (!redeemSpender || !address) return
    setError(null)
    setStage('step1_approve')
    try {
      if (currentChainId !== fromVault.chainId) {
        await switchChainAsync({ chainId: fromVault.chainId })
      }
      const hash = await writeContractAsync({
        address: fromVault.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [redeemSpender, maxUint256],
        chainId: fromVault.chainId,
      })
      setApproveTxHash(hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : '授权失败')
      setStage('step1_confirm')
    }
  }

  // ---- 第一步：发送赎回交易 ----
  async function handleRedeemSend() {
    if (!redeemQuote) return
    setError(null)
    setStage('step1_send')
    try {
      const tx = redeemQuote.transactionRequest
      if (currentChainId !== fromVault.chainId) {
        await switchChainAsync({ chainId: fromVault.chainId })
      }
      const hash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value || '0'),
        chainId: fromVault.chainId,
      })
      setRedeemTxHash(hash)
      setStage('step1_done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '交易失败')
      setStage('step1_confirm')
    }
  }

  // ---- 第二步：获取存款报价 ----
  async function handleDepositQuote() {
    if (!address || !redeemQuote?.estimate?.toAmount) return
    setError(null)
    setStage('step2_quoting')
    try {
      const q = await createDepositQuote({
        fromChainId: toVault.chainId,
        fromToken: toUnderlyingToken.address,
        fromAmount: redeemQuote.estimate.toAmount,
        vaultChainId: toVault.chainId,
        vaultAddress: toVault.address,
        userWallet: address,
      })
      setDepositQuote(q)
      setStage('step2_confirm')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '获取存款报价失败'
      setError(msg.includes('routes') ? '暂无存款路由，可尝试前往目标协议官网手动操作' : msg)
      setStage('step1_done')
    }
  }

  // ---- 第二步：授权存款代币 ----
  async function handleDepositApprove() {
    if (!depositSpender || !address || !toUnderlyingToken) return
    setError(null)
    setStage('step2_approve')
    try {
      if (currentChainId !== toVault.chainId) {
        await switchChainAsync({ chainId: toVault.chainId })
      }
      const hash = await writeContractAsync({
        address: toUnderlyingToken.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [depositSpender, maxUint256],
        chainId: toVault.chainId,
      })
      setDepositApproveTxHash(hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : '授权失败')
      setStage('step2_confirm')
    }
  }

  // ---- 第二步：发送存款交易 ----
  async function handleDepositSend() {
    if (!depositQuote) return
    setError(null)
    setStage('step2_send')
    try {
      const tx = depositQuote.transactionRequest
      if (currentChainId !== toVault.chainId) {
        await switchChainAsync({ chainId: toVault.chainId })
      }
      const hash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value || '0'),
        chainId: toVault.chainId,
      })
      setDepositTxHash(hash)
      setStage('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '交易失败')
      setStage('step2_confirm')
    }
  }

  // ---- 进度指示器 ----
  const stepIndex: Record<Stage, number> = {
    overview: 0,
    step1_quoting: 1, step1_confirm: 1, step1_approve: 1, step1_send: 1, step1_done: 1,
    step2_quoting: 2, step2_confirm: 2, step2_approve: 2, step2_send: 2,
    done: 3,
  }
  const currentStep = stepIndex[stage]

  const isLoading = ['step1_quoting', 'step1_approve', 'step1_send', 'step2_quoting', 'step2_approve', 'step2_send'].includes(stage)

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* ── 标题 ── */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-800">
          <div>
            <h2 className="font-semibold text-base text-white">迁移持仓</h2>
            <p className="text-xs text-gray-500 mt-0.5">赎回当前金库 → 存入更优金库</p>
          </div>
          <button onClick={onClose} disabled={isLoading} className="text-gray-500 hover:text-white text-2xl leading-none ml-4 disabled:opacity-30">×</button>
        </div>

        {/* ── 进度条 ── */}
        <div className="flex items-center gap-0 px-6 pt-4">
          {[{ label: '概览', step: 0 }, { label: '赎回', step: 1 }, { label: '存款', step: 2 }, { label: '完成', step: 3 }].map(({ label, step }, i) => (
            <div key={step} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  step < currentStep ? 'bg-green-500 border-green-500 text-black' :
                  step === currentStep ? 'bg-blue-600 border-blue-500 text-white' :
                  'bg-gray-800 border-gray-700 text-gray-600'
                }`}>
                  {step < currentStep ? '✓' : step + 1}
                </div>
                <span className={`text-[10px] ${step === currentStep ? 'text-gray-300' : 'text-gray-600'}`}>{label}</span>
              </div>
              {i < 3 && (
                <div className={`h-px flex-1 mb-5 transition-colors ${step < currentStep ? 'bg-green-500/60' : 'bg-gray-800'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="px-6 pb-6 pt-2 space-y-4">

          {/* ── 未连接 ── */}
          {!isConnected && (
            <div className="text-center py-8">
              <p className="text-gray-400 mb-4 text-sm">请先连接钱包</p>
              <button onClick={() => connect({ connector: injected() })}
                className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-lg text-sm font-medium">
                连接钱包
              </button>
            </div>
          )}

          {isConnected && (
            <>
              {/* ── 迁移概览 ── */}
              {stage === 'overview' && (
                <div className="space-y-4">
                  {/* From → To */}
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3">
                      <p className="text-[10px] text-gray-500 mb-1.5">当前持仓</p>
                      <p className="text-xs font-medium text-white truncate">{fromVault.protocol.name}</p>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">{fromVault.name}</p>
                      <p className="text-lg font-bold text-gray-300 mt-2">{fmtApy(fromApy)}</p>
                      <p className="text-[10px] text-gray-600">当前 APY</p>
                    </div>

                    <div className="flex flex-col items-center justify-center pt-8 gap-1">
                      <div className="text-yellow-500 text-xl">→</div>
                      {apyDiff != null && (
                        <span className="text-[10px] font-bold text-yellow-400 whitespace-nowrap">+{apyDiff.toFixed(2)}%</span>
                      )}
                    </div>

                    <div className="bg-yellow-950/40 border border-yellow-700/50 rounded-xl p-3">
                      <p className="text-[10px] text-yellow-600 mb-1.5">迁移目标</p>
                      <p className="text-xs font-medium text-white truncate">{toVault.protocol.name}</p>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">{toVault.name}</p>
                      <p className="text-lg font-bold text-yellow-300 mt-2">{fmtApy(toApy)}</p>
                      <p className="text-[10px] text-yellow-700">更优 APY</p>
                    </div>
                  </div>

                  {/* 持仓 + 年化收益 */}
                  <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">迁移金额</span>
                      <span className="text-white font-semibold">{fmt(posBalanceUsd)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">原生数量</span>
                      <span className="text-gray-300">
                        {parseFloat(position.balanceNative).toFixed(4)} {underlyingToken?.symbol}
                      </span>
                    </div>
                    {yearlyGain != null && (
                      <div className="flex justify-between border-t border-gray-700/60 pt-2">
                        <span className="text-yellow-600">年化预计多赚</span>
                        <span className="text-yellow-400 font-semibold">{fmt(yearlyGain)}</span>
                      </div>
                    )}
                  </div>

                  {/* 注意事项 */}
                  <div className="bg-blue-950/30 border border-blue-800/30 rounded-xl p-3 text-xs text-gray-400 space-y-1">
                    <p className="text-blue-300 font-medium mb-1">迁移流程说明</p>
                    <p>① 第一步：从 <span className="text-white">{fromVault.protocol.name}</span> 赎回底层代币</p>
                    <p>② 第二步：将赎回所得存入 <span className="text-white">{toVault.protocol.name}</span></p>
                    <p className="text-gray-600 mt-1">两步各需独立签名，请保持钱包连接。</p>
                  </div>

                  <button
                    onClick={handleRedeemQuote}
                    className="w-full py-3 rounded-xl font-semibold bg-yellow-600 hover:bg-yellow-500 active:scale-[0.98] text-black transition-all"
                  >
                    开始迁移
                  </button>
                </div>
              )}

              {/* ── 第一步：获取报价中 ── */}
              {stage === 'step1_quoting' && (
                <div className="text-center py-10 space-y-3">
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 rounded-full bg-red-400"
                        style={{ animation: `bounce 0.9s ${i * 0.15}s ease-in-out infinite` }} />
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm">正在获取赎回报价...</p>
                </div>
              )}

              {/* ── 第一步：确认赎回 ── */}
              {stage === 'step1_confirm' && redeemQuote && (
                <div className="space-y-4">
                  <div className="bg-gray-800 rounded-xl p-4 space-y-3 text-sm">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">第一步：赎回确认</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 text-center bg-gray-900/60 rounded-lg p-2">
                        <p className="text-[10px] text-gray-600 mb-1">赎回</p>
                        <p className="font-semibold text-white">
                          {parseFloat(redeemAmountNative).toFixed(4)} {fromVault.lpTokens?.[0]?.symbol ?? underlyingToken?.symbol}
                        </p>
                      </div>
                      <span className="text-gray-600 text-lg">→</span>
                      <div className="flex-1 text-center bg-gray-900/60 rounded-lg p-2">
                        <p className="text-[10px] text-gray-600 mb-1">收到</p>
                        <p className="font-semibold text-green-400">
                          {redeemEstimate != null ? `≈ ${redeemEstimate.toFixed(4)}` : '--'} {underlyingToken?.symbol}
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-gray-700/60 pt-2 text-xs text-gray-500 space-y-1">
                      <div className="flex justify-between">
                        <span>预计时间</span>
                        <span className="text-gray-300">{redeemQuote.estimate.executionDuration}s</span>
                      </div>
                    </div>
                  </div>

                  {needsRedeemApproval ? (
                    <button
                      onClick={handleRedeemApprove}
                      className="w-full py-3 rounded-xl font-semibold bg-orange-600 hover:bg-orange-500 active:scale-[0.98] transition-all"
                    >
                      授权 vault 份额
                    </button>
                  ) : (
                    <button
                      onClick={handleRedeemSend}
                      className="w-full py-3 rounded-xl font-semibold bg-red-700 hover:bg-red-600 active:scale-[0.98] transition-all"
                    >
                      确认赎回
                    </button>
                  )}
                </div>
              )}

              {/* ── 第一步：授权中 ── */}
              {stage === 'step1_approve' && (
                <div className="text-center py-10 space-y-3">
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 rounded-full bg-orange-400"
                        style={{ animation: `bounce 0.9s ${i * 0.15}s ease-in-out infinite` }} />
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm">等待授权上链确认...</p>
                </div>
              )}

              {/* ── 第一步：交易发送中 ── */}
              {stage === 'step1_send' && (
                <div className="text-center py-10 space-y-3">
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 rounded-full bg-red-400"
                        style={{ animation: `bounce 0.9s ${i * 0.15}s ease-in-out infinite` }} />
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm">交易已发送，等待钱包确认...</p>
                </div>
              )}

              {/* ── 第一步完成，准备第二步 ── */}
              {stage === 'step1_done' && (
                <div className="space-y-4">
                  <div className="bg-green-950/30 border border-green-800/30 rounded-xl p-4 text-center">
                    <div className="text-3xl mb-2">✓</div>
                    <p className="text-green-400 font-semibold">赎回成功</p>
                    <p className="text-xs text-gray-500 mt-1">
                      已赎回 {redeemEstimate != null ? `≈ ${redeemEstimate.toFixed(4)} ${underlyingToken?.symbol}` : '底层代币'}
                    </p>
                    {redeemTxHash && (
                      <p className="text-[10px] text-gray-600 mt-1 font-mono">
                        Tx: {redeemTxHash.slice(0, 10)}...{redeemTxHash.slice(-8)}
                      </p>
                    )}
                  </div>

                  <div className="bg-yellow-950/30 border border-yellow-800/30 rounded-xl p-3 text-sm">
                    <p className="text-yellow-400 font-medium mb-1">下一步</p>
                    <p className="text-gray-400 text-xs">
                      将 {redeemEstimate != null ? `${redeemEstimate.toFixed(4)} ${underlyingToken?.symbol}` : '赎回所得'}
                      {' '}存入 <span className="text-white">{toVault.protocol.name} · {toVault.name}</span>
                    </p>
                  </div>

                  <button
                    onClick={handleDepositQuote}
                    className="w-full py-3 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all"
                  >
                    继续 → 存入新金库
                  </button>
                </div>
              )}

              {/* ── 第二步：获取报价中 ── */}
              {stage === 'step2_quoting' && (
                <div className="text-center py-10 space-y-3">
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 rounded-full bg-blue-400"
                        style={{ animation: `bounce 0.9s ${i * 0.15}s ease-in-out infinite` }} />
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm">正在获取存款报价...</p>
                </div>
              )}

              {/* ── 第二步：确认存款 ── */}
              {stage === 'step2_confirm' && depositQuote && (
                <div className="space-y-4">
                  <div className="bg-gray-800 rounded-xl p-4 space-y-3 text-sm">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">第二步：存款确认</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 text-center bg-gray-900/60 rounded-lg p-2">
                        <p className="text-[10px] text-gray-600 mb-1">存入</p>
                        <p className="font-semibold text-white">
                          {redeemEstimate != null ? `${redeemEstimate.toFixed(4)}` : '--'} {toUnderlyingToken?.symbol}
                        </p>
                      </div>
                      <span className="text-gray-600 text-lg">→</span>
                      <div className="flex-1 text-center bg-yellow-950/40 border border-yellow-800/30 rounded-lg p-2">
                        <p className="text-[10px] text-yellow-700 mb-1">获得</p>
                        <p className="font-semibold text-yellow-300">{toVault.protocol.name} 份额</p>
                      </div>
                    </div>
                    <div className="border-t border-gray-700/60 pt-2 text-xs text-gray-500 space-y-1">
                      <div className="flex justify-between">
                        <span>目标 Vault</span>
                        <span className="text-gray-300 truncate max-w-[180px]">{toVault.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>目标 APY</span>
                        <span className="text-green-400 font-medium">{fmtApy(toApy)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>预计时间</span>
                        <span className="text-gray-300">{depositQuote.estimate.executionDuration}s</span>
                      </div>
                    </div>
                  </div>

                  {needsDepositApproval ? (
                    <button
                      onClick={handleDepositApprove}
                      className="w-full py-3 rounded-xl font-semibold bg-orange-600 hover:bg-orange-500 active:scale-[0.98] transition-all"
                    >
                      授权 {toUnderlyingToken?.symbol}
                    </button>
                  ) : (
                    <button
                      onClick={handleDepositSend}
                      className="w-full py-3 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all"
                    >
                      确认存款
                    </button>
                  )}
                </div>
              )}

              {/* ── 第二步：授权/交易中 ── */}
              {(stage === 'step2_approve' || stage === 'step2_send') && (
                <div className="text-center py-10 space-y-3">
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 rounded-full bg-blue-400"
                        style={{ animation: `bounce 0.9s ${i * 0.15}s ease-in-out infinite` }} />
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm">
                    {stage === 'step2_approve' ? '等待授权上链...' : '交易发送中...'}
                  </p>
                </div>
              )}

              {/* ── 迁移完成 ── */}
              {stage === 'done' && (
                <div className="space-y-4 text-center">
                  <div className="py-6">
                    <div className="text-5xl mb-3">🎉</div>
                    <p className="text-xl font-bold text-white">迁移完成！</p>
                    <p className="text-sm text-gray-400 mt-2">
                      已成功迁移至 <span className="text-yellow-300">{toVault.protocol.name}</span>
                    </p>
                    {toApy != null && (
                      <p className="text-sm text-green-400 mt-1">
                        新 APY：{fmtApy(toApy)}
                        {apyDiff != null && <span className="text-yellow-400 ml-2">(+{apyDiff.toFixed(2)}%)</span>}
                      </p>
                    )}
                  </div>

                  <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3 text-xs text-left space-y-1">
                    {redeemTxHash && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">赎回 Tx</span>
                        <span className="font-mono text-gray-400">{redeemTxHash.slice(0, 10)}...{redeemTxHash.slice(-6)}</span>
                      </div>
                    )}
                    {depositTxHash && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">存款 Tx</span>
                        <span className="font-mono text-gray-400">{depositTxHash.slice(0, 10)}...{depositTxHash.slice(-6)}</span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={onClose}
                    className="w-full py-3 rounded-xl font-semibold bg-gray-700 hover:bg-gray-600 transition-all"
                  >
                    关闭
                  </button>
                </div>
              )}

              {/* ── 错误提示 ── */}
              {error && (
                <div className="bg-red-900/20 border border-red-800 text-red-400 text-xs rounded-xl p-3">
                  {error}
                  <button
                    onClick={() => setError(null)}
                    className="ml-2 text-red-600 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
