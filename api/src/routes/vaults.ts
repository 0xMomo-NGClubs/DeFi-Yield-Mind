import { Hono } from 'hono'
import { fetchVaults, fetchVault } from '../services/earn.js'

export const vaultsRouter = new Hono()

// GET /vaults - 查询 Vault 列表
vaultsRouter.get('/', async (c) => {
  try {
    const query = c.req.query()
    const data = await fetchVaults({
      chainId: query.chainId ? Number(query.chainId) : undefined,
      asset: query.asset,
      protocol: query.protocol,
      minTvl: query.minTvl ? Number(query.minTvl) : undefined,
      sortBy: query.sortBy,
      limit: query.limit ? Number(query.limit) : 20,
      cursor: query.cursor,
    })

    // 本地过滤 minApy（Earn API 不支持该参数）
    const minApy = query.minApy ? Number(query.minApy) : undefined
    if (minApy !== undefined) {
      data.vaults = data.vaults.filter(
        (v) => (v.analytics.apy.total ?? 0) >= minApy
      )
    }

    return c.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})

// GET /vaults/:chainId/:address - 查询单个 Vault
vaultsRouter.get('/:chainId/:address', async (c) => {
  try {
    const chainId = Number(c.req.param('chainId'))
    const address = c.req.param('address')
    const vault = await fetchVault(chainId, address)
    return c.json(vault)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
