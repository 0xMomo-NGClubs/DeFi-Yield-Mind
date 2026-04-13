import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../../data/snapshots.db')

// 确保 data 目录存在
import fs from 'fs'
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)

// 开启 WAL 模式，提升并发读写性能
db.pragma('journal_mode = WAL')

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS apy_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_id    TEXT    NOT NULL,
    chain_id    INTEGER NOT NULL,
    protocol    TEXT    NOT NULL,
    apy         REAL,
    tvl_usd     TEXT,
    captured_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vault_time
    ON apy_snapshots (vault_id, captured_at);
`)

// 预编译语句
export const stmts = {
  insert: db.prepare(`
    INSERT INTO apy_snapshots (vault_id, chain_id, protocol, apy, tvl_usd, captured_at)
    VALUES (@vault_id, @chain_id, @protocol, @apy, @tvl_usd, @captured_at)
  `),

  // 查询某个 vault 的历史记录，按时间升序
  history: db.prepare(`
    SELECT apy, tvl_usd, captured_at
    FROM apy_snapshots
    WHERE vault_id = ?
    ORDER BY captured_at ASC
    LIMIT ?
  `),

  // 最近一次快照时间（用于判断是否需要立即抓取）
  latestAt: db.prepare(`
    SELECT MAX(captured_at) AS latest FROM apy_snapshots
  `),
}

console.log(`📦 数据库已就绪: ${DB_PATH}`)
