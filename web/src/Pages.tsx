// The batch passport (phone-first, opened from the QR code) and the results page.
import { useEffect, useRef, useState } from 'react'
import { api, STATUS_LABEL, type CaseKey, type Doc, type Passport as P, type SignedRecord, type Verification } from './api'
import { Stamp } from './CaseFile'
import { dayHm, docLabel, wall } from './evidence'

export function Passport({ caseKey }: { caseKey: CaseKey }) {
  const [p, setP] = useState<P | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [open, setOpen] = useState<Doc | null>(null)
  useEffect(() => {
    api.passport(caseKey).then(setP)
    api.case(caseKey).then((c) => setDocs(c.documents))
  }, [caseKey])
  if (!p) return <p className="loading">Opening the passport…</p>
  // the key records: documents the investigator's own key evidence rests on, then the factory's logbook
  const records: { doc: Doc; why: string }[] = []
  for (const k of p.key_evidence) {
    const sig = k.id.match(/reading_vs_feed:(\w+)@/)?.[1]
    const doc = docs.find((d) => d.id === k.id || (sig && d.id.startsWith(`doc:photo-${sig}-`)))
    if (doc?.image && !records.some((r) => r.doc.id === doc.id)) records.push({ doc, why: k.why })
  }
  const log = docs.find((d) => d.type === 'logbook')
  if (log?.image && !records.some((r) => r.doc.id === log.id)) records.push({ doc: log, why: 'What the factory wrote, tested against the records.' })
  const factory = `Factory ${p.batch.id.split('-')[1]?.toUpperCase() ?? ''}`
  return (
    <section className="passport-view">
      <div className="passport-sheet">
        <a className="passport-back" href={`#/case/${caseKey}`}>← Open case file</a>
        <div className="passport-label">
          <span className="micro">TELLWATER / BATCH PASSPORT</span>
          <h1>A label with<br /><em>a little more.</em></h1>
          <div className="passport-batch">{p.product.name} · Batch {p.batch.id.split('-').at(-1)}</div>
          <p>{factory} (demo) · produced {dayHm(wall(p.batch.production_start))}</p>
          <p>GTIN {p.product.gtin} · Lot {p.product.lot}</p>
        </div>
        {p.status && <Stamp status={p.status} />}
        {p.review?.action === 'change' && p.assessed_status && <p className="passport-scope">Changed by the reviewer. The investigator assessed: {STATUS_LABEL[p.assessed_status]}.</p>}
        <p className="passport-scope">{p.scope_line}</p>
        <p className="passport-summary">{p.summary}</p>

        <h2>Key records</h2>
        <div className="passport-records">
          {records.slice(0, 4).map(({ doc, why }) => (
            <button key={doc.id} onClick={() => setOpen(doc)}>
              <img src={doc.image!} alt="" />
              <span>{docLabel(doc.id)}<small>{doc.is_claim ? 'Factory claim' : 'Physical record'} ↗ · {why}</small></span>
            </button>
          ))}
        </div>

        <h2>Reviewer decision</h2>
        <div className="passport-decision">
          {p.review ? <><b>{p.review.action === 'change' && p.review.status ? `Changed to ${STATUS_LABEL[p.review.status]}` : p.review.action === 'approve' ? 'Approved' : 'Sent back'} · {dayHm(wall(p.review.at))}</b><p>“{p.review.reason}”</p></>
            : <p>Awaiting a written reviewer decision. Until then this is the investigator’s assessment, unsigned.</p>}
        </div>
        {p.record && p.verification && <RecordCheck caseKey={caseKey} rec={p.record} v={p.verification} />}

        <h2>Limitations</h2>
        {p.limitations.slice(0, 3).map((l) => <p key={l} className="passport-limit">{l}</p>)}
        <p className="passport-local">{p.disclosure}</p>
        <div className="passport-foot">Prototype · records from the Tellwater simulator</div>
      </div>
      {open && <DocDialog doc={open} close={() => setOpen(null)} />}
    </section>
  )
}

