import { useEffect, useRef, useState } from 'react'
import type { Series, SignalInfo } from './api'
import { hm, wall } from './evidence'

// Plant order, upstream to downstream
export const ORDER = ['S1', 'T1', 'S2', 'S3', 'S4a', 'S4b', 'S4c']
const ROW = 50 // a record in the background
const FOCUS = 108 // a record the finding rests on
const LEFT = 64

type Props = {
  series: Series
  info: SignalInfo
  shown: string[]
  range: [Date, Date]
  highlight: { signals: string[]; start?: Date; end?: Date } | null
  bands?: { start: Date; end: Date }[] // what a factory record claims
  focusRow?: number // height of a highlighted record's row (the case file's stage shows one or two records large)
}

/** Stacked signals on one time axis, in iteration 02's chart style. Gaps stay gaps. */
export function Timeline({ series, info, shown, range, highlight, bands = [], focusRow = FOCUS }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const times = series.times.map(wall)
  const [t0, t1] = range
  const span = t1.getTime() - t0.getTime()
  const x = (t: Date) => LEFT + ((t.getTime() - t0.getTime()) / span) * (width - LEFT - 6)
  const stepH = span > 30 * 3600_000 ? 6 : span > 14 * 3600_000 ? 3 : 2
  const ticks: Date[] = []
  const first = new Date(t0); first.setMinutes(0, 0, 0)
  for (let t = new Date(first.getTime() + 3600_000); t < t1; t = new Date(t.getTime() + 3600_000)) if (t.getHours() % stepH === 0) ticks.push(t)
  const heights = shown.map((s) => (highlight?.signals.includes(s) ? focusRow : ROW))
  const tops = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0))
  const body = heights.reduce((a, b) => a + b, 0)
  const height = body + 22

  return (
    <div ref={box} className="timeline">
      <svg width={width} height={height} role="img" aria-label={`Records ${shown.join(', ')} from ${hm(t0)} to ${hm(t1)}`}>
        {bands.map((b, i) => (
          <rect key={i} className="band-claim" x={x(b.start)} y={0} width={Math.max(2, x(b.end) - x(b.start))} height={body} />
        ))}
        {highlight?.start && highlight.end && (
          <rect className="band-check" x={x(highlight.start)} y={0} width={Math.max(3, x(highlight.end) - x(highlight.start))} height={body} />
        )}
        {shown.map((sig, row) => {
          const top = tops[row], rh = heights[row]
          const vals = series.series[sig] ?? []
          const pts = times.map((t, i) => [t, vals[i]] as const).filter(([t]) => t >= t0 && t <= t1)
          const nums = pts.map(([, v]) => v).filter((v): v is number => v !== null)
          const exp = sig === 'S3' ? series.series.S3_expected ?? [] : []
          const half = series.power_band_half_width_kw ?? 0
          const expPts = times.map((t, i) => [t, exp[i] ?? null] as const).filter(([t, v]) => t >= t0 && t <= t1 && v !== null) as [Date, number][]
          const lo = sig === 'S4b' ? 5 : 0
          const hi = sig === 'T1' ? 1 : sig === 'S4b' ? 11 : Math.max(1, ...nums, ...expPts.map(([, v]) => v + half)) * 1.08
          const y = (v: number) => top + 8 + (1 - (v - lo) / (hi - lo)) * (rh - 22)
          let d = '', pen = false
          for (const [t, v] of pts) {
            if (v === null) { pen = false; continue }
            d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`
            pen = true
          }
          const on = !highlight || highlight.signals.includes(sig)
          return (
            <g key={sig}>
              <path className="grid" d={`M${LEFT} ${top + rh - 14}H${width - 6}`} />
              <text className="row-code" x={0} y={top + 18} data-on={highlight?.signals.includes(sig) || undefined}>{sig}</text>
              <text x={0} y={top + 31}>{short(info[sig]?.[0])}</text>
              <text x={0} y={top + 42}>{info[sig]?.[1]?.replace('fraction of volume', 'share full')}</text>
              {expPts.length > 1 && (
                <path className="band-expected" d={`M${expPts.map(([t, v]) => `${x(t).toFixed(1)} ${y(v + half).toFixed(1)}`).join('L')}L${expPts.slice().reverse().map(([t, v]) => `${x(t).toFixed(1)} ${y(Math.max(lo, v - half)).toFixed(1)}`).join('L')}Z`} />
              )}
              {nums.length === 0 ? (
                <>
                  <rect className="gap-box" x={LEFT} y={top + 6} width={width - LEFT - 6} height={rh - 22} rx={4} />
                  <text className="gap-text" x={(width + LEFT) / 2} y={top + rh / 2} textAnchor="middle">A record should be here. A gap, not a verdict.</text>
                </>
              ) : (
                <path className={on ? 'data-line' : 'data-line muted'} d={d} />
              )}
            </g>
          )
        })}
        {ticks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 4} textAnchor="middle">{t.getHours() === 0 ? `${t.getDate()} ${t.toLocaleString('en', { month: 'short' })}` : hm(t)}</text>
        ))}
      </svg>
    </div>
  )
}

const short = (s?: string) => (s ?? '').replace('Equalization tank level', 'Tank level').replace('Outfall conductivity', 'Conductivity')
