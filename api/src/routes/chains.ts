import { Hono } from 'hono'
import { fetchChains } from '../services/earn.js'

export const chainsRouter = new Hono()

// GET /chains - 获取支持的链列表
chainsRouter.get('/', async (c) => {
  try {
    const chains = await fetchChains()
    return c.json({ chains })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
