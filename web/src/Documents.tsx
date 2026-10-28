import type { Doc, Line } from './api'
import { hm, wall } from './evidence'

const TYPE_LABEL: Record<string, string> = {
  logbook: 'Logbook page', maintenance_record: 'Maintenance record', operator_statement: 'Operator statement',
  meter_photo: 'Meter photo', lab_report: 'Lab report', factory_submission: 'Factory submission',
}
const ROUTINE = /^Lime dosed/

/** Logbook lines written inside the window: the factory's own words about that stretch. */
export function linesInWindow(doc: Doc, start?: Date, end?: Date): Line[] {
  if (!doc.lines || !start || !end) return []
  const day = wall(doc.covers[0])
  return doc.lines.filter((l) => {
    const [h, m] = l.time.split(':').map(Number)
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
    return t >= new Date(start.getTime() - 20 * 60_000) && t <= new Date(end.getTime() + 20 * 60_000) && !ROUTINE.test(l.text)
  })
}

type Props = { docs: Doc[]; selected: string; onSelect: (id: string) => void; lit: Line[] }

export function Documents({ docs, selected, onSelect, lit }: Props) {
  const doc = docs.find((d) => d.id === selected) ?? docs[0]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Documents">
        {docs.map((d) => (
          <button key={d.id} role="tab" aria-selected={d.id === doc.id} onClick={() => onSelect(d.id)}
            className={`rounded-full border px-3 py-1 text-xs ${d.id === doc.id ? 'border-ink bg-ink text-white' : 'border-rule bg-white'}`}>
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${d.is_claim ? 'bg-acid ring-1 ring-ink/30' : 'bg-indigo'}`} />
            {TYPE_LABEL[d.type] ?? d.type}
          </button>
        ))}
      </div>
      <p className="micro text-mute">
        {doc.is_claim ? 'Factory claim · checked against the records' : 'Physical record'} · {doc.author}
      </p>
      {doc.image ? (
        <div className="relative overflow-hidden rounded-lg border border-rule bg-white">
          <img src={doc.image} alt={`${TYPE_LABEL[doc.type] ?? doc.type}, ${doc.author}`} className="block w-full" />
          {lit.map((l) => (
            <div key={l.index} id={`line-${l.index}`} className="absolute rounded-sm border-2 border-indigo bg-acid/35"
              style={{ left: `${l.box.x_min / 10}%`, top: `${l.box.y_min / 10}%`,
                width: `${(l.box.x_max - l.box.x_min) / 10}%`, height: `${(l.box.y_max - l.box.y_min) / 10}%` }}
              title={`${l.time} ${l.text}`} />
          ))}
        </div>
      ) : (
        <blockquote id="doc-text" className="rounded-lg border border-rule bg-white p-5 font-serif text-lg italic">
          “{String((doc.content as { text?: string })?.text ?? '')}”
          <footer className="micro mt-3 not-italic text-mute">{doc.author} · received {hm(wall(doc.received_at))}</footer>
        </blockquote>
      )}
    </div>
  )
}
