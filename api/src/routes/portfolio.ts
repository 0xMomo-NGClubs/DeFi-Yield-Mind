import { Hono } from 'hono'
import { fetchPortfolio } from '../services/earn.js'

export const portfolioRouter = new Hono()

// GET /portfolio/:wallet - 查询钱包持仓
portfolioRouter.get('/:wallet', async (c) => {
  try {
    const wallet = c.req.param('wallet')

    // 简单校验钱包地址格式
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
