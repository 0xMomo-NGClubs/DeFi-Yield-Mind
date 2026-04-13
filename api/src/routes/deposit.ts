import { Hono } from 'hono'
import { buildDepositQuote } from '../services/composer.js'

export const depositRouter = new Hono()

// POST /deposit/quote - 构建存款交易报价
depositRouter.post('/quote', async (c) => {
  try {
    const body = await c.req.json()

    // 参数校验
    const required = ['fromChainId', 'fromToken', 'fromAmount', 'vaultChainId', 'vaultAddress', 'userWallet']
    for (const field of required) {
      if (!body[field]) {
        return c.json({ error: `缺少必填参数: ${field}` }, 400)
      }
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(body.userWallet)) {
      return c.json({ error: '无效的钱包地址格式' }, 400)
    }

    const quote = await buildDepositQuote({
      fromChainId: Number(body.fromChainId),
      fromToken: body.fromToken,
      fromAmount: String(body.fromAmount),
      vaultChainId: Number(body.vaultChainId),
      vaultAddress: body.vaultAddress,
      userWallet: body.userWallet,
    })

    return c.json(quote)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
