// Iteration 02's dialogs: the factory's bounded response, the reviewer's decision, and the limits.
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, STATUS_LABEL, type CaseKey, type Review, type Status } from './api'
import { dayHm, wall } from './evidence'

export type DialogKind = 'factory' | 'review' | 'limits' | 'qr' | 'letter' | null

type Props = {
  kind: DialogKind; close: () => void; caseKey: CaseKey; status: Status | null; reviews: Review[]; limitations: string[]
  onReviewed: () => void; onSubmitted: () => void; onPassport: () => void
}

export function Dialogs({ kind, close, ...p }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (kind && !d.open) d.showModal()
    if (!kind && d.open) d.close()
  }, [kind])
  return (
    <dialog ref={ref} className={kind === 'qr' ? 'qr-dialog' : ''} onClose={close} onClick={(e) => { if (e.target === ref.current) close() }}>
      <button className="close" onClick={close} aria-label="Close">×</button>
      {kind === 'factory' && <Factory {...p} close={close} />}
      {kind === 'review' && <ReviewForm {...p} close={close} />}
      {kind === 'qr' && <PassportQR {...p} />}
      {kind === 'letter' && <Letter caseKey={p.caseKey} />}
      {kind === 'limits' && (
        <div>
          <span className="micro">THE FINDING’S LIMITS</span>
          <h2>What this evidence can’t show.</h2>
          {p.limitations.map((l) => <div key={l} className="detail-row"><span>{l}</span></div>)}
        </div>
      )}
    </dialog>
  )
}

/** The garment's QR: the product's GS1 Digital Link, which the API resolves to this batch's passport. */
function usePassportQR(caseKey: CaseKey, width: number) {
  const [url, setUrl] = useState('')
  const [qr, setQr] = useState('')
  useEffect(() => { api.passport(caseKey).then((p) => setUrl(`${location.origin}${p.product.link}`)) }, [caseKey])
  useEffect(() => { if (url) QRCode.toDataURL(url, { margin: 1, width, color: { dark: '#171735', light: '#f7f7f2' } }).then(setQr) }, [url, width])
  return qr
}

function PassportQR({ caseKey }: { caseKey: CaseKey }) {
  const qr = usePassportQR(caseKey, 380)
  return (
    <div>
      <span className="micro">THE BATCH PASSPORT</span>
      <h2>The story travels<br />with the label.</h2>
      <a className="qr-link" href={`#/passport/${caseKey}`}>{qr && <img src={qr} alt={`QR code opening the Case ${caseKey} batch passport`} />}</a>
      <p>Scan to open the phone passport, or open it here.</p>
      <a className="button acid" href={`#/passport/${caseKey}`}>Open passport <span>↗</span></a>
      <p className="scope">The QR holds the product’s GS1 Digital Link. A reviewer’s decision signs the passport; until then it shows the investigator’s assessment, unsigned.</p>
    </div>
  )
}

type LetterDraft = { en: string; bn: string; note: string }

