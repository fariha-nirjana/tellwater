import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type CaseFile as CF, type CaseKey, type Explanation, type Series, type Status, type Step, type Trace } from './api'
import { Board } from './Board'
import { Documents, linesInWindow } from './Documents'
import { dayHm, hm, parseEvidence, wall, type Target } from './evidence'
import { FactoryResponse } from './FactoryResponse'
import { ReviewPanel } from './ReviewPanel'
import { ORDER, Timeline } from './Timeline'
import { Trail } from './Trail'
import { Stamp, Thread, useWidth } from './ui'

const CASES: { key: CaseKey; label: string }[] = [
  { key: 'A', label: 'Maintenance' }, { key: 'B', label: 'Low power' }, { key: 'C', label: 'Missing record' },
]

export function CaseFile({ caseKey, go }: { caseKey: CaseKey; go: (hash: string) => void }) {
  const [data, setData] = useState<CF | null>(null)
  const [series, setSeries] = useState<Series | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [which, setWhich] = useState<'saved' | 'after' | 'live'>('saved')
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [doc, setDoc] = useState<string>('')
  const [allSignals, setAllSignals] = useState(false)
  const [factoryOpen, setFactoryOpen] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const timelineWidth = useWidth('timeline-box')

  const load = useCallback(async (w: 'saved' | 'after') => {
    const c = await api.case(caseKey)
    const t = await api.trace(caseKey, w)
    const ti = c.overview.treatment_interval
    const pad = (s: string, h: number) => new Date(wall(s).getTime() + h * 3600_000)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm(d)}`
    setSeries(await api.signals(caseKey, fmt(pad(ti.start, -2)), fmt(pad(ti.end, 0)), 15))
    setData(c); setTrace(t); setWhich(w); setAt(t.steps.length - 1); setActive(null)
    setDoc(c.documents.find((d) => d.type === 'logbook')?.id ?? c.documents[0]?.id ?? '')
  }, [caseKey])

  useEffect(() => { load('saved') }, [load])

  // replay: one step every 1.1 s
  useEffect(() => {
    if (!playing || !trace) return
    if (at >= trace.steps.length - 1) { setPlaying(false); return }
    const t = setTimeout(() => setAt((a) => a + 1), 1100)
    return () => clearTimeout(t)
  }, [playing, at, trace])

  const steps = trace?.steps ?? []
  const step: Step | undefined = steps[at]
  const final = trace?.final
  const complete = !!trace && at >= steps.length - 1 && !!final

  // what the current step looked at
  useEffect(() => {
    if (!step) return
    const id = (step.result?.evidence_id as string) ?? null
    if (id) setActive(id)
    if (step.tool === 'read_document' && step.args.doc_id) setDoc(step.args.doc_id as string)
  }, [step])

  useEffect(() => {
    if (complete && !playing && final?.key_evidence?.length) setActive((a) => a ?? final.key_evidence![0].id)
  }, [complete, playing, final])

  const target: Target | null = active ? parseEvidence(active) : null
  useEffect(() => { if (target?.doc) setDoc(target.doc) }, [target?.doc])

  const explanations: Explanation[] = useMemo(() => {
    if (!trace) return []
    if (complete && final?.explanations) return final.explanations
    // the latest update the investigator made up to this step (also works mid live run)
    const last = steps.slice(0, at + 1).filter((s) => s.tool === 'update_hypotheses').at(-1)
    return (last?.args.explanations as Explanation[] | undefined) ?? []
  }, [trace, at, complete, final, steps])

  if (!data || !trace || !series) return <p className="p-10 text-mute">Opening the case file…</p>

  const ov = data.overview
  const ti = ov.treatment_interval
  const keyIds = (final?.key_evidence ?? []).map((k) => k.id)
  const spans = keyIds.map((id) => parseEvidence(id)).filter((e) => e.start && e.end && e.end.getTime() - e.start.getTime() < 20 * 3600_000)
  const full: [Date, Date] = [new Date(wall(ti.start).getTime() - 2 * 3600_000), wall(ti.end)]
  const range: [Date, Date] = allSignals || !spans.length ? full : [
    new Date(Math.max(full[0].getTime(), Math.min(...spans.map((e) => e.start!.getTime())) - 3 * 3600_000)),
    new Date(Math.min(full[1].getTime(), Math.max(...spans.map((e) => e.end!.getTime())) + 4 * 3600_000)),
  ]
  const touched = new Set<string>()
  for (const id of keyIds) parseEvidence(id).signals.forEach((s) => touched.add(s))
  if (!complete) steps.slice(0, at + 1).forEach((s) => { const sig = s.args.signal as string; if (sig) touched.add(sig) })
  target?.signals.forEach((s) => touched.add(s))
  const shown = ORDER.filter((s) => allSignals || touched.has(s) || (ov.signals[s]?.coverage_of_treatment_interval === 0 && touched.size < 3))
  const docObj = data.documents.find((d) => d.id === doc) ?? data.documents[0]
  const lit = target && docObj ? linesInWindow(docObj, target.start, target.end) : []
  const claimBands = data.documents.filter((d) => d.type === 'maintenance_record')
    .map((d) => ({ start: wall(d.covers[0]), end: wall(d.covers[1]), tone: 'claim' as const }))
  const status = (complete ? trace.status : null) as Status | null
  const request = complete ? (final?.kind === 'evidence_request' ? final : typeof final?.evidence_request === 'object' ? final?.evidence_request : null) : null
  const threadFrom = lit.length ? `line-${lit[0].index}` : target?.kind === 'doc' ? 'doc-viewer' : null

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-8">
      {/* header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink py-6">
        <div>
          <p className="micro text-mute">Case file · Factory A (demo) · records from the Tellwater simulator</p>
          <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">Batch {ov.batch.id.split('-').at(-1)} <span className="serif-em text-indigo">does the claim hold?</span></h1>
          <p className="mt-1 text-sm text-mute">
            {ov.batch.shade} shade · produced {dayHm(wall(ov.batch.production_start))}–{hm(wall(ov.batch.production_end))} ·
            treated {dayHm(wall(ti.start))} to {dayHm(wall(ti.end))}
          </p>
        </div>
        <nav className="flex gap-1 rounded-full bg-ink p-1" aria-label="Demo cases">
          {CASES.map((c) => (
            <button key={c.key} onClick={() => go(`#/case/${c.key}`)} aria-pressed={c.key === caseKey}
              className={`rounded-full px-4 py-1.5 text-sm ${c.key === caseKey ? 'bg-acid text-ink' : 'text-white/80 hover:text-white'}`}>
              <span className="micro mr-1 opacity-60">{c.key}</span>{c.label}
            </button>
          ))}
        </nav>
      </header>

      {/* finding */}
      <section className="grid gap-6 py-6 lg:grid-cols-[1fr_auto]" aria-live="polite">
        <div>
          {status ? <Stamp status={status} /> : <span className="micro rounded-md bg-indigo-soft px-3 py-1.5 text-indigo">Investigating · step {at + 1} of {steps.length}</span>}
          <p className="mt-3 max-w-3xl text-lg leading-relaxed">
            {complete ? final?.summary ?? final?.reason : step?.why ?? '…'}
          </p>
          {complete && final?.scope_line && <p className="mt-2 text-xs text-mute">{final.scope_line}</p>}
          {which !== 'saved' && <p className="micro mt-2 text-indigo">{which === 'after' ? 'Investigation run after the factory’s submission' : 'Live run, just now'}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <button onClick={() => { setAt(0); setPlaying(true) }} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
            {playing ? 'Playing…' : 'Watch the investigation ▶'}
          </button>
          <LiveButton caseKey={caseKey} onStart={() => { setLiveError(null); setPlaying(false); setTrace({ ...trace, steps: [], final: null, status: null, ledger: [] }); setAt(-1); setWhich('live') }}
            onStep={(s) => { setTrace((t) => t && { ...t, steps: [...t.steps, s] }); setAt((a) => a + 1) }}
            onFinal={(t) => { setTrace(t); setAt(t.steps.length - 1) }} onError={setLiveError} />
        </div>
      </section>
      {liveError && <p className="mb-4 rounded-lg bg-coral/20 p-3 text-sm">{liveError}</p>}

      {/* evidence request */}
      {request && (
        <section className="mb-6 rounded-xl border-2 border-dashed border-ink bg-white p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <p className="micro text-coral">Evidence requested</p>
            <p className="mt-1 font-display text-lg font-bold">{(request.items ?? []).join(', ')} {request.interval && `· ${Array.isArray(request.interval) ? request.interval.join(' to ') : request.interval}`}</p>
            <p className="mt-1 text-sm text-ink/80">{request.reason}</p>
          </div>
          {caseKey === 'C' && which === 'saved' && (
            <button onClick={() => setFactoryOpen(true)} className="mt-4 shrink-0 rounded-full bg-acid px-4 py-2 text-sm font-semibold sm:mt-0">Respond as the factory ↗</button>
          )}
        </section>
      )}

      {/* workspace */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)_minmax(0,4fr)]">
        <section aria-label="Documents" id="doc-viewer">
          <p className="micro mb-2 text-mute">01 / What the factory says, and the physical records</p>
          {docObj && <Documents docs={data.documents} selected={docObj.id} onSelect={setDoc} lit={lit} />}
        </section>

        <section aria-label="Records" className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <p className="micro text-mute">02 / What the records show</p>
            <button onClick={() => setAllSignals((v) => !v)} className="text-xs text-indigo">{allSignals ? 'Show the records that matter' : 'All records, whole interval'}</button>
          </div>
          <div id="timeline-box" className="card overflow-hidden p-3">
            <Timeline series={series} info={data.signals} shown={shown} range={range} width={Math.max(280, timelineWidth - 24)}
              highlight={target && target.start ? target : null} bands={claimBands} />
            <p className="mt-1 flex flex-wrap gap-4 text-[11px] text-mute">
              <span><i className="mr-1 inline-block h-2 w-3 bg-[#fff7cc] align-middle" />What the maintenance record claims</span>
              <span><i className="mr-1 inline-block h-2 w-3 border border-dashed border-indigo bg-indigo/10 align-middle" />The stretch being checked</span>
              {shown.includes('S3') && <span><i className="mr-1 inline-block h-2 w-3 bg-indigo/10 align-middle" />Power the plant needs for its inflow</span>}
            </p>
          </div>
          {step?.why && !complete && (
            <div className="mt-3 rounded-xl bg-indigo-soft p-4">
              <p className="micro text-indigo">Why this check</p>
              <p className="mt-1">{step.why}</p>
            </div>
          )}
          {complete && final?.key_evidence && (
            <div className="mt-3">
              <p className="micro mb-2 text-mute">The records behind the finding</p>
              <ul className="flex flex-col gap-1.5">
                {final.key_evidence.map((k) => (
                  <li key={k.id}>
                    <button onClick={() => setActive(k.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${active === k.id ? 'border-indigo bg-indigo-soft' : 'border-rule bg-white hover:border-indigo'}`}>
                      {k.why}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside aria-label="Explanations" className="flex flex-col gap-6">
          <div>
            <p className="micro mb-2 text-mute">03 / The possible stories</p>
            {explanations.length ? <Board explanations={explanations} onPick={setActive} active={active} /> : <p className="text-sm text-mute">The investigator lists the possible stories first.</p>}
          </div>
          <div>
            <p className="micro mb-2 text-mute">The investigation · {trace.checks_used || steps.length} checks{trace.seconds ? ` · ${Math.round(trace.seconds)} s` : ''}</p>
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <Trail steps={steps} at={at} onPick={(i) => { setPlaying(false); setAt(i) }} />
            </div>
          </div>
        </aside>
      </div>

      {complete && final?.limitations && final.limitations.length > 0 && (
        <details className="mt-8 rounded-xl border border-rule bg-white p-4">
          <summary className="cursor-pointer font-semibold">What this evidence cannot show</summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink/80">{final.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      )}

      {complete && status && <ReviewPanel caseKey={caseKey} status={status} reviews={data.review ?? []} onSaved={() => load(which === 'after' ? 'after' : 'saved')} go={go} />}

      <Thread from={threadFrom} to={target?.start ? 'timeline-band' : null} />
      {factoryOpen && (
        <FactoryResponse caseKey={caseKey} onClose={() => setFactoryOpen(false)}
          onSubmitted={async () => { setFactoryOpen(false); await load('after'); setAt(0); setPlaying(true) }} />
      )}
    </div>
  )
}

function LiveButton({ caseKey, onStart, onStep, onFinal, onError }: {
  caseKey: CaseKey; onStart: () => void; onStep: (s: Step) => void; onFinal: (t: Trace) => void; onError: (e: string) => void
}) {
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const run = async () => {
    setRunning(true); onStart()
    abort.current = new AbortController()
    try {
      const res = await fetch(`/api/cases/${caseKey}/investigate`, { method: 'POST', signal: abort.current.signal })
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
          const kind = chunk.match(/^event: (\w+)/m)?.[1]
          const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] ?? 'null')
          if (kind === 'step') onStep(data)
          else if (kind === 'final') onFinal(data)
          else if (kind === 'error') onError(`The live run stopped: ${data.error}`)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onError(`The live run stopped: ${(e as Error).message}`)
    } finally { setRunning(false) }
  }
  return (
    <button onClick={run} disabled={running} className="rounded-full border border-ink px-4 py-2 text-sm font-semibold disabled:opacity-60">
      {running ? 'Muse Spark is investigating…' : 'Run it live with Muse Spark'}
    </button>
  )
}
