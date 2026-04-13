'use client'

import { useState } from 'react'

// ============================================================
// 数据常量
// ============================================================

const LIFI_FEATURES = [
  {
    icon: '🏦',
    title: '多协议 Vault 聚合',
    desc: '统一接入 Morpho、Aave、Euler、Pendle、Ethena、EtherFi、Compound 等 20+ 头部协议的收益金库，一个 API 查询全网最优 APY。',
    tags: ['Morpho', 'Aave v3', 'Euler v2', 'Pendle', 'Ethena'],
  },
  {
    icon: '🌐',
    title: '全链覆盖',
    desc: '支持 Ethereum、Arbitrum、Base、Optimism、Polygon、BSC、Avalanche 等 21 条 EVM 链，跨链数据统一索引。',
    tags: ['Ethereum', 'Arbitrum', 'Base', 'Optimism', '+17 条'],
  },
  {
    icon: '⚡',
    title: 'Composer 交易构建',
    desc: '通过 LI.FI Composer API 自动寻路，一笔交易完成跨链存款：从 Ethereum 的 USDC 直接存入 Base 上的 Morpho Vault，无需手动 Bridge。',
    tags: ['跨链存款', '自动寻路', '单笔完成'],
  },
  {
    icon: '📊',
    title: '实时 APY & TVL 数据',
    desc: '提供当前 APY、7 日均值、30 日均值、基础收益率、奖励 APY 分拆，以及 USD/Native 双币 TVL，数据每小时更新。',
    tags: ['APY 分拆', '7d/30d 均值', 'TVL 实时'],
  },
  {
    icon: '🔄',
    title: 'ERC-4626 标准兼容',
    desc: '所有 Vault 均符合 ERC-4626 份额代币标准，Agent 可通过统一接口查询份额数量、执行赎回，无需适配各协议差异。',
    tags: ['ERC-4626', '份额代币', '标准接口'],
  },
  {
    icon: '🛡️',
    title: '路由安全验证',
    desc: 'LI.FI 对接入 Vault 进行安全审计和白名单管理，只有经过验证的协议才会出现在数据中，降低用户误入风险。',
    tags: ['白名单', '安全审计', '风险过滤'],
  },
]

const SYSTEM_LAYERS = [
  {
    id: 'frontend',
    label: '前端应用',
    color: 'indigo',
    icon: '🖥️',
    items: ['Vault 列表 & 筛选', 'AI 自然语言搜索', 'Portfolio 持仓查看', 'APY 历史折线图', '跨链存款/赎回弹窗', 'Vault 多维度比较'],
  },
  {
    id: 'api',
    label: 'Backend API',
    color: 'blue',
    icon: '⚙️',
    items: ['Hono (Node.js)', 'OpenAPI 3.0 文档', 'GLM-4-Flash AI 解析', 'APY 历史采集', '持仓聚合', '报价缓存'],
  },
  {
    id: 'external',
    label: '外部服务',
    color: 'emerald',
    icon: '🔗',
    items: ['LI.FI Earn API（Vault 数据）', 'LI.FI Composer（交易构建）', 'BigModel GLM-4-Flash（AI）', 'DeBank API（持仓）', 'EVM RPC（链上读写）'],
  },
  {
    id: 'agent',
    label: 'Agent Skill',
    color: 'purple',
    icon: '🤖',
    items: ['Claude API (Tool Use)', 'viem 本地签名', '8 个标准工具', 'runMonitorCron 盯盘', '自动迁移策略', 'node-cron 调度'],
  },
]

const CAPABILITIES = [
  {
    icon: '🔍',
    title: 'AI 智能搜索',
    color: 'indigo',
    points: [
      '自然语言理解：「Arbitrum 上 USDC APY 超过 8%」',
      'GLM-4-Flash 解析意图 + Function Calling',
      '多轮对话：「那 Base 上的呢？」追问上下文',
      '推荐结果含 APY 分拆、TVL、推荐理由',
    ],
  },
  {
    icon: '💰',
    title: '跨链存款',
    color: 'blue',
    points: [
      '支持 21 条链之间任意跨链',
      'LI.FI Composer 自动寻路，单笔交易完成',
      '预估执行时间与手续费',
      'ERC-20 授权 + 存款原子化',
    ],
  },
  {
    icon: '📈',
    title: 'Portfolio 持仓',
    color: 'emerald',
    points: [
      '连接钱包查看全链持仓',
      '每个持仓展示当前余额 + 日/月预期收益',
      '持仓与 Vault 卡片联动高亮',
      '赎回/加仓一键操作',
    ],
  },
  {
    icon: '📉',
    title: 'APY 历史追踪',
    color: 'cyan',
    points: [
      '每小时采集各 Vault APY 快照',
      '折线图展示历史波动趋势',
      '7d / 30d 均值对比当前',
      '辅助判断 APY 稳定性',
    ],
  },
  {
    icon: '⚖️',
    title: 'Vault 横向比较',
    color: 'yellow',
    points: [
      '最多 4 个 Vault 同屏对比',
      '多维度：APY、TVL、协议、底层代币',
      'APY 历史走势并排显示',
      '辅助用户做出最优选择',
    ],
  },
  {
    icon: '🤖',
    title: 'Agent Skill / 自动化',
    color: 'purple',
    points: [
      '8 个标准工具供 Agent 框架调用',
      '私钥本地 viem 签名，不经过服务器',
      'runMonitorCron：定时扫描迁移机会',
      'autoMigrate：发现更优 vault 自动迁移',
    ],
  },
]

