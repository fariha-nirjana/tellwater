// The batch passport a garment's QR code opens, for three readers: the shopper holding the garment
// (plain words, where its water went), the buyer (structured fields), and the auditor (the signed
// record, every fingerprint, the investigation). One column on phones, two on wider screens.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, STATUS_LABEL, type CaseKey, type Doc, type Passport as P, type SignedRecord, type Status, type Verification } from './api'
import { Stamp } from './CaseFile'
import { dayHm, docLabel, parseEvidence, wall } from './evidence'
import { Garment, SHADE } from './Garments'

type Translation = { lang: string; language: string; model: string; fields: Record<string, string>; note: string }
type View = 'you' | 'buyer' | 'auditor'
type Stage = 'intake' | 'tank' | 'treatment' | 'river'
type State = 'ok' | 'problem' | 'affected' | 'missing' | 'neutral'

// what a shopper reads, by answer: what the records show, then one honest, warm line
const HEADLINE: Record<Status, string> = {
  supports: 'The water from making this was treated before it left the factory.',
  contradicts: 'The records don’t show this batch’s water was properly treated.',
  review_required: 'A person is checking something in this batch’s records.',
  insufficient: 'One record is missing, so we can’t tell yet.',
}
const WARM: Record<Status, string> = {
  supports: 'Every drop has a story. This one has a good ending.',
  contradicts: 'Not every story ends well, and you deserve to know which ones don’t.',
  review_required: 'Better a careful answer than a fast one.',
  insufficient: 'A gap, not a verdict. The factory has been asked for the missing record.',
}
const STAGE_NAME: Record<Stage | 'dyeing', string> = {
  intake: 'Water drawn in', dyeing: 'Your fabric dyed', tank: 'Held in the tank', treatment: 'Cleaned at the treatment plant', river: 'Back to the river',
}
const STATE_TEXT: Record<Stage, Partial<Record<State, string>>> = {
  intake: { ok: 'Metered as it came in', missing: 'The intake record is missing', neutral: 'Not needed for this answer' },
  tank: { ok: 'The tank held the water', problem: 'The tank overflowed', missing: 'The tank record is missing', neutral: 'Not needed for this answer' },
  treatment: { ok: 'Treatment ran as needed', problem: 'Cleaning fell short', affected: 'Not checked after the problem', missing: 'A treatment record is missing', neutral: 'Not needed for this answer' },
  river: { ok: 'Left the factory treated', problem: 'Some water went around treatment', affected: 'Reached the river without full treatment', missing: 'An outfall record is missing', neutral: 'Not needed for this answer' },
}
const ORDER: Stage[] = ['intake', 'tank', 'treatment', 'river']

/** Which stage of the water's journey a record speaks about. */
function stageOf(id: string): Stage | null {
  if (/power_vs_load|reading_vs_feed|compare:|doc:lab|doc:photo/.test(id)) return 'treatment'
  if (/water_balance/.test(id)) return 'tank'
  const s = parseEvidence(id).signals[0]
  return s === 'S1' ? 'intake' : s === 'T1' ? 'tank' : s === 'S2' || s === 'S3' ? 'treatment' : s?.startsWith('S4') ? 'river' : null
}

/** The journey's marks, from the investigation's own key evidence and evidence request. */
function journey(p: P): Record<Stage, State> {
  const touched = new Set(p.key_evidence.map((k) => stageOf(k.id)).filter(Boolean) as Stage[])
  const problem = p.status === 'contradicts' || p.status === 'review_required' ? p.key_evidence.map((k) => stageOf(k.id)).find(Boolean) ?? null : null
  const asked = (p.evidence_request?.items ?? []).join(' ')
  const missing: Stage | null = p.status !== 'insufficient' ? null
    : /T1|tank/i.test(asked) ? 'tank' : /S1|intake/i.test(asked) ? 'intake' : /S2|S3|power|inflow/i.test(asked) ? 'treatment' : /S4|outfall/i.test(asked) ? 'river' : 'tank'
  const out = {} as Record<Stage, State>
  for (const s of ORDER) {
    out[s] = s === problem ? 'problem'
      : problem && ORDER.indexOf(s) > ORDER.indexOf(problem) ? 'affected'
      : s === missing ? 'missing'
      : touched.has(s) ? 'ok' : 'neutral'
  }
  return out
}

// which tabs each audience sees: the public layer for anyone who scans, the business layers for buyers and auditors (as in the
// EU product passport); the factory never sees the auditor tab, which carries the buyer's review notes
export type PassportRole = 'all' | 'buyer' | 'factory' | 'shopper'
const TABS: Record<PassportRole, View[]> = { all: ['you', 'buyer', 'auditor'], shopper: ['you'], buyer: ['buyer', 'auditor'], factory: ['you', 'buyer'] }

