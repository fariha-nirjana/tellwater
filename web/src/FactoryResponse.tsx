import { useState } from 'react'
import { api, type CaseKey } from './api'

/**
 * The factory's bounded view: one upload for exactly the record that was asked for.
 * In the demo the file is a predefined tank level log (what the tank really did, from the simulator).
 */
export function FactoryResponse({ caseKey, onClose, onSubmitted }: { caseKey: CaseKey; onClose: () => void; onSubmitted: () => void }) {
  const [note, setNote] = useState('Tank level log from the ETP control room.')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setError(null)
    try { await api.submitSample(caseKey, note); onSubmitted() } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Factory response">
      <div className="w-full max-w-lg rounded-2xl bg-paper p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="micro text-mute">Factory view · response to an evidence request</p>
            <h2 className="mt-1 text-2xl font-extrabold">Equalization tank level log</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none">×</button>
        </div>
        <p className="mt-3 text-sm text-ink/80">
          The reviewer asked for the tank level during the ETP stop. Only that record can show the arriving wastewater was held for treatment.
        </p>
        <div className="mt-4 rounded-xl border-2 border-dashed border-ink/30 bg-white p-4">
          <p className="font-semibold">tank-level-13-oct.csv</p>
          <p className="text-xs text-mute">Demo file: 13 Oct 10:00 to 14 Oct 14:00, one reading every 15 minutes</p>
        </div>
        <label className="mt-4 block text-sm font-semibold" htmlFor="factory-note">Note to the reviewer</label>
        <textarea id="factory-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-rule bg-white p-2 text-sm" />
        <p className="mt-2 text-xs text-mute">The submission is still the factory’s record: the investigator checks it against the other signals.</p>
        {error && <p className="mt-2 text-sm text-coral">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Send and re-run the investigation'}
          </button>
        </div>
      </div>
    </div>
  )
}