const TOOLS = [
  { name: 'get_vaults',                    type: '查询', desc: '多条件筛选 Vault 列表' },
  { name: 'ai_search',                     type: '查询', desc: '自然语言搜索最优 Vault' },
  { name: 'get_portfolio',                 type: '查询', desc: '查询钱包全链持仓' },
  { name: 'get_agent_wallet',              type: '查询', desc: '获取 Agent 操作钱包地址' },
  { name: 'execute_deposit',               type: '执行', desc: '跨链存款（签名 + 广播）' },
  { name: 'execute_redeem',                type: '执行', desc: '赎回（签名 + 广播）' },
  { name: 'scan_migration_opportunities',  type: '分析', desc: '扫描更优 Vault 迁移机会' },
  { name: 'execute_migration',             type: '执行', desc: '原子化赎回 → 存入新 Vault' },
]

const TYPE_COLORS: Record<string, string> = {
  查询: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  执行: 'bg-orange-900/50 text-orange-300 border-orange-700/50',
  分析: 'bg-purple-900/50 text-purple-300 border-purple-700/50',
}

const LAYER_COLORS: Record<string, { border: string; bg: string; badge: string; dot: string }> = {
  indigo:  { border: 'border-indigo-800/60',  bg: 'bg-indigo-950/30',  badge: 'bg-indigo-900/60 text-indigo-300',  dot: 'bg-indigo-400' },
  blue:    { border: 'border-blue-800/60',    bg: 'bg-blue-950/30',    badge: 'bg-blue-900/60 text-blue-300',      dot: 'bg-blue-400' },
  emerald: { border: 'border-emerald-800/60', bg: 'bg-emerald-950/30', badge: 'bg-emerald-900/60 text-emerald-300', dot: 'bg-emerald-400' },
  purple:  { border: 'border-purple-800/60',  bg: 'bg-purple-950/30',  badge: 'bg-purple-900/60 text-purple-300',  dot: 'bg-purple-400' },
}

const CAP_COLORS: Record<string, string> = {
  indigo:  'border-indigo-800/40 bg-indigo-950/20',
  blue:    'border-blue-800/40 bg-blue-950/20',
  emerald: 'border-emerald-800/40 bg-emerald-950/20',
  cyan:    'border-cyan-800/40 bg-cyan-950/20',
  yellow:  'border-yellow-800/40 bg-yellow-950/20',
  purple:  'border-purple-800/40 bg-purple-950/20',
}

const CAP_DOT: Record<string, string> = {
  indigo:  'bg-indigo-400',
  blue:    'bg-blue-400',
  emerald: 'bg-emerald-400',
  cyan:    'bg-cyan-400',
  yellow:  'bg-yellow-400',
  purple:  'bg-purple-400',
}

// ============================================================
// 页面组件
// ============================================================

