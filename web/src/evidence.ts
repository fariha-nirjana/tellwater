// Evidence IDs as the investigator's tools return them, e.g.
//   sig:S3@1013-1400..1013-1800        a signal over a window
//   calc:water_balance@1013-1420..1013-1800
//   calc:reading_vs_feed:S3@1013-1531  a photo reading checked against the feed
//   calc:compare:S3@1013-1400..1014-1800
//   doc:photo-S3-1013-1530             a document
// The interface uses them to decide what to highlight.

export type Target = { kind: 'signal' | 'calc' | 'doc' | 'alert' | 'other'; id: string; signals: string[]; start?: Date; end?: Date; doc?: string; label: string }

export const CALC_SIGNALS: Record<string, string[]> = {
  water_balance: ['S1', 'S2', 'S4a', 'T1'],
  power_vs_load: ['S2', 'S3'],
}
const CALC_LABEL: Record<string, string> = {
  water_balance: 'Water balance', power_vs_load: 'Power vs load', reading_vs_feed: 'Photo vs feed', compare: 'Replay check',
}

function stamp(s: string, year: number): Date {
  // "1013-1400" -> 13 Oct, 14:00 (factory local time, shown as written)
  const [md, hm] = s.split('-')
  return new Date(year, Number(md.slice(0, 2)) - 1, Number(md.slice(2)), Number(hm.slice(0, 2)), Number(hm.slice(2)))
}

export function parseEvidence(id: string, year = 2026): Target {
  const [head, span] = id.split('@')
  let start: Date | undefined, end: Date | undefined
  if (span) {
    const [a, b] = span.split('..')
    start = stamp(a, year)
    end = b ? stamp(b, year) : new Date(start.getTime() + 10 * 60_000)
  }
  if (head.startsWith('sig:')) {
    const s = head.slice(4)
    return { kind: 'signal', id, signals: [s], start, end, label: s }
  }
  if (head.startsWith('calc:')) {
    const parts = head.slice(5).split(':')
    const name = parts[0]
    const signals = parts[1] ? [parts[1]] : CALC_SIGNALS[name] ?? []
    return { kind: 'calc', id, signals, start, end, label: CALC_LABEL[name] ?? name.replace(/_/g, ' ') }
  }
  if (head.startsWith('doc:')) {
    const photo = head.match(/photo-(S\d[a-c]?)-(\d{4})-(\d{4})/)
    const lab = head.match(/lab-(\d{4})-(\d{4})/)
    if (photo || lab) {
      // a photo or a grab sample is a moment: show where it sits on the timeline
      start = photo ? stamp(`${photo[2]}-${photo[3]}`, year) : stamp(`${lab![1]}-${lab![2]}`, year)
      end = new Date(start.getTime() + 10 * 60_000)
    }
    return { kind: 'doc', id, signals: photo ? [photo[1]] : lab ? ['S4b'] : [], start, end, doc: id, label: 'Document' }
  }
  if (head.startsWith('alert:')) return { kind: 'alert', id, signals: [], start, end, label: 'Alert' }
  return { kind: 'other', id, signals: [], label: id }
}

/** Local wall-clock time from the API's "YYYY-MM-DD HH:MM" or ISO strings, ignoring the zone suffix. */
export function wall(s: string): Date {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return new Date(s)
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
}

export const hm = (d: Date) => d.toTimeString().slice(0, 5)
export const dayHm = (d: Date) => `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${hm(d)}`

/** A short name for a document from its ID. */
export function docLabel(id: string) {
  if (id.includes('photo-')) return `Meter photo ${id.match(/photo-(\w+?)-/)?.[1] ?? ''}`.trim()
  if (id.includes('lab-')) return 'Lab report'
  if (id.includes('logbook')) return 'Logbook'
  if (id.includes('maintenance')) return 'Maintenance record'
  if (id.includes('statement')) return 'Operator statement'
  if (id.includes('submission')) return 'Factory submission'
  return 'Document'
}
