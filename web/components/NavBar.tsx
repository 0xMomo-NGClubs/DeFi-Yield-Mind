'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

export function NavBar() {
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  // 避免 SSR/CSR hydration 不一致
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null

  return (
    <nav className="border-b border-gray-800 bg-gray-900">
      <div className="container mx-auto px-4 max-w-7xl flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="font-bold text-lg text-white tracking-tight">
          DeFi Yield Hub
        </Link>

        {/* 导航链接 */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className={clsx(
              'text-sm transition-colors',
              pathname === '/' ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
            )}
          >
            Vaults
          </Link>
          <Link
            href="/portfolio"
            className={clsx(
              'text-sm transition-colors',
              pathname === '/portfolio' ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
            )}
          >
            Portfolio
          </Link>
          <Link
            href="/compare"
            className={clsx(
              'text-sm transition-colors',
              pathname === '/compare' ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
            )}
          >
            比较
          </Link>
          <Link
            href="/about"
            className={clsx(
              'text-sm transition-colors',
              pathname === '/about' ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
            )}
          >
            关于
          </Link>
          <Link
            href="/docs"
            className={clsx(
              'text-sm transition-colors',
              pathname === '/docs' ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
            )}
          >
            SKILL
          </Link>
        </div>

        {/* 钱包连接（mounted 后才渲染，避免 hydration 错误） */}
        {!mounted ? (
          <div className="w-24 h-8 rounded-lg bg-gray-800 animate-pulse" />
        ) : isConnected ? (
          <button
            onClick={() => disconnect()}
            className="text-sm bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors font-mono text-gray-300"
          >
            {shortAddress}
          </button>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="text-sm bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-lg transition-colors font-medium"
          >
            连接钱包
          </button>
        )}
      </div>
    </nav>
  )
}
