import { useEffect, useLayoutEffect, useState } from 'react'
import { STATUS_LABEL, type Status } from './api'

const STAMP: Record<Status, string> = {
  supports: 'bg-indigo text-white',
  contradicts: 'bg-coral text-ink',
  review_required: 'bg-acid text-ink',
  insufficient: 'bg-white text-ink border border-dashed border-ink',
}

/** The status as a woven-label stamp. */
export function Stamp({ status, small }: { status: Status | null; small?: boolean }) {
  if (!status) return null
  return (
    <span className={`inline-flex items-center gap-2 rounded-md ${small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm'} font-display font-bold tracking-tight ${STAMP[status]}`}
      style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,.08) 0 2px, transparent 2px 4px)' }}>
      {STATUS_LABEL[status]}
    </span>
  )
}

/** A stitched thread between two elements on the page, redrawn on scroll and resize. */
export function Thread({ from, to }: { from: string | null; to: string | null }) {
  const [d, setD] = useState<string | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const draw = () => {
      const a = from && document.getElementById(from)
      const b = to && document.getElementById(to)
      if (!a || !b) return setD(null)
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      if (!ra.width || !rb.width) return setD(null)
      const x1 = ra.right, y1 = ra.top + ra.height / 2
      const x2 = rb.left, y2 = rb.top + Math.min(rb.height / 2, 40)
      const mid = (x1 + x2) / 2
      setD(`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
    schedule()
    const t = setTimeout(schedule, 120) // after images settle
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => { cancelAnimationFrame(frame); clearTimeout(t); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [from, to])
  if (!d) return null
  return (
    <svg className="pointer-events-none fixed inset-0 z-30 h-full w-full" aria-hidden="true">
      <path d={d} fill="none" stroke="#4945ff" strokeWidth={2.5} strokeDasharray="6 5" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#e5ff52" strokeWidth={1} strokeDasharray="6 5" strokeDashoffset={3} />
    </svg>
  )
}

export function useWidth(id: string, fallback = 640) {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = document.getElementById(id)
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [id])
  return w
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