/** The evidence request as a message to the factory: Bangla for the factory, the English beside it. */
function Letter({ caseKey }: { caseKey: CaseKey }) {
  const [draft, setDraft] = useState<LetterDraft | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/cases/${caseKey}/letter`, { method: 'POST' })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.detail ?? r.status); setDraft(d) })
      .catch((e) => setError((e as Error).message))
  }, [caseKey])
  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {})
  return (
    <div className="letter">
      <span className="micro">THE REQUEST, FOR THE FACTORY</span>
      <h2>A message to send the factory.</h2>
      {error ? <p className="form-error">{error}</p> : !draft ? <p>Muse Spark is drafting the message…</p> : (
        <>
          <div className="letter-pair">
            <div lang="bn"><span className="micro" lang="en">বাংলা · FOR THE FACTORY</span><p>{draft.bn}</p><button className="text-btn" onClick={() => copy(draft.bn)}>Copy ↗</button></div>
            <div><span className="micro">ENGLISH · FOR YOUR RECORDS</span><p>{draft.en}</p><button className="text-btn" onClick={() => copy(draft.en)}>Copy ↗</button></div>
          </div>
          <p className="scope">{draft.note}</p>
        </>
      )}
    </div>
  )
}

function Factory({ caseKey, onSubmitted, close }: Omit<Props, "kind">) {
  const [note, setNote] = useState('Tank level log from the ETP control room.')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div>
      <span className="micro">FACTORY VIEW / RESPONSE TO AN EVIDENCE REQUEST</span>
      <h2>Equalization tank level log</h2>
      <p>The reviewer asked for the tank level during the ETP stop, 13 Oct 13:10–15:40. Only that record can show the arriving wastewater was held for treatment, rather than leaving another way.</p>
      <label>The requested record</label>
      <div className="upload-file"><b>tank-level-13-oct.csv</b><small>Demo file · 13 Oct 10:00 to 14 Oct 14:00 · one reading every 15 minutes</small></div>
      <label htmlFor="factoryNote">Note to the reviewer</label>
      <textarea id="factoryNote" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="scope">Still the factory’s record: the investigator checks it against the other signals before it counts.</p>
      {error && <p className="form-error">{error}</p>}
      <button className="button ink" disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try { await api.submitSample(caseKey, note); onSubmitted() } catch (e) { setError((e as Error).message); setBusy(false) }
      }}>{busy ? 'Sending…' : 'Send and re-run the investigation'} <span>↗</span></button>
      <button className="text-btn cancel" onClick={close}>Cancel</button>
    </div>
  )
}

function ReviewForm({ caseKey, status, reviews, onReviewed, onPassport }: Omit<Props, "kind">) {
  const [action, setAction] = useState<'approve' | 'change' | 'return'>('approve')
  const [to, setTo] = useState<Status>('review_required')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const qr = usePassportQR(caseKey, 150)
  if (!status) return null
  return (
    <div>
      <span className="micro">YOUR CALL, REVIEWER</span>
      <h2>{STATUS_LABEL[status]}?</h2>
      <p>The investigator’s assessment. Approve it, change it, or send it back. Every decision needs a reason, and the passport shows the latest.</p>
      <div className="choice" role="radiogroup" aria-label="Decision">
        {([['approve', 'Approve'], ['change', 'Change the status'], ['return', 'Send back']] as const).map(([k, l]) => (
          <button key={k} role="radio" aria-checked={action === k} onClick={() => setAction(k)}>{l}</button>
        ))}
      </div>
      {action === 'change' && (
        <select value={to} onChange={(e) => setTo(e.target.value as Status)} aria-label="New status">
          {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== status).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      )}
      <label htmlFor="reviewReason">Reason</label>
      <textarea id="reviewReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What in the records decides it for you?" />
      {error && <p className="form-error">{error}</p>}
      <button className="button ink" disabled={!reason.trim()} onClick={async () => {
        setError('')
        try { await api.review(caseKey, { action, reason, ...(action === 'change' ? { status: to } : {}) }); setReason(''); onReviewed() }
        catch (e) { setError((e as Error).message) }
      }}>Record the decision <span>↗</span></button>
      {reviews.length > 0 && (
        <div className="audit">
          <span className="micro">AUDIT TRAIL</span>
          {reviews.slice().reverse().map((r, i) => (
            <div key={i} className="detail-row"><span>{dayHm(wall(r.at))} · {r.reviewer}</span>
              <span>{r.action === 'change' && r.status ? `Changed to ${STATUS_LABEL[r.status]}` : r.action === 'approve' ? 'Approved' : 'Sent back'} · “{r.reason}”</span></div>
          ))}
        </div>
      )}
      <div className="passport-link">
        {qr && <img src={qr} width={110} height={110} alt="QR code to the batch passport" />}
        <div><b>The batch passport</b><p>Recording a decision signs it. Scan to open it on a phone, or</p><button className="text-btn" onClick={onPassport}>open it here ↗</button></div>
      </div>
    </div>
  )
}
