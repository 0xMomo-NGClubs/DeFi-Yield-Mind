import { Hono } from 'hono'
import { fetchProtocols } from '../services/earn.js'

export const protocolsRouter = new Hono()

// GET /protocols - 获取支持的协议列表
protocolsRouter.get('/', async (c) => {
  try {
    const protocols = await fetchProtocols()
    return c.json({ protocols })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