function DocDialog({ doc, close }: { doc: Doc; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="document-dialog" onClose={close} onClick={(e) => { if (e.target === ref.current) close() }}>
      <button className="close" onClick={close} aria-label="Close">×</button>
      <span className="micro">{doc.is_claim ? 'FACTORY CLAIM' : 'PHYSICAL RECORD'}</span>
      <h2>{docLabel(doc.id)}</h2>
      <img className="full-document" src={doc.image!} alt={docLabel(doc.id)} />
    </dialog>
  )
}

const itemName = (id: string) => id.startsWith('submission:') ? `the factory’s ${id.split(':')[1]} log` : id.split('/').at(-1)!.replace(/^file:/, '')

/** The signed record behind the passport, checked again every time the page opens. */
function RecordCheck({ caseKey, rec, v }: { caseKey: CaseKey; rec: SignedRecord; v: Verification }) {
  const drift = [...v.changed, ...v.added, ...v.missing].map(itemName)
  const ran = rec.investigation.finished_at ? ` · ${dayHm(new Date(rec.investigation.finished_at))}` : ''
  return (
    <section className="passport-record" aria-label="Signed record">
      <span className="micro">SIGNED RECORD · ISSUED {dayHm(new Date(rec.issued_at)).toUpperCase()}</span>
      <p data-ok={v.signature_valid}>{v.signature_valid ? 'Signature checks out: issued here, not altered since.' : 'Signature does not match: this record was altered or not issued here.'}</p>
      <p data-ok={v.evidence_matches}>{v.evidence_matches ? `Evidence unchanged since the review (${v.items} records).` : `Evidence has changed since the review: ${drift.join(', ')}.`}</p>
      <p data-ok={v.investigation_matches}>{v.investigation_matches ? 'Investigation unchanged' : 'A newer investigation exists'} · {rec.investigation.model}{ran}</p>
      <p className="fingerprint">Evidence fingerprint {rec.evidence.root.slice(0, 16)}… · key {rec.proof.key_id}</p>
      <a className="text-btn" href={`/api/passport/${caseKey}/record`} target="_blank" rel="noreferrer">The signed record, for any product passport to embed ↗</a>
    </section>
  )
}

type S = Record<string, unknown>
const CONDITIONS: [string, string, string][] = [
  ['C1', 'Rules on sensor data', 'What conventional monitoring catches'],
  ['C2', 'Rules + document reading', 'Does reading the paperwork explain the gain?'],
  ['C3', 'Muse Spark, everything at once', 'The model without choosing its evidence'],
  ['C4', 'Muse Spark investigator', 'Choosing one check at a time'],
  ['C5', 'Muse Spark Open investigator', 'The same investigation on open weights'],
]
const n = (s: S | undefined, k: string) => (s?.[k] as number | null | undefined) ?? null

