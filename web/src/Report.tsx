import { SHADE } from './Garments'
// The audit report: what an auditor files for one batch, laid out to print or save as a PDF.
// The finding and its scope, the key evidence, the evidence request, lab results, every check the
// investigation ran with its reason, the reviewer's decisions, the signed record and all limitations.
import { useEffect, useState, type ReactNode } from 'react'
import { api, STATUS_LABEL, type CaseFile as CF, type CaseKey, type Passport as P, type Trace } from './api'
import { Stamp, TOOL } from './CaseFile'
import { dayHm, wall } from './evidence'

export function Report({ caseKey }: { caseKey: CaseKey }) {
  const [p, setP] = useState<P | null>(null)
  const [c, setC] = useState<CF | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  useEffect(() => {
    api.passport(caseKey).then(setP)
    // the investigation the passport stands on: the run after the factory's record, if there is one
    api.case(caseKey).then((cf) => { setC(cf); return api.trace(caseKey, cf.submission ? 'after' : 'saved') }).then(setTrace)
  }, [caseKey])
  if (!p || !c || !trace) return <p className="loading">Preparing the audit report…</p>

  const held = !!p.held
  const status = p.status === 'pending_review' ? 'review_required' : p.status ?? 'insufficient'
  const steps = trace.steps.filter((s) => s.tool !== 'update_hypotheses')
  return (
    <article className="report">
      <div className="report-actions">
        <a href={`#/case/${caseKey}`}>← Case file</a>
        <button className="button acid small" onClick={() => print()}>Print or save as PDF <span>↗</span></button>
      </div>

      <header className="report-head">
        <span className="micro">AUDIT REPORT · WASTEWATER TREATMENT CLAIM</span>
        <h1>Batch {p.batch.id}</h1>
        {held && <p className="report-held">Not yet decided: held for review</p>}
        <p>{p.garment.factory} · {p.garment.origin} · {SHADE[p.batch.shade]?.name ?? p.batch.shade} · produced {dayHm(wall(p.batch.production_start))} to {dayHm(wall(p.batch.production_end))}</p>
        <p>Treatment interval {dayHm(wall(p.treatment_interval[0]))} to {dayHm(wall(p.treatment_interval[1]))} · report prepared {dayHm(new Date())}</p>
        <p className="report-disclosure">{p.disclosure}</p>
      </header>

      <Part title={held ? 'Readings awaiting a decision' : 'The finding'}>
        {held ? <>
          <p>No finding is published until a person at the buyer decides. The readings below are for the reviewer's consideration.</p>
          <p><b>First reading:</b> {trace.status ? STATUS_LABEL[trace.status] : 'No answer'}. {trace.final?.summary ?? trace.final?.reason}</p>
          {c.second_reader && <p><b>Second reading:</b> {STATUS_LABEL[c.second_reader.status]}. {c.second_reader.summary}</p>}
        </> : <div className="report-finding"><Stamp status={status} /><p>{p.summary}</p></div>}
        {p.review?.action === 'change' && p.assessed_status && <p className="report-note">Changed by the reviewer. The investigator assessed: {STATUS_LABEL[p.assessed_status]}.</p>}
        {p.scope_line && <p className="report-note"><b>Scope.</b> {p.scope_line}</p>}
      </Part>

      <Part title="Key evidence">
        <table><thead><tr><th>Evidence</th><th>What it shows</th></tr></thead>
          <tbody>{p.key_evidence.map((k) => <tr key={k.id}><td className="mono">{k.id}</td><td>{k.why}</td></tr>)}</tbody></table>
      </Part>

      {p.evidence_request && (
        <Part title="Requested from the factory">
          <p>{(p.evidence_request.items ?? []).join(', ')}{p.evidence_request.interval ? `, ${p.evidence_request.interval}` : ''}.</p>
          {p.evidence_request.reason && <p className="report-note">Why: {p.evidence_request.reason}</p>}
          {c.submission && <p className="report-note">Received: {c.submission.file}, {dayHm(wall(c.submission.at))}. The finding above is from the investigation run after it arrived.</p>}
        </Part>
      )}

      {p.lab.length > 0 && (
        <Part title="Lab results">
          <table><thead><tr><th>Sample</th><th>BOD</th><th>Limit</th><th>pH</th><th></th></tr></thead>
            <tbody>{p.lab.map((l) => (
              <tr key={l.evidence_id}><td>{l.sample_point} · {l.sample_time}</td><td>{l.bod_mg_l} mg/L</td><td>{l.bod_limit_mg_l} mg/L</td><td>{l.ph}</td>
                <td>{l.bod_mg_l > l.bod_limit_mg_l ? 'Above the limit' : 'Within the limit'}</td></tr>
            ))}</tbody></table>
        </Part>
      )}

      <Part title="The investigation">
        <p>{trace.model ?? p.investigation.model} ran {trace.checks_used} checks in about {Math.round(trace.seconds)} s. {trace.valid ? 'Every citation in the finding was checked against the evidence it retrieved.' : 'The finding did not pass the citation check.'} All arithmetic was done in code; the model chose the checks and interpreted the results.</p>
        <table><thead><tr><th>#</th><th>Check</th><th>Why it was run</th></tr></thead>
          <tbody>{steps.map((s) => <tr key={s.n}><td>{s.n}</td><td>{TOOL[s.tool] ?? s.tool}</td><td>{s.why ?? '–'}</td></tr>)}</tbody></table>
      </Part>

      <Part title="The human decision">
        {p.reviews.length ? (
          <table><thead><tr><th>When</th><th>Reviewer</th><th>Decision</th><th>Reason</th></tr></thead>
            <tbody>{p.reviews.map((r, i) => (
              <tr key={i}><td>{dayHm(wall(r.at))}</td><td>{r.reviewer}</td>
                <td>{r.action === 'change' && r.status ? `Changed to ${STATUS_LABEL[r.status]}` : r.action === 'approve' ? 'Approved' : 'Sent back'}</td><td>{r.reason}</td></tr>
            ))}</tbody></table>
        ) : <p>Not yet reviewed. Until a reviewer decides, this is the investigator’s assessment and nothing is signed.</p>}
      </Part>

      <Part title="The signed record">
        {p.record && p.verification ? (
          <>
            <p>{p.verification.signature_valid ? 'The signature checks out: the record was issued by this service and has not been altered.' : 'The signature does not match: the record was altered or not issued here.'}{' '}
              {p.verification.evidence_matches ? 'The evidence is unchanged since the review.' : 'The evidence has changed since the review.'}{' '}
              {p.verification.investigation_matches ? 'The investigation is unchanged.' : 'A newer investigation exists.'}</p>
            <p className="mono">Issued {dayHm(new Date(p.record.issued_at))} · {p.record.proof.alg} · key {p.record.proof.key_id}</p>
            <p className="mono">Evidence fingerprint {p.record.evidence.root}</p>
            <p className="mono">Investigation fingerprint {p.record.investigation.sha256}</p>
            <table><thead><tr><th>Record</th><th>SHA-256</th></tr></thead>
              <tbody>{p.record.evidence.items.map((it) => <tr key={it.id}><td>{it.id.split('/').at(-1)}</td><td className="mono">{it.sha256}</td></tr>)}</tbody></table>
          </>
        ) : <p>No signed record yet: one is issued when a reviewer approves or changes the finding.</p>}
      </Part>

      <Part title="What this cannot show">
        <ul>{p.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </Part>

      <footer className="report-foot">Products from this dye run: {p.products.map((x) => `${x.name} (GTIN ${x.gtin})`).join(' · ')}. {p.disclosure}</footer>
    </article>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return <section className="report-part"><h2>{title}</h2>{children}</section>
}
