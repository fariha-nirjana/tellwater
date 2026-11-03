// The thread guide: iteration 02's chat panel, answered by Muse Spark. In a case file and on a batch passport it answers from
// that case's investigation only; elsewhere on the site from a short brief, the five cases' findings and the measured results.
// Citations in an answer become chips that thread to their record.
import { useEffect, useRef, useState } from 'react'
import { api, type Allowance, type CaseKey, type ViewKey } from './api'
import { setGuideBusy } from './companion'
import { docLabel, parseEvidence } from './evidence'
import { Icon } from './Icon'

type Msg = { role: 'user' | 'assistant'; content: string; cited?: string[]; lang?: string }

// the languages it answers in, by their own names: English, Bangla, and the buyers' languages the passport is translated into.
// A question can be typed in any of them, or mixed (Bangla in English letters with English words); the answer comes in the one chosen.
const LANGS: [string, string, string][] = [
  ['en', 'English', 'English'], ['bn', 'বাংলা', 'Bangla'], ['de', 'Deutsch', 'German'], ['fr', 'Français', 'French'], ['es', 'Español', 'Spanish'],
  ['it', 'Italiano', 'Italian'], ['nl', 'Nederlands', 'Dutch'], ['pl', 'Polski', 'Polish'], ['pt', 'Português', 'Portuguese'],
  ['sv', 'Svenska', 'Swedish'], ['da', 'Dansk', 'Danish'], ['ja', '日本語', 'Japanese'],
]
const englishName = (code: string) => LANGS.find(([c]) => c === code)?.[2] ?? code

export type GuideScope = 'case' | 'passport' | 'site'
const PROMPTS: Record<GuideScope, string[]> = {
  case: ['Explain this simply', 'Why not the factory’s explanation?', 'What would change the finding?'],
  passport: ['What does this mean for my shirt?', 'Who checked this?', 'Can I trust it?'],
  site: ['What does Tellwater do?', 'How is the water checked?', 'How accurate is it?'],
}
const INTRO: Record<GuideScope, string> = {
  case: 'Ask me about this case. I only answer from its records, and I’ll say so when they can’t tell.',
  passport: 'Ask me about the water behind this garment. I answer from the investigation of the dye run it was cut from.',
  site: 'Ask me about Tellwater: what it checks, how it works, the five cases or the results.',
}

export function Guide({ caseKey, focus, open, onClose, onCite, scope = 'case', languages = 'all' }: {
  caseKey: ViewKey; focus: string | null; open: boolean; onClose: () => void; onCite: (id: string) => void; scope?: GuideScope
  languages?: 'all' | 'en-bn'  // the factory's page: English and Bangla
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Bangla answers are written live by Muse Spark; on the Bangla logbook view they are the default
  const [lang, setLang] = useState(caseKey.endsWith('-bn') ? 'bn' : 'en')
  const choices = languages === 'en-bn' ? LANGS.slice(0, 2) : LANGS
  const [left, setLeft] = useState<Allowance | null>(null)
  const [passportState, setPassportState] = useState<'checking' | 'held' | 'open' | 'unavailable'>('checking')
  useEffect(() => {
    if (!open || scope !== 'passport') return
    let current = true
    setPassportState('checking')
    api.passport(caseKey as CaseKey).then((p) => {
      if (current) setPassportState(p.held ? 'held' : 'open')
    }).catch(() => { if (current) setPassportState('unavailable') })
    return () => { current = false }
  }, [open, scope, caseKey])
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) api.limits().then((l) => setLeft(l.questions)).catch(() => setLeft(null)) }, [open, msgs.length])
  useEffect(() => setMsgs([]), [caseKey])
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [msgs, busy])
  useEffect(() => setGuideBusy(busy), [busy])  // the companion reads while an answer is written
  if (!open) return null
  if (scope === 'passport' && passportState !== 'open') return (
    <aside className="chat" aria-label="Thread guide">
      <div className="chat-head"><div><span className="micro">THE BATCH PASSPORT</span><h3>About this batch</h3></div><button className="close" onClick={onClose} aria-label="Close thread guide">×</button></div>
      <p className="chat-context" lang="en">{passportState === 'checking' ? 'Checking the review state…' : passportState === 'held' ? 'This batch is being reviewed by a person. Check back soon.' : 'The review state could not be loaded. Please reopen the passport.'}</p>
    </aside>
  )

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    const history = msgs.map(({ role, content }) => ({ role, content }))
    setMsgs((m) => [...m, { role: 'user', content: question }]); setInput(''); setBusy(true)
    try {
      const r = await fetch(scope === 'site' ? '/api/ask' : `/api/cases/${caseKey}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, focus, history, lang, reader: scope === 'passport' ? 'shopper' : 'reviewer' }) })
      const d = await r.json()
      setMsgs((m) => [...m, r.ok ? { role: 'assistant', content: d.answer, cited: d.cited, lang: d.lang } : { role: 'assistant', content: `I couldn’t answer that: ${d.detail ?? r.status}` }])
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
      <p className="chat-context">{focus ? `Looking at: ${chipName(focus)}` : scope === 'site' ? 'Tellwater: how it works, the five cases and the results.'
        : scope === 'passport' ? `This garment’s dye run (case ${caseKey}): ask about its water.` : `Case ${caseKey.replace('-bn', ', Bangla logbook')}: ask about anything in this investigation.`}</p>
      <div className="messages" aria-live="polite">
        {msgs.length === 0 && <div className="message">{INTRO[scope]}</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`message ${m.role === 'user' ? 'user' : ''}`} lang={m.lang}>
            {m.role === 'assistant' ? <Answer text={m.content} onCite={onCite} /> : m.content}
            {m.lang && m.lang !== 'en' && <small className="machine-note" lang="en">Written in {englishName(m.lang)} by Muse Spark · not checked by a person</small>}
          </div>
        ))}
        {busy && <div className="message thinking">Reading the records…</div>}
        <div ref={end} />
      </div>
      <label className="answer-language">
        <span>Answer in</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language of the answers">
          {choices.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
        </select>
        <small>Ask in any language, or mix them.</small>
      </label>
      <div className="prompts">{PROMPTS[scope].map((p) => <button key={p} onClick={() => ask(p)} disabled={busy}>{p}</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Ask about the evidence" placeholder={scope === 'site' ? 'Ask about Tellwater…' : scope === 'passport' ? 'Ask about this garment’s water…' : 'Ask about this evidence…'} maxLength={600} autoComplete="off" />
        <button aria-label="Send question" disabled={busy}><Icon n="ne" /></button>
      </form>
      <small className="chat-disclosure">{scope === 'site' ? 'Answered by Muse Spark from the site’s brief, the five cases and the results' : 'Answered by Muse Spark from this case’s records only'} · citations are checked against them
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
  if (id === 'results') return 'Results'
  if (id.startsWith('case:')) return `Case ${id.slice(5)}`
  const t = parseEvidence(id)
  if (t.kind === 'doc') return docLabel(id)
  const hm = (d: Date) => d.toTimeString().slice(0, 5)
  const span = t.start && t.end ? (t.end.getTime() - t.start.getTime() <= 10 * 60_000 ? ` ${hm(t.start)}` : ` ${hm(t.start)}–${hm(t.end)}`) : ''
  return `${t.kind === 'signal' ? t.signals[0] : t.label}${span}`
}
