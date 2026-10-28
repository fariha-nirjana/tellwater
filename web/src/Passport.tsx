import { useEffect, useState } from 'react'
import { api, STATUS_LABEL, type CaseKey, type Passport as P } from './api'
import { dayHm, wall } from './evidence'
import { Stamp } from './ui'

/** The brief batch-level summary a QR code opens. Not a certificate. */
export function Passport({ caseKey, go }: { caseKey: CaseKey; go: (h: string) => void }) {
  const [p, setP] = useState<P | null>(null)
  useEffect(() => { api.passport(caseKey).then(setP) }, [caseKey])
  if (!p) return <p className="p-8 text-mute">Opening the passport…</p>
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <p className="micro text-mute">Batch passport · prototype</p>
      <h1 className="mt-1 text-3xl font-extrabold">Batch {p.batch.id.split('-').at(-1)}</h1>
      <p className="text-sm text-mute">{p.batch.shade} shade · produced {dayHm(wall(p.batch.production_start))}</p>
      <div className="mt-4"><Stamp status={p.status} /></div>
      {p.review?.action === 'change' && p.assessed_status && (
        <p className="mt-2 text-xs text-mute">Changed by the reviewer. The investigator assessed: {STATUS_LABEL[p.assessed_status]}.</p>
      )}
      <p className="mt-4 leading-relaxed">{p.summary}</p>
      {p.scope_line && <p className="mt-2 text-xs text-mute">{p.scope_line}</p>}
      {p.review && (
        <div className="mt-5 rounded-xl bg-ink p-4 text-white">
          <p className="micro text-acid">Reviewer</p>
          <p className="mt-1 text-sm">“{p.review.reason}”</p>
          <p className="micro mt-1 text-white/50">{dayHm(wall(p.review.at))}</p>
        </div>
      )}
      {p.limitations.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-semibold">What this cannot show</summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink/80">{p.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      )}
      <p className="mt-8 border-t border-rule pt-3 text-xs text-mute">{p.disclosure}</p>
      <button onClick={() => go(`#/case/${caseKey}`)} className="mt-3 text-sm text-indigo">See the full case file ↗</button>
    </main>
  )
}
