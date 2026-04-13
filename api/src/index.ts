import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { vaultsRouter } from './routes/vaults.js'
import { portfolioRouter } from './routes/portfolio.js'
import { chainsRouter } from './routes/chains.js'
import { protocolsRouter } from './routes/protocols.js'
import { depositRouter } from './routes/deposit.js'
import { historyRouter } from './routes/history.js'
import { searchRouter } from './routes/search.js'
import { redeemRouter } from './routes/redeem.js'
import './services/db.js'  // 初始化数据库（建表）
import { startSnapshotScheduler } from './services/snapshot.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = new Hono()

// 中间件
app.use('*', cors())
app.use('*', logger())

// 健康检查
app.get('/', (c) => c.json({ status: 'ok', service: 'DeFi Yield Hub API' }))

// OpenAPI JSON spec（从 yaml 转换）
app.get('/openapi.json', (c) => {
  try {
    const yamlPath = resolve(__dirname, '../../openapi.yaml')
    const raw = readFileSync(yamlPath, 'utf-8')
    const spec = yaml.load(raw)
    return c.json(spec)
  } catch {
    return c.json({ error: 'openapi.yaml 未找到' }, 404)
  }
})

// Scalar API 文档 UI（通过 CDN 嵌入）
app.get('/scalar', (c) => {
  const port = Number(process.env.PORT) || 3000
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>DeFi Yield Hub — API Docs</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script
    id="api-reference"
    data-url="http://localhost:${port}/openapi.json"
    data-configuration='{"theme":"purple","darkMode":true,"layout":"modern"}'
  ></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`
  return c.html(html)
})

// 路由
app.route('/vaults', vaultsRouter)
app.route('/portfolio', portfolioRouter)
app.route('/chains', chainsRouter)
app.route('/protocols', protocolsRouter)
app.route('/deposit', depositRouter)
app.route('/history', historyRouter)
app.route('/search', searchRouter)
app.route('/redeem', redeemRouter)

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, () => {
  console.log(`🚀 DeFi Yield Hub API 运行中: http://localhost:${port}`)
  // 启动 APY 快照定时任务
  startSnapshotScheduler()
})
