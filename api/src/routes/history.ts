import { Hono } from 'hono'
import { stmts } from '../services/db.js'

export const historyRouter = new Hono()

interface SnapshotRow {
  apy: number | null
  tvl_usd: string | null
  captured_at: string
}

// GET /history/:chainId/:address?limit=100
// 返回某个 vault 的 APY 历史快照，按时间升序
historyRouter.get('/:chainId/:address', (c) => {
  try {
    const chainId = c.req.param('chainId')
    const address = c.req.param('address')
    const limit = Math.min(Number(c.req.query('limit') ?? 200), 500)

    const vaultId = `${chainId}:${address}`
    const rows = stmts.history.all(vaultId, limit) as SnapshotRow[]

    return c.json({
      vaultId,
      count: rows.length,
      snapshots: rows.map((r) => ({
        apy: r.apy,
        tvlUsd: r.tvl_usd,
        capturedAt: r.captured_at,
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    return c.json({ error: msg }, 500)
  }
})
