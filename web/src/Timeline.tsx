import type { Series, SignalInfo } from './api'
import { hm, wall } from './evidence'

// Plant order, upstream to downstream
export const ORDER = ['S1', 'T1', 'S2', 'S3', 'S4a', 'S4b', 'S4c']
const H = 74 // height of one signal row
const PAD = { left: 56, right: 16 }

type Band = { start: Date; end: Date; tone: 'claim' | 'evidence' }

type Props = {
  series: Series
  info: SignalInfo
  shown: string[]
  range: [Date, Date]
  highlight: { signals: string[]; start?: Date; end?: Date } | null
  bands?: Band[]
  width: number
  onPick?: (signal: string) => void
}

export function Timeline({ series, info, shown, range, highlight, bands = [], width, onPick }: Props) {
  const times = series.times.map(wall)
  const [t0, t1] = range
  const x = (t: Date) => PAD.left + ((t.getTime() - t0.getTime()) / (t1.getTime() - t0.getTime())) * (width - PAD.left - PAD.right)
  const ticks: Date[] = []
  for (let t = new Date(t0); t <= t1; t = new Date(t.getTime() + 3 * 3600_000)) ticks.push(t)

  return (
    <svg width={width} height={shown.length * H + 26} role="img" aria-label="Signal timeline">
      {bands.map((b, i) => (
        <rect key={i} x={x(b.start)} y={0} width={Math.max(2, x(b.end) - x(b.start))} height={shown.length * H}
          fill={b.tone === 'claim' ? '#fff7cc' : '#f0efff'} opacity={0.9} />
      ))}
      {highlight?.start && highlight.end && (
        <rect id="timeline-band" x={x(highlight.start)} y={0} width={Math.max(3, x(highlight.end) - x(highlight.start))}
          height={shown.length * H} fill="#4945ff" opacity={0.1} stroke="#4945ff" strokeDasharray="3 3" />
      )}
      {shown.map((sig, row) => {
        const vals = series.series[sig] ?? []
        const pts = times.map((t, i) => [t, vals[i]] as const).filter(([t]) => t >= t0 && t <= t1)
        const nums = pts.map(([, v]) => v).filter((v): v is number => v !== null)
        const exp = sig === 'S3' ? (series.series.S3_expected ?? []) : []
        const half = series.power_band_half_width_kw ?? 0
        const expPts = times.map((t, i) => [t, exp[i] ?? null] as const).filter(([t, v]) => t >= t0 && t <= t1 && v !== null) as [Date, number][]
        const lo = sig === 'S4b' ? 5 : 0
        const hi = sig === 'T1' ? 1 : sig === 'S4b' ? 11 : Math.max(1, ...nums, ...expPts.map(([, v]) => v + half)) * 1.1
        const y = (v: number) => row * H + 10 + (1 - (v - lo) / (hi - lo)) * (H - 26)
        // a path that breaks where the record has no reading
        let d = '', pen = false
        for (const [t, v] of pts) {
          if (v === null) { pen = false; continue }
          d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`
          pen = true
        }
        const on = highlight?.signals.includes(sig)
        const missing = nums.length === 0
        return (
          <g key={sig} id={`row-${sig}`} onClick={() => onPick?.(sig)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
            <line x1={PAD.left} x2={width - PAD.right} y1={row * H + H - 16} y2={row * H + H - 16} stroke="#eeedf3" />
            <text x={0} y={row * H + 22} fontSize={11} fontWeight={700} fill={on ? '#4945ff' : '#171735'}>{sig}</text>
            <text x={0} y={row * H + 36} fontSize={9} fill="#767181">{info[sig]?.[1]}</text>
            <text x={0} y={row * H + 48} fontSize={9} fill="#767181">{shortName(info[sig]?.[0])}</text>
            {expPts.length > 1 && (
              <path fill="#4945ff" opacity={0.08} aria-label="Power expected for the inflow"
                d={`M${expPts.map(([t, v]) => `${x(t).toFixed(1)} ${y(v + half).toFixed(1)}`).join('L')}L${expPts.slice().reverse().map(([t, v]) => `${x(t).toFixed(1)} ${y(Math.max(lo, v - half)).toFixed(1)}`).join('L')}Z`} />
            )}
            {missing ? (
              <>
                <rect x={PAD.left} y={row * H + 10} width={width - PAD.left - PAD.right} height={H - 26} rx={4}
                  fill="#f7f7fa" stroke="#dcdbe5" strokeDasharray="4 5" />
                <text x={(width + PAD.left) / 2} y={row * H + H / 2} textAnchor="middle" fontSize={11} fill="#767181">
                  No record here. A gap, not a verdict.
                </text>
              </>
            ) : (
              <path d={d} fill="none" stroke={on ? '#4945ff' : '#171735'} strokeWidth={on ? 2 : 1.3} opacity={on || !highlight ? 1 : 0.45} />
            )}
          </g>
        )
      })}
      {ticks.map((t, i) => (
        <text key={i} x={x(t)} y={shown.length * H + 16} fontSize={9} fill="#767181" textAnchor="middle">
          {t.getHours() === 0 ? `${t.getDate()} ${t.toLocaleString('en', { month: 'short' })}` : hm(t)}
        </text>
      ))}
    </svg>
  )
}

const shortName = (s?: string) => (s ?? '').replace('Equalization tank level', 'Tank level')
