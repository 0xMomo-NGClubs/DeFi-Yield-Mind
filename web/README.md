# DeFi Yield Hub — 前端（Next.js）

Next.js 16 App Router 前端，调用本项目后端 API 展示 DeFi 收益机会与用户持仓。

## 本地启动

```bash
cd web
npm install
npm run dev
```

访问 `http://localhost:3001`（后端默认 3000，前端 3001）。

## 页面结构

| 路由 | 文件 | 说明 |
|------|------|------|
| `/` | `app/page.tsx` | Vault 列表，筛选/排序，一键存款 |
| `/portfolio` | `app/portfolio/page.tsx` | 持仓看板，持仓详情，迁移推荐 |

## 组件说明

### `VaultCard`
首页 Vault 列表卡片，展示协议、APY、TVL、底层代币，点击存款触发 `DepositModal`。

### `DepositModal`
存款弹窗。流程：连接钱包 → 输入金额 → 获取报价 → 授权 ERC-20 → 发送交易。

**重要**：授权状态使用本地 `approved` boolean，不依赖 `refetchAllowance()`：

```ts
const [approved, setApproved] = useState(false)
const needsApproval = !approved && allowance < amount

useEffect(() => {
  if (approveConfirmed) setApproved(true)
}, [approveConfirmed])
```

切换 tab 时调 `setApproved(false)` 重置状态。

### `VaultDetailModal`
Vault 详情弹窗。Props：

```ts
interface Props {
  vault: Vault
  currentVault?: Vault   // 持仓对比（可选）
  position?: Position    // 用于计算预期收益（可选）
  onClose: () => void
  onMigrate?: () => void // portfolio 场景显示迁移按钮
  onDeposit?: () => void // 普通存款按钮
}
```

内容包括：协议/链/标签 header、Vault 名称与底层代币、APY 大卡（4xl 字号 + 1d/7d/30d 均值 + 折线图）、统计数据（TVL/可赎回/存款方式数）、与持仓对比面板（并排 APY + 年化多赚 + 月收益）、合约地址、操作按钮。

APY 历史通过 `getVaultHistory(chainId, address, 90)` 加载，优先用真实快照渲染折线图，回退到 `apy1d/apy7d/apy30d` 静态点。

### `MigrateModal`
两步迁移弹窗。Props：

```ts
interface Props {
  fromVault: Vault
  toVault: Vault
  position: Position
  onClose: () => void
}
```

状态机阶段（`stage`）：

```
overview
  → step1_quoting   (调 createRedeemQuote)
  → step1_confirm   (展示报价)
  → step1_approve   (授权 LP 份额，可选)
  → step1_send      (发送赎回 tx)
  → step1_done      (赎回完成)
  → step2_quoting   (调 createDepositQuote，金额 = redeemQuote.estimate.toAmount)
  → step2_confirm   (展示报价)
  → step2_approve   (授权底层代币，可选)
  → step2_send      (发送存款 tx)
  → done            (迁移完成)
```

同样使用 `redeemApproved` / `depositApproved` boolean 避免授权刷新问题。

### `ApySparkline`
APY 折线迷你图，两种模式：
- `mode="dynamic"`：传入完整 `snapshots[]`，用实际 apy 值绘制
- 默认静态模式：传入 `apy30d / apy7d / apy1d / apyCurrent` 四个点

### `VaultFilter`
首页筛选条，协议/链/代币/最低 APY 多维度筛选。

### `WalletAssets`
显示已连接钱包的资产余额，供存款弹窗选择存入金额参考。

### `NavBar`
顶部导航，包含 ConnectButton（RainbowKit）。

## 关键技术模式

### SSR 水合修复

`useAccount()` 在服务端返回空，导致 React hydration mismatch：

```tsx
const [mounted, setMounted] = useState(false)
useEffect(() => { setMounted(true) }, [])

// 所有依赖钱包状态的 JSX：
{mounted && (
  <WalletDisplay address={address} />
)}
```

### ERC-20 授权完整流程

```ts
// 1. 读取当前 allowance
const { data: allowance, refetch } = useReadContract({
  abi: erc20Abi, functionName: 'allowance',
  args: [userAddress, spender],
  enabled: !!userAddress,
})

// 2. 发送授权 tx
const { writeContractAsync } = useWriteContract()

// 3. 等待确认
const { data: approveTxHash } = // ...来自 writeContractAsync
const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash })

// 4. 本地状态更新（不要依赖 refetch）
const [approved, setApproved] = useState(false)
useEffect(() => {
  if (approveConfirmed) setApproved(true)
}, [approveConfirmed])

const needsApproval = !approved && allowance != null && allowance < amount
```

### 持仓 → Vault 匹配

Portfolio API 的 `protocolName`（如 `"Aave V3"`）与 Vault API 的 `protocol.name`（如 `"aave-v3"`）格式不同：

```ts
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function matchesProtocol(posProtocol: string, vaultProtocol: string) {
  const a = slugify(posProtocol)
  const b = slugify(vaultProtocol)
  return a.includes(b) || b.includes(a)
}
```

### 更优 Vault 推荐

```ts
// 按 (chainId, symbol) 分组，各发一次 API 请求
const bestAlts = useQueries({
  queries: uniqueSymbols.map(({ chainId, symbol }) => ({
    queryKey: ['vaults-best', chainId, symbol],
    queryFn: () => getVaults({ chainId, asset: symbol, sortBy: 'apy', limit: 5 }),
    select: (data) => data.vaults.find(v =>
      !matchesProtocol(position.protocolName, v.protocol.name) &&
      (v.analytics.apy.total ?? 0) > (currentApy ?? 0) + 0.5
    ),
  }))
})
```

## 已知问题 & 后续改进点

- [ ] **MigrateModal 赎回金额**：`position.balanceNative` 作为赎回 `fromAmount`，对于非 1:1 锚定的 LP token（如 Curve LP）可能不准确，需要读取 vault 合约计算实际 LP 数量
- [ ] **步骤2存款金额精度**：使用 `redeemQuote.estimate.toAmount`（字符串），需确认 decimals 与目标 vault 底层 token 一致
- [ ] **跨链迁移**：当前迁移仅支持同链，`fromVault.chainId === toVault.chainId`，跨链场景需要处理 bridge 等待
- [ ] **网络切换**：`MigrateModal` 内含 `useSwitchChain`，但切换失败时缺少用户友好提示
- [ ] **持仓页 skeleton**：加载中状态目前是 spinner，可改为 skeleton card 提升体验
- [ ] **VaultDetailModal APY 历史**：`getVaultHistory` 对部分协议返回空，此时回退到静态 4 点折线，视觉上较平，可加 `--` 占位说明
