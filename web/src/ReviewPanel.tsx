import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api, STATUS_LABEL, type CaseKey, type Review, type Status } from './api'
import { dayHm, wall } from './evidence'

/** The human decision. Every action needs a reason; the passport shows the latest. */
export function ReviewPanel({ caseKey, status, reviews, onSaved, go }: {
  caseKey: CaseKey; status: Status; reviews: Review[]; onSaved: () => void; go: (h: string) => void
}) {
  const [action, setAction] = useState<'approve' | 'change' | 'return'>('approve')
  const [to, setTo] = useState<Status>('review_required')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const passportUrl = `${location.origin}${location.pathname}#/passport/${caseKey}`
  useEffect(() => { QRCode.toDataURL(passportUrl, { margin: 1, width: 160, color: { dark: '#171735', light: '#ffffff' } }).then(setQr) }, [passportUrl])

  const save = async () => {
    setError(null)
    try {
      await api.review(caseKey, { action, reason, ...(action === 'change' ? { status: to } : {}) })
      setReason(''); onSaved()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <section className="mt-8 grid gap-6 rounded-2xl bg-ink p-6 text-white lg:grid-cols-[1fr_auto]" aria-label="Reviewer decision">
      <div>
        <p className="micro text-acid">Your call, reviewer</p>
        <h2 className="mt-1 text-2xl font-extrabold">The investigator assessed: {STATUS_LABEL[status]}</h2>
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
          {([['approve', 'Approve'], ['change', 'Change the status'], ['return', 'Send back for more evidence']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={action === k} onClick={() => setAction(k)}
              className={`rounded-full px-4 py-1.5 text-sm ${action === k ? 'bg-acid text-ink' : 'bg-white/10'}`}>{l}</button>
          ))}
          {action === 'change' && (
            <select value={to} onChange={(e) => setTo(e.target.value as Status)} className="rounded-full bg-white/10 px-3 py-1.5 text-sm" aria-label="New status">
              {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== status).map((s) => <option key={s} value={s} className="text-ink">{STATUS_LABEL[s]}</option>)}
            </select>
          )}
        </div>
        <label htmlFor="reason" className="micro mt-4 block text-white/60">Reason (required)</label>
        <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg bg-white/10 p-2 text-sm text-white placeholder:text-white/40" placeholder="What in the records decides it for you?" />
        {error && <p className="mt-1 text-sm text-coral">{error}</p>}
        <button onClick={save} disabled={!reason.trim()} className="mt-3 rounded-full bg-acid px-5 py-2 text-sm font-semibold text-ink disabled:opacity-40">Record the decision</button>
        {reviews.length > 0 && (
          <ol className="mt-5 border-t border-white/15 pt-3 text-sm" aria-label="Audit trail">
            {reviews.slice().reverse().map((r, i) => (
              <li key={i} className="py-1 text-white/80">
                <span className="micro mr-2 text-white/50">{dayHm(wall(r.at))}</span>
                {r.reviewer} · {r.action === 'change' && r.status ? `changed to ${STATUS_LABEL[r.status]}` : r.action === 'approve' ? 'approved' : 'sent back'} · “{r.reason}”
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="flex flex-col items-center gap-2">
        {qr && <img src={qr} alt="QR code to the batch passport" className="rounded-lg" width={140} height={140} />}
        <button onClick={() => go(`#/passport/${caseKey}`)} className="text-sm text-acid">Open the batch passport ↗</button>
      </div>
    </section>
  )
}
