import { Hono } from 'hono'
import { buildRedeemQuote } from '../services/composer.js'

export const redeemRouter = new Hono()

// POST /redeem/quote - 构建赎回交易报价
redeemRouter.post('/quote', async (c) => {
  try {
    const body = await c.req.json()

    const required = ['vaultChainId', 'vaultAddress', 'toToken', 'fromAmount', 'userWallet']
    for (const field of required) {
      if (!body[field]) {
        return c.json({ error: `缺少必填参数: ${field}` }, 400)
      }
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(body.userWallet)) {
      return c.json({ error: '无效的钱包地址格式' }, 400)
    }

    const quote = await buildRedeemQuote({
      vaultChainId: Number(body.vaultChainId),
      vaultAddress: body.vaultAddress,
      toToken: body.toToken,
      fromAmount: String(body.fromAmount),
      userWallet: body.userWallet,
    })

    return c.json(quote)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