export default function AboutPage() {
  const [activeLayer, setActiveLayer] = useState<string | null>(null)

  return (
    <div className="space-y-16 pb-20">

      {/* ══ Hero ══════════════════════════════════════════════ */}
      <section className="relative rounded-2xl overflow-hidden border border-indigo-900/40 bg-gradient-to-br from-indigo-950/60 via-gray-900 to-gray-900 px-8 py-12">
        {/* 背景装饰 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600/5 rounded-full blur-3xl" />
        </div>

        <div className="relative">
          {/* 徽章 */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-indigo-900/60 border border-indigo-700/50 text-indigo-300 tracking-wider uppercase">
              LI.FI Hackathon · DeFi Track
            </span>
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-blue-900/60 border border-blue-700/50 text-blue-300">
              基于 LI.FI Earn API
            </span>
          </div>

          <h1 className="text-4xl font-black text-white mb-3 leading-tight">
            DeFi Yield Hub
          </h1>
          <p className="text-gray-400 text-base mb-8 max-w-2xl leading-relaxed">
            多链 DeFi 收益聚合器 — 通过 LI.FI Earn 统一接入 20+ 协议、21+ 链的收益金库，
            内置 AI 搜索、跨链存款、持仓追踪，并提供可被任意 Agent 框架调用的 Skill 接口，支持定时盯盘与自动迁移策略。
          </p>

          {/* 关键数字 */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { value: '300+', label: 'Vault 数量', sub: '实时更新' },
              { value: '20+',  label: '支持协议',  sub: 'Morpho / Aave / Euler…' },
              { value: '21',   label: '支持链数',  sub: 'EVM 全覆盖' },
              { value: '8',    label: 'Agent 工具', sub: '含盯盘/迁移' },
            ].map(stat => (
              <div key={stat.label} className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3">
                <p className="text-2xl font-black text-white">{stat.value}</p>
                <p className="text-xs font-semibold text-gray-300 mt-0.5">{stat.label}</p>
                <p className="text-[10px] text-gray-600">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ LI.FI Earn ════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1 h-6 rounded-full bg-blue-500" />
          <h2 className="text-xl font-bold text-white">什么是 LI.FI Earn？</h2>
        </div>

        {/* 简介卡 */}
        <div className="bg-gradient-to-r from-blue-950/40 to-gray-900 border border-blue-800/40 rounded-2xl p-6 mb-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-900/60 border border-blue-700/50 flex items-center justify-center text-2xl flex-shrink-0">
              🔷
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-white mb-2">LI.FI Protocol — DeFi 基础设施层</h3>
              <p className="text-sm text-gray-400 leading-relaxed mb-3">
                LI.FI 是领先的多链 DeFi 聚合协议，通过统一 API 接入全链桥接、DEX 聚合和收益产品。
                <strong className="text-blue-300"> LI.FI Earn</strong> 是其收益专项模块，
                将分散在各链各协议的 ERC-4626 收益金库统一索引，并通过
                <strong className="text-blue-300"> Composer API</strong> 让用户一笔交易完成跨链存款。
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {['统一数据索引', '跨链 Bridge 自动寻路', 'ERC-4626 标准', 'Composer 交易构建', '安全白名单'].map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded border bg-blue-950/40 border-blue-800/40 text-blue-300">
                    {t}
                  </span>
                ))}
              </div>
              {/* 官方链接 */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-blue-900/40">
                <span className="text-[10px] text-gray-600 self-center mr-1">官方文档：</span>
                {[
                  { label: '官网',             href: 'https://li.fi' },
                  { label: 'LI.FI Earn 文档',  href: 'https://docs.li.fi/li.fi-api/earn' },
                  { label: 'Composer API',      href: 'https://docs.li.fi/li.fi-api/li.fi-composer' },
                  { label: 'API Reference',     href: 'https://apidocs.li.fi' },
                  { label: 'GitHub',            href: 'https://github.com/lifinance' },
                ].map(link => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-950/40 border border-blue-800/50 hover:border-blue-600/60 px-2.5 py-1 rounded-lg transition-all"
                  >
                    {link.label}
                    <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 10 10" fill="none">
                      <path d="M1 9L9 1M9 1H3M9 1V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 6 个特性卡 */}
        <div className="grid grid-cols-2 gap-4">
          {LIFI_FEATURES.map(feat => (
            <div key={feat.title} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-5 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0 mt-0.5">{feat.icon}</span>
                <div>
                  <h4 className="text-sm font-bold text-white mb-1.5">{feat.title}</h4>
                  <p className="text-xs text-gray-400 leading-relaxed mb-2.5">{feat.desc}</p>
                  <div className="flex flex-wrap gap-1">
                    {feat.tags.map(t => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700/50">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ 系统架构 ═══════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1 h-6 rounded-full bg-indigo-500" />
          <h2 className="text-xl font-bold text-white">系统架构</h2>
          <span className="text-xs text-gray-500">点击模块查看详情</span>
        </div>

        {/* 架构图 */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">

          {/* 四层模块 */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {SYSTEM_LAYERS.map(layer => {
              const c = LAYER_COLORS[layer.color]
              const isActive = activeLayer === layer.id
              return (
                <button
                  key={layer.id}
                  onClick={() => setActiveLayer(isActive ? null : layer.id)}
                  className={`rounded-xl border p-4 text-left transition-all ${c.bg} ${c.border} ${isActive ? 'ring-1 ring-white/20 shadow-lg' : 'hover:brightness-110'}`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">{layer.icon}</span>
                    <span className="text-xs font-bold text-white">{layer.label}</span>
                  </div>
                  <div className="space-y-1.5">
                    {layer.items.map(item => (
                      <div key={item} className="flex items-center gap-1.5">
                        <span className={`w-1 h-1 rounded-full flex-shrink-0 ${c.dot}`} />
                        <span className="text-[10px] text-gray-400 leading-tight">{item}</span>
                      </div>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 数据流连线示意 */}
          <div className="border-t border-gray-800/80 pt-5">
            <p className="text-[10px] text-gray-600 mb-3 font-medium uppercase tracking-wider">数据流向</p>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { from: '🖥️ 前端', to: '⚙️ Backend API', label: 'REST / JSON', color: 'text-indigo-400' },
                { from: '⚙️ Backend', to: '🔷 LI.FI Earn', label: 'GET /vaults', color: 'text-blue-400' },
                { from: '⚙️ Backend', to: '🤖 GLM-4', label: 'AI 搜索', color: 'text-purple-400' },
                { from: '🤖 Agent', to: '⚙️ Backend', label: 'Quote API', color: 'text-orange-400' },
                { from: '🤖 Agent', to: '⛓️ Chain RPC', label: 'viem 签名', color: 'text-emerald-400' },
              ].map(flow => (
                <div key={flow.label} className="flex items-center gap-1.5 bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-1.5">
                  <span className="text-[10px] text-gray-400">{flow.from}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-[10px] text-gray-400">{flow.to}</span>
                  <span className={`text-[9px] font-medium ml-1 ${flow.color}`}>({flow.label})</span>
                </div>
              ))}
            </div>
          </div>

          {/* 安全说明 */}
          <div className="mt-4 flex items-start gap-2.5 bg-emerald-950/20 border border-emerald-800/30 rounded-xl px-4 py-3">
            <span className="text-emerald-400 text-sm flex-shrink-0 mt-px">🔐</span>
            <p className="text-xs text-emerald-300/80 leading-relaxed">
              <strong className="text-emerald-300">私钥安全架构：</strong>
              Agent Skill 运行在用户本地，私钥存于本地 <code className="bg-emerald-950/60 px-1 rounded text-[10px]">.env</code> 文件，
              viem 在本机完成签名和广播。后端 API 只返回未签名的 <code className="bg-emerald-950/60 px-1 rounded text-[10px]">transactionRequest</code>，
              私钥从不离开用户设备。
            </p>
          </div>
        </div>
      </section>

      {/* ══ 核心能力 ═══════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1 h-6 rounded-full bg-emerald-500" />
          <h2 className="text-xl font-bold text-white">核心能力</h2>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {CAPABILITIES.map(cap => (
            <div key={cap.title} className={`rounded-2xl border p-5 ${CAP_COLORS[cap.color]}`}>
              <div className="flex items-center gap-2.5 mb-4">
                <span className="text-xl">{cap.icon}</span>
                <h3 className="text-sm font-bold text-white">{cap.title}</h3>
              </div>
              <ul className="space-y-2">
                {cap.points.map(pt => (
                  <li key={pt} className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${CAP_DOT[cap.color]}`} />
                    <span className="text-[11px] text-gray-400 leading-relaxed">{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ══ Agent Skill & 工具表 ═══════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1 h-6 rounded-full bg-purple-500" />
          <h2 className="text-xl font-bold text-white">Agent Skill 接口</h2>
        </div>

        <div className="grid grid-cols-5 gap-5">
          {/* 左侧：说明 */}
          <div className="col-span-2 space-y-4">
            <div className="bg-purple-950/20 border border-purple-800/40 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-2">本地签名架构</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Skill 文件运行在 Agent 框架本地，通过 viem 读取私钥并直接签名广播，
                后端 API 仅负责返回无签名交易体。支持 Claude API、LangChain、AutoGen 等任意框架接入。
              </p>
            </div>

            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-3">定时盯盘策略</h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5">1.</span>
                  <span><code className="text-purple-300 bg-purple-950/40 px-1 rounded text-[10px]">scan_migration_opportunities</code> 扫描同链更优 Vault</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5">2.</span>
                  <span>按年化增收排序，筛选 APY 提升 ≥ N%、TVL ≥ $M</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5">3.</span>
                  <span><code className="text-purple-300 bg-purple-950/40 px-1 rounded text-[10px]">execute_migration</code> 赎回旧 Vault → 存入新 Vault</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5">4.</span>
                  <span>可配置 <code className="text-purple-300 bg-purple-950/40 px-1 rounded text-[10px]">onOpportunity</code> 回调发送通知</span>
                </div>
              </div>
            </div>

            {/* 调用方式 */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-[10px] text-gray-600 mb-2 uppercase tracking-wider font-medium">快速启动</p>
              <pre className="text-[10px] text-gray-300 font-mono leading-relaxed whitespace-pre-wrap">{`# 对话模式
npm run dev "找 USDC 收益最高的 vault"

# 盯盘模式（每小时 cron）
npm run dev cron --auto-migrate \\
  --min-apy=3 --min-tvl=5000000`}</pre>
            </div>
          </div>

          {/* 右侧：工具列表 */}
          <div className="col-span-3 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm font-bold text-white">DEFI_TOOLS（共 8 个）</span>
              <span className="text-[10px] text-gray-500">可直接传入 Claude API tools 参数</span>
            </div>
            <div className="divide-y divide-gray-800/60">
              {TOOLS.map(tool => (
                <div key={tool.name} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/40 transition-colors">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded border flex-shrink-0 ${TYPE_COLORS[tool.type]}`}>
                    {tool.type}
                  </span>
                  <code className="text-xs text-indigo-300 font-mono flex-1">{tool.name}</code>
                  <span className="text-[11px] text-gray-500 text-right">{tool.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ Tech Stack ════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1 h-6 rounded-full bg-gray-500" />
          <h2 className="text-xl font-bold text-white">技术栈</h2>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            {
              layer: '前端',
              icon: '🖥️',
              items: [
                ['Next.js 16', 'App Router + Turbopack'],
                ['Tailwind CSS', '深色主题 + 响应式'],
                ['TanStack Query v5', '无限滚动 + 缓存'],
                ['wagmi v2 + viem', '钱包连接'],
                ['Recharts', 'APY 折线图'],
              ],
            },
            {
              layer: 'Backend',
              icon: '⚙️',
              items: [
                ['Hono', 'Node.js 高性能框架'],
                ['OpenAPI 3.0', 'Scalar UI 文档'],
                ['GLM-4-Flash', 'BigModel Function Calling'],
                ['yaml / zod', '配置 & 类型校验'],
                ['LI.FI Earn API', 'Vault 数据源'],
              ],
            },
            {
              layer: 'Agent Skill',
              icon: '🤖',
              items: [
                ['Anthropic SDK', 'Claude API Tool Use'],
                ['viem', 'ERC-20 授权 + 签名广播'],
                ['tsx', 'TypeScript 直接运行'],
                ['node-cron', '定时盯盘调度'],
                ['LI.FI Composer', '跨链交易构建'],
              ],
            },
          ].map(col => (
            <div key={col.layer} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">{col.icon}</span>
                <span className="text-sm font-bold text-white">{col.layer}</span>
              </div>
              <div className="space-y-2.5">
                {col.items.map(([name, desc]) => (
                  <div key={name} className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-gray-200 font-mono">{name}</span>
                    <span className="text-[10px] text-gray-500 text-right leading-tight">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ 快速入口 ═══════════════════════════════════════════ */}
      <section className="grid grid-cols-3 gap-4">
        {[
          {
            icon: '🏦',
            title: '探索 Vaults',
            desc: '查看全网 300+ 收益金库，AI 搜索 + 一键存款',
            href: '/',
            btnLabel: '前往 Vaults →',
            color: 'indigo',
          },
          {
            icon: '💼',
            title: '查看 Portfolio',
            desc: '连接钱包，查看全链持仓收益和预期收益',
            href: '/portfolio',
            btnLabel: '查看持仓 →',
            color: 'emerald',
          },
          {
            icon: '⚡',
            title: 'Agent Skill 接入',
            desc: '查看 API 文档和 Skill 接入指南，把 DeFi 操作接入你的 Agent',
            href: '/docs',
            btnLabel: '查看 SKILL 文档 →',
            color: 'purple',
          },
        ].map(card => (
          <a
            key={card.title}
            href={card.href}
            className={`block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-2xl p-5 transition-all hover:shadow-lg hover:shadow-black/30 group`}
          >
            <span className="text-2xl">{card.icon}</span>
            <h3 className="text-sm font-bold text-white mt-3 mb-1.5 group-hover:text-indigo-200 transition-colors">
              {card.title}
            </h3>
            <p className="text-xs text-gray-400 mb-4 leading-relaxed">{card.desc}</p>
            <span className="text-xs font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors">
              {card.btnLabel}
            </span>
          </a>
        ))}
      </section>

    </div>
  )
}
