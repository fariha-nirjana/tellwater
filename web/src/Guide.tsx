// The thread guide: iteration 02's chat panel, answered by Muse Spark from this case's investigation only.
// Citations in an answer become chips that thread to their record.
import { useEffect, useRef, useState } from 'react'
import { api, type Allowance, type CaseKey } from './api'
import { docLabel, parseEvidence } from './evidence'

type Msg = { role: 'user' | 'assistant'; content: string; cited?: string[] }

const PROMPTS = ['Explain this simply', 'Why not the factory’s explanation?', 'What would change the finding?']

export function Guide({ caseKey, focus, open, onClose, onCite }: {
  caseKey: CaseKey; focus: string | null; open: boolean; onClose: () => void; onCite: (id: string) => void
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState<Allowance | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) api.limits().then((l) => setLeft(l.questions)).catch(() => setLeft(null)) }, [open, msgs.length])
  useEffect(() => setMsgs([]), [caseKey])
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [msgs, busy])
  if (!open) return null

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    const history = msgs.map(({ role, content }) => ({ role, content }))
    setMsgs((m) => [...m, { role: 'user', content: question }]); setInput(''); setBusy(true)
    try {
      const r = await fetch(`/api/cases/${caseKey}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, focus, history }) })
      const d = await r.json()
      setMsgs((m) => [...m, r.ok ? { role: 'assistant', content: d.answer, cited: d.cited } : { role: 'assistant', content: `I couldn’t answer that: ${d.detail ?? r.status}` }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `I couldn’t reach the investigator: ${(e as Error).message}` }])
    } finally { setBusy(false) }
  }

  return (
    <aside className="chat" aria-label="Thread guide">
      <div className="chat-head">
        <div><span className="micro">YOUR THREAD FRIEND</span><h3>Let’s untangle it.</h3></div>
        <button className="close" onClick={onClose} aria-label="Close thread guide">×</button>
      </div>
      <p className="chat-context">{focus ? `Looking at: ${chipName(focus)}` : `Case ${caseKey}: ask about anything in this investigation.`}</p>
      <div className="messages" aria-live="polite">
        {msgs.length === 0 && <div className="message">Ask me about this case. I only answer from its records, and I’ll say so when they can’t tell.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`message ${m.role === 'user' ? 'user' : ''}`}>{m.role === 'assistant' ? <Answer text={m.content} onCite={onCite} /> : m.content}</div>
        ))}
        {busy && <div className="message thinking">Reading the records…</div>}
        <div ref={end} />
      </div>
      <div className="prompts">{PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} disabled={busy}>{p}</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Ask about the evidence" placeholder="Ask about this evidence…" maxLength={600} autoComplete="off" />
        <button aria-label="Send question" disabled={busy}>↗</button>
      </form>
      <small className="chat-disclosure">Answered by Muse Spark from this case’s records only · citations are checked against them
        {left && (left.live ? ` · ${left.left} of ${left.per_visitor} questions left today` : ' · questions are off in this demo')}</small>
    </aside>
  )
}

/** An answer with its [evidence-id] citations turned into chips. */
function Answer({ text, onCite }: { text: string; onCite: (id: string) => void }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <>
      {parts.map((p, i) => {
        const id = p.match(/^\[([^\]]+)\]$/)?.[1]
        return id ? <button key={i} className="cite" onClick={() => onCite(id)}>{chipName(id)}</button> : <span key={i}>{p}</span>
      })}
    </>
  )
}

function chipName(id: string) {
  const t = parseEvidence(id)
  if (t.kind === 'doc') return docLabel(id)
  const hm = (d: Date) => d.toTimeString().slice(0, 5)
  const span = t.start && t.end ? (t.end.getTime() - t.start.getTime() <= 10 * 60_000 ? ` ${hm(t.start)}` : ` ${hm(t.start)}–${hm(t.end)}`) : ''
  return `${t.kind === 'signal' ? t.signals[0] : t.label}${span}`
}