export function Passport({ caseKey, gtin, role = 'all' }: { caseKey: CaseKey; gtin?: string; role?: PassportRole }) {
  const tabs = TABS[role]
  const [p, setP] = useState<P | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [open, setOpen] = useState<Doc | null>(null)
  const [view, setView] = useState<View>(() => TABS[role][0])
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [lang, setLang] = useState('en')
  const [tr, setTr] = useState<Translation | null>(null)
  const [trState, setTrState] = useState('')
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
  const status = (p.status ?? 'insufficient') as Status
  const shade = SHADE[p.batch.shade]?.name ?? p.batch.shade
  const factory = t('factory', p.garment.factory)
  const records: { doc: Doc; why: string }[] = []
  for (const k of p.key_evidence) {
    const sig = k.id.match(/reading_vs_feed:(\w+)@/)?.[1]
    const doc = docs.find((d) => d.id === k.id || (sig && d.id.startsWith(`doc:photo-${sig}-`)))
    if (doc?.image && !records.some((r) => r.doc.id === doc.id)) records.push({ doc, why: t(`why.${k.id}`, k.why) })
  }
  const log = docs.find((d) => d.type === 'logbook')
  if (log?.image && !records.some((r) => r.doc.id === log.id)) records.push({ doc: log, why: ui('log_why', 'What the factory wrote, tested against the records.') })
  const docName = (d: Doc) => (tr ? `${ui(`doc_${d.type}`, docLabel(d.id))}${d.type === 'meter_photo' ? ` ${docLabel(d.id).split(' ').at(-1)}` : ''}` : docLabel(d.id))
  const decision = p.review ? (p.review.action === 'change' && p.review.status ? `${ui('changed_to', 'Changed to')} ${t('status', STATUS_LABEL[p.review.status])}` : p.review.action === 'approve' ? ui('approved', 'Approved') : ui('sent_back', 'Sent back')) : null
  const marks = journey(p)

  return (
    <section className="pp-view">
      <div className="pp-shell" lang={tr?.lang ?? 'en'}>
        <aside className="pp-side">
          <div className="pp-top">
            {(role === 'all' || role === 'buyer') && <a className="passport-back" href={`#/case/${caseKey}`}>← {ui('open_case', 'Open case file')}</a>}
            {Object.keys(langs).length > 0 && (
              <label className="lang-pick"><span>Read in</span>
                <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={trState === 'loading'} aria-label="Passport language">
                  <option value="en">English</option>
                  {Object.entries(langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="pp-label">
            <span className="micro">TELLWATER / BATCH PASSPORT</span>
            <h1>{ui('title_1', 'A label with')} <em>{ui('title_2', 'a little more.')}</em></h1>
            <Garment kind={p.product.kind} shade={p.batch.shade} className="pp-garment" />
            <span className="micro">{(p.scanned ? ui('you_scanned', 'You scanned') : ui('made_from_run', 'Made from this run')).toUpperCase()}</span>
            <b className="pp-name">{t(`product.${p.product.name}`, p.product.name)}</b>
            <p>{t('composition', p.garment.composition)} · {t(`shade.${p.batch.shade}`, shade)} {ui('shade', 'shade')}</p>
            <p className="pp-ids">GTIN {p.product.gtin} · Lot {p.product.lot}</p>
          </div>
        </aside>

        <div className="pp-main">
          {tabs.length > 1 && (
            <div className="pp-tabs" role="tablist" aria-label="Who is reading">
              {([['you', ui('tab_you', 'For shoppers')], ['buyer', ui('tab_buyer', 'For buyers')], ['auditor', ui('tab_auditor', 'For auditors')]] as [View, string][]).filter(([v]) => tabs.includes(v)).map(([v, label]) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>{label}</button>
              ))}
            </div>
          )}
          {trState === 'loading' && <p className="translation-note">Muse Spark is translating the passport…</p>}
          {trState && trState !== 'loading' && <p className="translation-note warn">{trState}</p>}
          {tr && <p className="translation-note">{tr.note} <button className="text-btn" onClick={() => setLang('en')}>Show the English original</button></p>}

          {view === 'you' && (
            <div className="pp-you">
              <div className={`pp-answer pp-answer-${status}`}>
                <Stamp status={status} label={t('status', STATUS_LABEL[status])} />
                <h2>{t(`headline.${status}`, HEADLINE[status])}</h2>
                <p className="pp-warm">{t(`warm.${status}`, WARM[status])}</p>
              </div>

              <h3>{ui('journey_title', 'Where the water went')}</h3>
              <ol className="pp-journey">
                {ORDER.map((s) => [
                  <li key={s} className={`j-${marks[s]}`}>
                    <i aria-hidden="true">{marks[s] === 'ok' ? '✓' : marks[s] === 'problem' ? '!' : marks[s] === 'missing' ? '?' : marks[s] === 'affected' ? '↓' : '·'}</i>
                    <b>{ui(`stage_${s}`, STAGE_NAME[s])}</b>
                    <span>{ui(`state_${s}_${marks[s] === 'ok' && s === 'river' && status !== 'supports' ? 'seen' : marks[s]}`,
                      marks[s] === 'ok' && s === 'river' && status !== 'supports' ? 'Nothing untreated seen at the outfall' : STATE_TEXT[s][marks[s]] ?? '')}
                      {s === 'river' && p.garment.reuse_share ? ` · ${ui('reused_prefix', 'about')} ${Math.round(p.garment.reuse_share * 100)}% ${ui('reused_suffix', 'reused in the factory')}` : ''}</span>
                  </li>,
                  s === 'intake' && (
                <li key="dyeing" className="j-info"><i aria-hidden="true">〰</i><b>{ui('stage_intake_dyeing', STAGE_NAME.dyeing)}</b>
                  <span>{dayHm(wall(p.batch.production_start))} · {Math.round(p.batch.planned_wastewater_m3)} m³ {ui('of_water', 'of water used by this run')}</span></li>
                  ),
                ])}
              </ol>
              <p className="pp-fine">{ui('journey_note', 'Marked from the investigation of this garment’s dye run. Garments don’t make wastewater; dye runs do, so this answer covers every garment cut from the run.')}</p>

              <h3>{ui('about_title', 'About this garment')}</h3>
              <dl className="pp-facts">
                <div><dt>{ui('made_of', 'Made of')}</dt><dd>{t('composition', p.garment.composition)}</dd></div>
                <div><dt>{ui('made_in', 'Made in')}</dt><dd>{t('origin', p.garment.origin)} · {factory}</dd></div>
                <div><dt>{ui('colour', 'Colour')}</dt><dd><i className="shade-swatch small" style={{ background: SHADE[p.batch.shade]?.fill }} />{t(`shade.${p.batch.shade}`, shade)} {ui('shade', 'shade')}</dd></div>
              </dl>
              <div className="pp-care" aria-label="Care instructions">
                {p.garment.care.map((c, i) => <span key={c}><CareIcon i={i} />{t(`care.${i}`, c)}</span>)}
              </div>
              {tabs.length > 1 && (
                <div className="pp-more">
                  {tabs.includes('buyer') && <button className="text-btn" onClick={() => setView('buyer')}>{ui('see_buyer', 'The details a buyer checks')} ↗</button>}
                  {tabs.includes('auditor') && <button className="text-btn" onClick={() => setView('auditor')}>{ui('see_auditor', 'Everything, for auditors')} ↗</button>}
                </div>
              )}
            </div>
          )}

          {view === 'buyer' && (
            <div className="pp-rows">
              <Section title={ui('sec_general', 'General information')}>
                <Row k={ui('row_product', 'Product')} v={t(`product.${p.product.name}`, p.product.name)} />
                <Row k="GTIN" v={p.product.gtin} mono />
                <Row k={ui('row_lot', 'Lot (dye run)')} v={p.product.lot} mono />
                <Row k={ui('made_of', 'Made of')} v={t('composition', p.garment.composition)} />
                <Row k={ui('made_in', 'Made in')} v={`${t('origin', p.garment.origin)} · ${factory}`} />
              </Section>
              <Section title={ui('sec_water', 'Wastewater treatment')}>
                <Row k={ui('row_answer', 'Answer')} v={<Stamp status={status} label={t('status', STATUS_LABEL[status])} />} />
                <Row k={ui('row_window_start', 'Treatment window start')} v={dayHm(wall(p.treatment_interval[0]))} />
                <Row k={ui('row_window_end', 'Treatment window end')} v={dayHm(wall(p.treatment_interval[1]))} />
                <Row k={ui('row_scope', 'Scope')} v={t('scope', p.scope_line ?? '')} />
                <Row k={ui('reviewer_decision', 'Reviewer decision')} v={decision ? `${decision} · ${dayHm(wall(p.review!.at))}` : ui('not_reviewed', 'Not yet reviewed')} />
                <Row k={ui('row_signed', 'Signed record')} v={p.record ? `${ui('yes_signed', 'Yes')} · ${dayHm(new Date(p.record.issued_at))}` : ui('not_signed', 'Not yet: signed when a reviewer decides')} />
                {p.evidence_request && <Row k={ui('row_requested', 'Requested from the factory')} v={(p.evidence_request.items ?? []).join(', ')} />}
              </Section>
              {p.lab.length > 0 && (
                <Section title={ui('sec_lab', 'Lab validation')}>
                  {p.lab.map((l) => <Row key={String(l.evidence_id)} k={`${l.sample_point} · ${l.sample_time}`}
                    v={`BOD ${l.bod_mg_l} mg/L (${ui('limit', 'limit')} ${l.bod_limit_mg_l}) · pH ${l.ph} · ${Number(l.bod_mg_l) > Number(l.bod_limit_mg_l) ? ui('lab_over', 'Above the limit') : ui('lab_within', 'Within the limit')}`} />)}
                </Section>
              )}
              <Section title={ui('key_records', 'Key records')}>
                <div className="passport-records">
                  {records.slice(0, 4).map(({ doc, why }) => (
                    <button key={doc.id} onClick={() => setOpen(doc)}>
                      <img src={doc.image!} alt="" />
                      <span>{docName(doc)}<small>{doc.is_claim ? ui('factory_claim', 'Factory claim') : ui('physical_record', 'Physical record')} ↗{why ? ` · ${why}` : ''}</small></span>
                    </button>
                  ))}
                </div>
              </Section>
              <p className="pp-fine">{t('limitation.0', p.limitations[0] ?? '')} {tabs.includes('auditor') && <button className="text-btn" onClick={() => setView('auditor')}>{ui('all_limits', 'All limitations')} ↗</button>}</p>
              <a className="button acid small" href={`/api/passport/${caseKey}/record`} target="_blank" rel="noreferrer">{ui('download_record', 'The signed record (JSON)')} <span>↗</span></a>
            </div>
          )}

          {view === 'auditor' && (
            <div className="pp-rows">
              <Section title={ui('sec_finding', 'The finding')}>
                <p className="pp-para">{t('summary', p.summary ?? '')}</p>
                {p.review?.action === 'change' && p.assessed_status && <p className="pp-fine">Changed by the reviewer. The investigator assessed: {STATUS_LABEL[p.assessed_status]}.</p>}
              </Section>
              <Section title={ui('signed_record', 'Signed record')}>
                {p.record && p.verification ? <RecordCheck caseKey={caseKey} rec={p.record} v={p.verification} ui={ui} />
                  : <p className="pp-fine">{ui('not_signed', 'Not yet: signed when a reviewer decides')}</p>}
              </Section>
              <Section title={ui('sec_investigation', 'The investigation')}>
                <Row k={ui('row_model', 'Model')} v={p.investigation.model ?? '–'} mono />
                <Row k={ui('row_checks', 'Checks run')} v={String(p.investigation.checks ?? '–')} />
                <Row k={ui('row_time', 'Time taken')} v={`${Math.round(p.investigation.seconds ?? 0)} s`} />
                <Row k={ui('row_citations', 'Every citation checked against the evidence')} v={p.investigation.citations_validated ? ui('yes', 'Yes') : ui('no', 'No')} />
                <Row k={ui('row_window', 'Treatment window')} v={`${dayHm(wall(p.treatment_interval[0]))} – ${dayHm(wall(p.treatment_interval[1]))}`} />
                {p.evidence_request && <Row k={ui('row_requested', 'Requested from the factory')} v={`${(p.evidence_request.items ?? []).join(', ')}${p.evidence_request.reason ? ` · ${p.evidence_request.reason}` : ''}`} />}
              </Section>
              <Section title={ui('sec_reviews', 'Reviewer history')}>
                {p.reviews.length ? p.reviews.slice().reverse().map((r, i) => (
                  <Row key={i} k={`${dayHm(wall(r.at))} · ${r.reviewer}`} v={`${r.action === 'change' && r.status ? `Changed to ${STATUS_LABEL[r.status]}` : r.action === 'approve' ? 'Approved' : 'Sent back'} · “${r.reason}”`} />
                )) : <p className="pp-fine">{ui('not_reviewed', 'Not yet reviewed')}</p>}
              </Section>
              <Section title={ui('limitations', 'Limitations')}>
                {p.limitations.map((l, i) => <p key={l} className="pp-para small">{i < 3 ? t(`limitation.${i}`, l) : l}</p>)}
                <p className="pp-fine">{ui('disclosure', p.disclosure)}</p>
              </Section>
              <div className="pp-links">
                <a className="button ink small" href={`#/case/${caseKey}`}>{ui('open_case', 'Open case file')} <span>↗</span></a>
                <a className="text-btn" href={`/api/passport/${caseKey}/record`} target="_blank" rel="noreferrer">{ui('download_record', 'The signed record (JSON)')} ↗</a>
                <a className="text-btn" href="/api/passport-key" target="_blank" rel="noreferrer">{ui('public_key', 'The public key that checks it')} ↗</a>
                <a className="text-btn" href={`#/report/${caseKey}`}>Audit report (print or PDF) ↗</a>
              </div>
            </div>
          )}
          <div className="passport-foot">Prototype · records from the Tellwater simulator</div>
        </div>
      </div>
      {open && <DocDialog doc={open} name={docName(open)} close={() => setOpen(null)} />}
    </section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pp-section"><h3>{title}</h3>{children}</section>
}

function Row({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return <div className="pp-row"><span>{k}</span><span className={mono ? 'mono' : undefined}>{v}</span></div>
}

/** Care-label symbols, drawn simply: wash at 30, no bleach, tumble dry low, iron medium, no dry clean. */
function CareIcon({ i }: { i: number }) {
  const g = [
    <><path d="M3 8l2 11h14l2-11" /><path d="M3 8q3 3 6 0t6 0t6 0" /><text x="12" y="17" fontSize="6" textAnchor="middle" stroke="none" fill="currentColor">30</text></>,
    <><path d="M12 4L22 20H2Z" /><path d="M4 4L20 20M20 4L4 20" /></>,
    <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
    <><path d="M4 17h17v-3q0-6-7-6H8M4 17l2-6h8" /><circle cx="10" cy="14" r=".9" fill="currentColor" /><circle cx="14" cy="14" r=".9" fill="currentColor" /></>,
    <><circle cx="12" cy="12" r="8" /><path d="M5 5l14 14M19 5L5 19" /></>,
  ][i]
  return <svg viewBox="0 0 24 24" className="care-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">{g}</svg>
}

function DocDialog({ doc, name, close }: { doc: Doc; name: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="document-dialog" onClose={close} onClick={(e) => { if (e.target === ref.current) close() }}>
      <button className="close" onClick={close} aria-label="Close">×</button>
      <span className="micro">{doc.is_claim ? 'FACTORY CLAIM' : 'PHYSICAL RECORD'}</span>
      <h2>{name}</h2>
      <img className="full-document" src={doc.image!} alt={name} />
    </dialog>
  )
}

const itemName = (id: string) => id.startsWith('submission:') ? `the factory’s ${id.split(':')[1]} log` : id.split('/').at(-1)!.replace(/^file:/, '')

/** The signed record behind the passport, checked again every time the page opens. */
function RecordCheck({ caseKey, rec, v, ui }: { caseKey: CaseKey; rec: SignedRecord; v: Verification; ui: (key: string, en: string) => string }) {
  const drift = [...v.changed, ...v.added, ...v.missing].map(itemName)
  const ran = rec.investigation.finished_at ? ` · ${dayHm(new Date(rec.investigation.finished_at))}` : ''
  return (
    <div className="passport-record" aria-label="Signed record">
      <span className="micro">{ui('signed_record', 'Signed record').toUpperCase()} · {dayHm(new Date(rec.issued_at)).toUpperCase()}</span>
      <p data-ok={v.signature_valid}>{v.signature_valid ? ui('sig_ok', 'Signature checks out: issued here, not altered since.') : 'Signature does not match: this record was altered or not issued here.'}</p>
      <p data-ok={v.evidence_matches}>{v.evidence_matches ? `${ui('evidence_ok', 'Evidence unchanged since the review.')} (${v.items})` : `Evidence has changed since the review: ${drift.join(', ')}.`}</p>
      <p data-ok={v.investigation_matches}>{v.investigation_matches ? ui('investigation_ok', 'Investigation unchanged') : 'A newer investigation exists'} · {rec.investigation.model}{ran}</p>
      <p className="fingerprint">Evidence fingerprint {rec.evidence.root} · key {rec.proof.key_id}</p>
      <details><summary>{v.items} fingerprinted records</summary>
        {rec.evidence.items.map((it) => <p key={it.id} className="fingerprint">{itemName(it.id)} · {it.sha256.slice(0, 24)}…</p>)}
      </details>
      <a className="text-btn" href={`/api/passport/${caseKey}/record`} target="_blank" rel="noreferrer">{ui('download_record', 'The signed record (JSON)')} ↗</a>
    </div>
  )
}
