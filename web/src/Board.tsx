import type { Explanation } from './api'
import { parseEvidence } from './evidence'

const STATE: Record<Explanation['status'], { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'border-ink/20 bg-white' },
  supported: { label: 'Supported', cls: 'border-indigo bg-indigo-soft' },
  contradicted: { label: 'Ruled out', cls: 'border-rule bg-paper opacity-70' },
}

type Props = { explanations: Explanation[]; onPick: (evidenceId: string) => void; active: string | null }

/** The competing explanations and the evidence that decided each one. Ruled-out stories stay visible. */
export function Board({ explanations, onPick, active }: Props) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Competing explanations">
      {explanations.map((e) => {
        const s = STATE[e.status]
        const chips = e.status === 'contradicted' ? e.contradicting : e.supporting.length ? e.supporting : e.contradicting
        return (
          <li key={e.id} className={`rounded-xl border p-3 transition-all duration-500 ${s.cls}`}>
            <div className="flex items-start justify-between gap-3">
              <p className={`text-sm font-semibold leading-snug ${e.status === 'contradicted' ? 'line-through decoration-ink/30' : ''}`}>{e.label}</p>
              <span className={`micro shrink-0 rounded-full px-2 py-0.5 ${e.status === 'supported' ? 'bg-indigo text-white' : e.status === 'open' ? 'bg-acid' : 'bg-rule'}`}>{s.label}</span>
            </div>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.slice(0, 4).map((id) => {
                  const t = parseEvidence(id)
                  return (
                    <button key={id} onClick={() => onPick(id)}
                      className={`rounded-md border px-2 py-0.5 text-[11px] ${active === id ? 'border-indigo bg-indigo text-white' : 'border-rule bg-white hover:border-indigo'}`}>
                      {t.kind === 'doc' ? docLabel(id) : chipLabel(t.label, t.signals, t.start, t.end)}
                    </button>
                  )
                })}
              </div>
            )}
            {e.missing.length > 0 && <p className="mt-2 text-xs text-mute">Missing: {e.missing.join(', ')}</p>}
          </li>
        )
      })}
    </ul>
  )
}

function chipLabel(label: string, signals: string[], start?: Date, end?: Date) {
  const span = start && end ? ` ${start.toTimeString().slice(0, 5)}–${end.toTimeString().slice(0, 5)}` : ''
  if (label === 'Document') return docName(signals)
  return `${label === signals[0] ? signals[0] : label}${span}`
}

const docName = (signals: string[]) => (signals.length ? `${signals[0]} meter photo` : 'Document')
function docLabel(id: string) {
  if (id.includes('photo-')) return `Meter photo ${id.match(/photo-(\w+)-/)?.[1] ?? ''}`
  if (id.includes('lab-')) return 'Lab report'
  if (id.includes('logbook')) return 'Logbook'
  if (id.includes('maintenance')) return 'Maintenance record'
  if (id.includes('statement')) return 'Operator statement'
  if (id.includes('submission')) return 'Factory submission'
  return 'Document'
}
