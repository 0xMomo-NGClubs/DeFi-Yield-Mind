import { db, stmts } from './db.js'
import { Vault } from './earn.js'

const EARN_BASE_URL = 'https://earn.li.fi'
// 默认每小时抓一次，可通过环境变量调整（单位：分钟）
const INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MIN ?? 60) * 60 * 1000

// 全量抓取所有 vault 并写入快照
export async function captureSnapshot(): Promise<void> {
  const startAt = new Date().toISOString()
  console.log(`📸 开始抓取快照: ${startAt}`)

  let cursor: string | undefined
  let total = 0
  let page = 0

  // 批量写入用事务，大幅提升写入性能
  const insertMany = db.transaction((vaults: Vault[], ts: string) => {
    for (const v of vaults) {
      stmts.insert.run({
        vault_id: `${v.chainId}:${v.address}`,
        chain_id: v.chainId,
        protocol: v.protocol.name,
        apy: v.analytics.apy.total ?? null,
        tvl_usd: v.analytics.tvl.usd ?? null,
        captured_at: ts,
      })
    }
  })

  do {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('cursor', cursor)

    const res = await fetch(`${EARN_BASE_URL}/v1/earn/vaults?${query}`)
    if (!res.ok) {
      console.error(`快照抓取失败: ${res.status} ${res.statusText}`)
      return
    }

    const data: { data: Vault[]; nextCursor?: string } = await res.json()
    const vaults = data.data ?? []

    insertMany(vaults, startAt)
    total += vaults.length
    cursor = data.nextCursor
    page++

    console.log(`  第 ${page} 页: ${vaults.length} 条，已写入 ${total} 条`)
  } while (cursor)

  console.log(`✅ 快照完成，共写入 ${total} 条，耗时 ${Date.now() - new Date(startAt).getTime()}ms`)
}

// 启动定时任务
export function startSnapshotScheduler(): void {
  // 检查最近一次快照时间，超过间隔则立即补一次
  const row = stmts.latestAt.get() as { latest: string | null }
  const latest = row?.latest ? new Date(row.latest).getTime() : 0
  const sinceMs = Date.now() - latest

  if (sinceMs > INTERVAL_MS) {
    console.log(`🕐 距上次快照已超 ${Math.round(sinceMs / 60000)} 分钟，立即补采...`)
    captureSnapshot().catch(console.error)
  } else {
    const nextIn = Math.round((INTERVAL_MS - sinceMs) / 60000)
    console.log(`⏳ 距上次快照 ${Math.round(sinceMs / 60000)} 分钟，${nextIn} 分钟后下次采集`)
  }

  setInterval(() => {
    captureSnapshot().catch(console.error)
  }, INTERVAL_MS)
}
