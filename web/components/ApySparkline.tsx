interface Point {
  x: number  // 时间戳 ms 或索引
  y: number  // APY 值
}

interface StaticProps {
  mode?: 'static'
  apy30d: number | null
  apy7d: number | null
  apy1d: number | null
  apyCurrent: number | null
  width?: number
  height?: number
}

interface DynamicProps {
  mode: 'dynamic'
  snapshots: { capturedAt: string; apy: number | null }[]
  width?: number
  height?: number
}

type Props = StaticProps | DynamicProps

function buildStaticPoints(props: StaticProps): Point[] {
  const slots = [
    { offset: 30 * 24 * 60, val: props.apy30d },
    { offset: 7 * 24 * 60, val: props.apy7d },
    { offset: 24 * 60, val: props.apy1d },
    { offset: 0, val: props.apyCurrent },
  ]
  const now = Date.now()
  return slots
    .filter((s) => s.val != null)
    .map((s) => ({ x: now - s.offset * 60000, y: s.val! }))
}

function buildDynamicPoints(snapshots: DynamicProps['snapshots']): Point[] {
  return snapshots
    .filter((s) => s.apy != null)
    .map((s) => ({ x: new Date(s.capturedAt).getTime(), y: s.apy! }))
}

function Sparkline({
  points,
  width,
  height,
}: {
  points: Point[]
  width: number
  height: number
}) {
  if (points.length < 2) {
    return <span className="text-xs text-gray-600">--</span>
  }

  const pad = 3
  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  const rangeY = maxY - minY || 1
  const minX = points[0].x
  const maxX = points[points.length - 1].x
  const rangeX = maxX - minX || 1

  const toSvg = (p: Point) => ({
    sx: pad + ((p.x - minX) / rangeX) * (width - pad * 2),
    sy: pad + (1 - (p.y - minY) / rangeY) * (height - pad * 2),
  })

  const svgPts = points.map(toSvg)
  const polyline = svgPts.map((p) => `${p.sx},${p.sy}`).join(' ')

  const first = points[0].y
  const last = points[points.length - 1].y
  const color = last >= first ? '#4ade80' : '#f87171'
  const lastPt = svgPts[svgPts.length - 1]

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle cx={lastPt.sx} cy={lastPt.sy} r="2" fill={color} />
    </svg>
  )
}

export function ApySparkline(props: Props) {
  const width = props.width ?? 80
  const height = props.height ?? 28

  const points =
    props.mode === 'dynamic'
      ? buildDynamicPoints(props.snapshots)
      : buildStaticPoints(props as StaticProps)

  return <Sparkline points={points} width={width} height={height} />
}
