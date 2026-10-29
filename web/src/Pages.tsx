// The batch passport (phone-first, opened from the QR code) and the results page.
import { useEffect, useRef, useState } from 'react'
import { api, STATUS_LABEL, type CaseKey, type Doc, type Passport as P, type SignedRecord, type Verification } from './api'
import { Stamp } from './CaseFile'
import { Garment } from './Garments'
import { dayHm, docLabel, wall } from './evidence'

type Translation = { lang: string; language: string; model: string; fields: Record<string, string>; note: string }

export function Passport({ caseKey, gtin }: { caseKey: CaseKey; gtin?: string }) {
  const [p, setP] = useState<P | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [open, setOpen] = useState<Doc | null>(null)
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [lang, setLang] = useState('en')
  const [tr, setTr] = useState<Translation | null>(null)
  const [trState, setTrState] = useState<'' | 'loading' | string>('')
  useEffect(() => {
    api.passport(caseKey, gtin).then(setP)
    api.case(caseKey).then((c) => setDocs(c.documents))
    api.languages().then(setLangs).catch(() => setLangs({}))
  }, [caseKey, gtin])
  useEffect(() => {
    if (lang === 'en') { setTr(null); setTrState(''); return }
    setTrState('loading')
    fetch(`/api/passport/${caseKey}/translate?lang=${lang}${gtin ? `&gtin=${gtin}` : ''}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.detail ?? r.status); setTr(d); setTrState('') })
      .catch((e) => { setTr(null); setTrState((e as Error).message); setLang('en') })
  }, [lang, caseKey, gtin])
  if (!p) return <p className="loading">Opening the passport…</p>
  // English unless a checked machine translation is showing
  const t = (key: string, en: string) => tr?.fields[key] ?? en
  const ui = (key: string, en: string) => t(`ui.${key}`, en)
  // the key records: documents the investigator's own key evidence rests on, then the factory's logbook
  const records: { doc: Doc; why: string }[] = []
  for (const k of p.key_evidence) {
    const sig = k.id.match(/reading_vs_feed:(\w+)@/)?.[1]
    const doc = docs.find((d) => d.id === k.id || (sig && d.id.startsWith(`doc:photo-${sig}-`)))
    if (doc?.image && !records.some((r) => r.doc.id === doc.id)) records.push({ doc, why: t(`why.${k.id}`, k.why) })
  }
  const log = docs.find((d) => d.type === 'logbook')
  if (log?.image && !records.some((r) => r.doc.id === log.id)) records.push({ doc: log, why: tr ? '' : 'What the factory wrote, tested against the records.' })
  const factory = `Factory ${p.batch.id.split('-')[1]?.toUpperCase() ?? ''}`
  const others = p.products.filter((x) => x.gtin !== p.product.gtin).map((x) => x.name.toLowerCase())
  return (
    <section className="passport-view">
      <div className="passport-sheet" lang={tr?.lang ?? 'en'}>
        <div className="passport-top">
          <a className="passport-back" href={`#/case/${caseKey}`}>← {ui('open_case', 'Open case file')}</a>
          {Object.keys(langs).length > 0 && (
            <label className="lang-pick">
              <span>Read in</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={trState === 'loading'} aria-label="Passport language">
                <option value="en">English</option>
                {Object.entries(langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          )}
        </div>
        {trState === 'loading' && <p className="translation-note">Muse Spark is translating the passport…</p>}
        {trState && trState !== 'loading' && <p className="translation-note warn">{trState}</p>}
        {tr && <p className="translation-note">{tr.note} <button className="text-btn" onClick={() => setLang('en')}>Show the English original</button></p>}
        <div className="passport-label">
          <span className="micro">TELLWATER / BATCH PASSPORT</span>
          <h1>{ui('title_1', 'A label with')}<br /><em>{ui('title_2', 'a little more.')}</em></h1>
          <div className="passport-product">
            <Garment kind={p.product.kind} shade={p.batch.shade} />
            <div>
              <span className="micro">{(p.scanned ? ui('you_scanned', 'You scanned') : ui('made_from_run', 'Made from this run')).toUpperCase()}</span>
              <div className="passport-batch">{t(`product.${p.product.name}`, p.product.name)}</div>
              <p>{t(`fabric.${p.product.fabric}`, p.product.fabric)} · {t(`shade.${p.batch.shade}`, p.batch.shade)} {ui('shade', 'shade')} · {factory} (demo)</p>
              <p>GTIN {p.product.gtin} · Lot {p.product.lot}</p>
            </div>
          </div>
        </div>
        <p className="passport-run">{tr ? ui('run', '') : <>This garment was cut from fabric dyed in one run, produced {dayHm(wall(p.batch.production_start))}–{dayHm(wall(p.batch.production_end)).split(' ').at(-1)}. Wastewater is made by dye runs, not by single garments, so this passport answers for the whole run{others.length ? `, and for the ${others.join(' and ')} made from it too` : ''}.</>}</p>
        {p.status && <Stamp status={p.status} label={tr?.fields.status} />}
        {p.review?.action === 'change' && p.assessed_status && <p className="passport-scope">Changed by the reviewer. The investigator assessed: {STATUS_LABEL[p.assessed_status]}.</p>}
        <p className="passport-scope">{t('scope', p.scope_line ?? '')}</p>
        <p className="passport-summary">{t('summary', p.summary ?? '')}</p>

        <h2>{ui('key_records', 'Key records')}</h2>
        <div className="passport-records">
          {records.slice(0, 4).map(({ doc, why }) => (
            <button key={doc.id} onClick={() => setOpen(doc)}>
              <img src={doc.image!} alt="" />
              <span>{tr ? `${ui(`doc_${doc.type}`, docLabel(doc.id))}${doc.type === 'meter_photo' ? ` ${docLabel(doc.id).split(' ').at(-1)}` : ''}` : docLabel(doc.id)}<small>{doc.is_claim ? ui('factory_claim', 'Factory claim') : ui('physical_record', 'Physical record')} ↗{why ? ` · ${why}` : ''}</small></span>
            </button>
          ))}
        </div>

        <h2>{ui('reviewer_decision', 'Reviewer decision')}</h2>
        <div className="passport-decision">
          {p.review ? <><b>{p.review.action === 'change' && p.review.status ? `${ui('changed_to', 'Changed to')} ${STATUS_LABEL[p.review.status]}` : p.review.action === 'approve' ? ui('approved', 'Approved') : ui('sent_back', 'Sent back')} · {dayHm(wall(p.review.at))}</b><p>“{t('review', p.review.reason)}”</p></>
            : <p>{ui('awaiting', 'Awaiting a written reviewer decision. Until then this is the investigator’s assessment, unsigned.')}</p>}
        </div>
        {p.record && p.verification && <RecordCheck caseKey={caseKey} rec={p.record} v={p.verification} ui={ui} />}

        <h2>{ui('limitations', 'Limitations')}</h2>
        {p.limitations.slice(0, 3).map((l, i) => <p key={l} className="passport-limit">{t(`limitation.${i}`, l)}</p>)}
        <p className="passport-local">{ui('disclosure', p.disclosure)}</p>
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
function RecordCheck({ caseKey, rec, v, ui }: { caseKey: CaseKey; rec: SignedRecord; v: Verification; ui: (key: string, en: string) => string }) {
  const drift = [...v.changed, ...v.added, ...v.missing].map(itemName)
  const ran = rec.investigation.finished_at ? ` · ${dayHm(new Date(rec.investigation.finished_at))}` : ''
  return (
    <section className="passport-record" aria-label="Signed record">
      <span className="micro">{ui('signed_record', 'Signed record').toUpperCase()} · {dayHm(new Date(rec.issued_at)).toUpperCase()}</span>
      <p data-ok={v.signature_valid}>{v.signature_valid ? ui('sig_ok', 'Signature checks out: issued here, not altered since.') : 'Signature does not match: this record was altered or not issued here.'}</p>
      <p data-ok={v.evidence_matches}>{v.evidence_matches ? `${ui('evidence_ok', 'Evidence unchanged since the review.')} (${v.items})` : `Evidence has changed since the review: ${drift.join(', ')}.`}</p>
      <p data-ok={v.investigation_matches}>{v.investigation_matches ? ui('investigation_ok', 'Investigation unchanged') : 'A newer investigation exists'} · {rec.investigation.model}{ran}</p>
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
        <div><span className="micro">THE EVALUATION</span><h1 className="results-title">How well does it<br /><span className="serif">actually work?</span></h1></div>
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

      <div className="fresh">
        <span className="micro">FRESH CASES · NEVER TRAINED OR TUNED ON, AND NOT THE TEST SET</span>
        <div className="fresh-cards">
          <div className="fresh-card">
            <span className="micro">C6 · MUSE GLIMMER, DISTILLED</span>
            <b>{n(r.check?.C6, 'agreement') ?? '–'} of {n(r.check?.C6, 'cases') ?? '–'}</b>
            <p>A small model fine-tuned on 127 correct Muse Spark investigations, then run on fresh cases: right answer on every one, {n(r.check?.C6, 'unsupported_accusations') ?? 0} unsupported accusations, every citation valid. About {Math.round(n(r.check?.C6, 'mean_seconds') ?? 0)} s a case.</p>
          </div>
          <div className="fresh-card">
            <span className="micro">C4 · A SECOND FACTORY (FACTORY B)</span>
            <b>{n(r.check_b?.C4, 'agreement') ?? '–'} of {n(r.check_b?.C4, 'cases') ?? '–'}</b>
            <p>A differently built plant nothing was tuned on. The first run got 9 of 10: the miss exposed a rule that was too strict for every factory (a stop with a rising tank and a dry outfall did hold its water). After narrowing it, 10 of 10, and the 15 development cases with a stop answered exactly as before.</p>
          </div>
        </div>
      </div>

      {r.localize && (
        <div className="linefind">
          <div>
            <span className="micro">READING THE LOGBOOK · WHERE IS EACH LINE?</span>
            <h3>Square the photo,<br /><em>find the line.</em></h3>
            <p>The case file highlights the logbook line a check is about, so the model has to say where each line is. We measured it on 60 photographed pages ({n(r.localize['spark/dev'], 'lines')} lines) against the renderer’s true positions. Muse Spark places its boxes on a square grid: sent as is, a portrait photo’s boxes land on the wrong line; padded to a square, nearly every line is right.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th><b>Muse Spark</b><small>photo as is</small></th><th data-hl><b>Muse Spark</b><small>padded to a square</small></th><th><b>Muse Spark Open</b><small>padded to a square</small></th></tr></thead>
              <tbody>
                {([['Boxes on the right line', 'right_line'], ['Box overlap of at least half', 'iou_at_0.5'], ['Line text read exactly', 'text_exact']] as const).map(([label, k]) => (
                  <tr key={k}><td>{label}</td>{(['spark/dev', 'spark/dev-square', 'open/dev-square'] as const).map((m) => (
                    <td key={m} data-hl={m === 'spark/dev-square' || undefined}>{n(r.localize[m], k) === null ? '–' : `${(n(r.localize[m], k)! * 100).toFixed(1).replace(/\.0$/, '')}%`}</td>))}</tr>
                ))}
                <tr><td>Seconds per page</td>{(['spark/dev', 'spark/dev-square', 'open/dev-square'] as const).map((m) => <td key={m} data-hl={m === 'spark/dev-square' || undefined}>{n(r.localize[m], 'seconds_per_page')}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="stamp-reference">
        <span className="micro">FOUR POSSIBLE ANSWERS</span>
        <div>{(['supports', 'contradicts', 'review_required', 'insufficient'] as const).map((st) => <Stamp key={st} status={st} />)}</div>
      </div>

      <div className="finding dont-claim">
        <div><span className="micro">WHAT WE DON’T CLAIM</span><h3>Honest about the edges.</h3>
          <p>No compliance certification: an assessment is about one batch and the records it rests on. No inference of intent: missing evidence is not proof of wrongdoing. Synthetic data only. And one tuning case where our labelling rules and the investigator disagree: we kept our rules.</p></div>
      </div>
    </main>
  )
}
