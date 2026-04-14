import { Hono } from 'hono'
import { fetchPortfolio } from '../services/earn.js'
import { fetchVaultBalances } from '../services/onchain.js'

export const portfolioRouter = new Hono()

// GET /portfolio/:wallet - 查询钱包总持仓（协议级，用于 Portfolio 页面汇总）
portfolioRouter.get('/:wallet', async (c) => {
  try {
    const wallet = c.req.param('wallet')
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return c.json({ error: '无效的钱包地址格式' }, 400)
    }
    const data = await fetchPortfolio(wallet)
    return c.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})

// POST /portfolio/:wallet/check
// 精确查询钱包在指定金库列表中的链上余额（以 slug = "chainId-address" 为唯一 ID）
// body: { slugs: ["8453-0xabc...", "1-0xdef...", ...] }
// response: { balances: { "8453-0xabc...": "1234567" } }  // 只返回余额 > 0 的条目，值为 shares（字符串形式 bigint）
portfolioRouter.post('/:wallet/check', async (c) => {
  try {
    const wallet = c.req.param('wallet')
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return c.json({ error: '无效的钱包地址格式' }, 400)
    }

    const body = await c.req.json() as { slugs?: string[] }
    const slugs = body.slugs
    if (!Array.isArray(slugs) || slugs.length === 0) {
      return c.json({ balances: {} })
    }

    // 解析 slug → { chainId, address }
    const vaults: { chainId: number; address: string }[] = []
    for (const slug of slugs) {
      const dashIdx = slug.indexOf('-')
      if (dashIdx < 1) continue
      const chainId = Number(slug.slice(0, dashIdx))
      const address = slug.slice(dashIdx + 1)
      if (!isNaN(chainId) && /^0x[0-9a-fA-F]{40}$/.test(address)) {
        vaults.push({ chainId, address })
      }
    }

    if (vaults.length === 0) {
      return c.json({ balances: {} })
    }

    // 链上批量 balanceOf 查询
    const balanceMap = await fetchVaultBalances(wallet, vaults)

    // 转成 { slug: sharesString } 格式返回
    const balances: Record<string, string> = {}
    for (const [key, shares] of balanceMap.entries()) {
      // key 格式 "chainId:address"（小写），转回 slug 格式 "chainId-address"
      const [chainId, addr] = key.split(':')
      balances[`${chainId}-${addr}`] = shares.toString()
    }

    console.log(`[Portfolio Check] wallet=${wallet} queried=${vaults.length} hasBalance=${Object.keys(balances).length}`)
    return c.json({ balances })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