export function Results() {
  const [r, setR] = useState<Record<string, Record<string, S>> | null>(null)
  useEffect(() => { api.results().then(setR) }, [])
  if (!r) return <p className="loading">Loading the results…</p>
  const dev = r.dev ?? {}
  const rows: [string, (s: S | undefined) => string][] = [
    ['Agreement with the justified assessment', (s) => (s ? `${n(s, 'agreement')} / 60` : '–')],
    ['Unsupported accusations', (s) => String(n(s, 'unsupported_accusations') ?? '–')],
    ['Missed problems', (s) => String(n(s, 'missed_problems') ?? '–')],
    ['Evidence requests naming the right record', (s) => (s && n(s, 'requests_scored') ? `${n(s, 'request_hits')} of ${n(s, 'requests_scored')}` : '–')],
    ['Documents that tried to direct the audit, obeyed', (s) => (s && n(s, 'mean_seconds') ? `${n(s, 'injection_followed')} of ${n(s, 'injection_cases')}` : '–')],
    ['Seconds per case', (s) => (n(s, 'mean_seconds') ? String(Math.round(n(s, 'mean_seconds')!)) : '–')],
  ]
  const scale = ['scale_3', 'scale_14', 'scale_45'].map((k, i) => ({ days: [3, 14, 45][i], c3: n(r[k]?.C3, 'mean_cost'), c4: n(r[k]?.C4, 'mean_cost'), a3: n(r[k]?.C3, 'agreement'), a4: n(r[k]?.C4, 'agreement') }))
  const max = Math.max(...scale.map((s) => Math.max(s.c3 ?? 0, s.c4 ?? 0)), 0.01)
  return (
    <main className="results section-pad">
      <div className="section-heading">
        <div><span className="micro">THE EVALUATION</span><h2>How well does it<br /><span className="serif">actually work?</span></h2></div>
        <p>Synthetic results establish prototype performance, not field reliability.<br />Development set below. The held-out test set (120 cases, two factories,<br />frozen before any test run) is pending.</p>
      </div>
      <div className="workspace">
        <div className="workspace-top"><div className="batch"><span className="batch-icon">〰</span><div><b>Five ways to check the same 60 cases</b><small>DEVELOPMENT SET · FACTORY A</small></div></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th />{CONDITIONS.map(([id, name, q]) => <th key={id} data-hl={id === 'C4' || undefined}><span className="micro">{id}</span><b>{name}</b><small>{q}</small></th>)}</tr></thead>
            <tbody>
              {rows.map(([label, f]) => <tr key={label}><td>{label}</td>{CONDITIONS.map(([id]) => <td key={id} data-hl={id === 'C4' || undefined}>{f(dev[id])}</td>)}</tr>)}
              <tr><td>Held-out test set</td>{CONDITIONS.map(([id]) => <td key={id} className="pending" data-hl={id === 'C4' || undefined}>pending</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="explanation">
          <div className="explanation-copy"><span className="micro">WHAT IT SHOWS</span>
            <p>Reading the paperwork alone barely helps (C2). The gain comes from reasoning over the physical records, and no approach that reasons made an unsupported accusation.</p></div>
        </div>
      </div>

      <div className="scale">
        <div>
          <span className="micro">MORE DAYS OF RECORDS</span>
          <h3>Everything at once gets<br /><em>expensive fast.</em></h3>
          <p>The same 20 scenarios with 3, 14 and 45 days of data. Giving the model everything costs more with every day of records, and stops fitting in its context at about 70 days. The investigator reads what it needs.</p>
          <ul>{scale.map((s) => <li key={s.days}>{s.days} days · agreement C3 {s.a3}/20 · C4 {s.a4}/20</li>)}</ul>
        </div>
        <svg viewBox="0 0 420 230" role="img" aria-label="Estimated cost per case by days of records, C3 against C4">
          {scale.map((s, i) => {
            const x = 50 + i * 125, h3 = ((s.c3 ?? 0) / max) * 165, h4 = ((s.c4 ?? 0) / max) * 165
            return (
              <g key={s.days}>
                <rect x={x} y={185 - h3} width={40} height={h3} fill="#ff705b" stroke="#171735" />
                <rect x={x + 46} y={185 - h4} width={40} height={h4} fill="#4945ff" stroke="#171735" />
                <text x={x + 20} y={179 - h3} textAnchor="middle">${s.c3?.toFixed(2)}</text>
                <text x={x + 66} y={179 - h4} textAnchor="middle">${s.c4?.toFixed(2)}</text>
                <text x={x + 43} y={203} textAnchor="middle" className="axis">{s.days} DAYS</text>
              </g>
            )
          })}
          <rect x={50} y={215} width={10} height={8} fill="#ff705b" /><text x={64} y={223}>C3 everything at once</text>
          <rect x={200} y={215} width={10} height={8} fill="#4945ff" /><text x={214} y={223}>C4 investigator · est. cost per case</text>
        </svg>
      </div>

      <div className="finding dont-claim">
        <div><span className="micro">WHAT WE DON’T CLAIM</span><h3>Honest about the edges.</h3>
          <p>No compliance certification: an assessment is about one batch and the records it rests on. No inference of intent: missing evidence is not proof of wrongdoing. Synthetic data only. And one tuning case where our labelling rules and the investigator disagree: we kept our rules.</p></div>
      </div>
    </main>
  )
}
