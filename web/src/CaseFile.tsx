// The case file, a screen of its own in iteration 03's composition, on real engine output:
// status stamp and finding, the gap in the story (or the evidence request), documents threaded
// to the signals, the explanations board, the full investigation trail, and the human decision.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, STATUS_LABEL, type Allowance, type CaseFile as CF, type CaseKey, type Explanation, type ViewKey, type Series, type Status, type Step, type Trace } from './api'
import { setMood, toolMood, type Mood } from './companion'
import { Dialogs, type DialogKind } from './Dialogs'
import { Guide } from './Guide'
import { dayHm, docLabel, hm, parseEvidence, wall, type Target } from './evidence'
import { ORDER, Timeline } from './Timeline'

const CASES: { key: CaseKey; label: string }[] = [
  { key: 'A', label: 'Maintenance' }, { key: 'B', label: 'Contradiction' }, { key: 'C', label: 'Missing record' },
]
export const TOOL: Record<string, string> = {
  get_case_overview: 'Opened the case', update_hypotheses: 'Updated the stories', get_signal_window: 'Looked at a record',
  compute_water_balance: 'Balanced the water', check_power_vs_load: 'Checked power against load',
  compare_similar_windows: 'Checked for a replayed feed', read_document: 'Read a document',
  check_reading_against_feed: 'Checked a photo against the feed', get_lab_results: 'Read the lab results',
  get_production: 'Read the production plan', submit_assessment: 'Gave the assessment', request_evidence: 'Asked for evidence',
}
// the same tools as an intention, for the moment before the result shows
const NEXT: Record<string, string> = {
  get_case_overview: 'Open the case', update_hypotheses: 'Update the stories', get_signal_window: 'Look at a record',
  compute_water_balance: 'Balance the water', check_power_vs_load: 'Check power against load',
  compare_similar_windows: 'Check for a replayed feed', read_document: 'Read a document',
  check_reading_against_feed: 'Check a photo against the feed', get_lab_results: 'Read the lab results',
  get_production: 'Read the production plan', submit_assessment: 'Give the assessment', request_evidence: 'Ask for evidence',
}
const STAMP: Record<Status, [number, string]> = { supports: [0, '↗'], contradicts: [1, '!'], review_required: [2, '↻'], insufficient: [3, '?'] }
const ROUTINE = /^Lime dosed|^চুন দেওয়া/

export function Stamp({ status, label }: { status: Status; label?: string }) {
  const [n, mark] = STAMP[status]
  return <span className={`stamp stamp-${n}`}><span className="stamp-mark">{mark}</span><span>{label ?? STATUS_LABEL[status]}</span></span>
}

export function CaseFile({ caseKey, bangla = false }: { caseKey: CaseKey; bangla?: boolean }) {
  // the Bangla view reads the same case with its logbook pages in Bangla, and the investigation run on those pages
  const src: ViewKey = bangla ? `${caseKey}-bn` : caseKey
  const [data, setData] = useState<CF | null>(null)
  const [series, setSeries] = useState<Series | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [which, setWhich] = useState<'saved' | 'after' | 'live'>('saved')
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  // each step shows its reason first and its result a beat later, whether watched back or arriving live
  const [phase, setPhase] = useState<'reason' | 'result'>('result')
  const [active, setActive] = useState<string | null>(null)
  const [doc, setDoc] = useState('')
  const [allRecords, setAllRecords] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const [pane, setPane] = useState<'documents' | 'timeline' | 'board'>('documents')
  const [live, setLive] = useState<'idle' | 'running' | 'error' | 'limited'>('idle')
  const [liveError, setLiveError] = useState('')
  const [runs, setRuns] = useState<Allowance | null>(null)
  const refreshRuns = useCallback(() => { api.limits().then((l) => setRuns(l.runs)).catch(() => setRuns(null)) }, [])
  useEffect(refreshRuns, [refreshRuns])
  const [guideOpen, setGuideOpen] = useState(false)
  useEffect(() => {
    const open = () => setGuideOpen(true)
    addEventListener('tw:guide', open)
    return () => removeEventListener('tw:guide', open)
  }, [])
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async (w: 'saved' | 'after') => {
    const [c, t] = await Promise.all([api.case(src), api.trace(src, w)])
    const ti = c.overview.treatment_interval
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm(d)}`
    setSeries(await api.signals(src, iso(new Date(wall(ti.start).getTime() - 2 * 3600_000)), iso(wall(ti.end)), 15))
    setData(c); setTrace(t); setWhich(w); setAt(t.steps.length - 1); setPhase('result'); setActive(null); setPlaying(false)
    setDoc(c.documents.find((d) => d.type === 'logbook')?.id ?? c.documents[0]?.id ?? '')
  }, [src])
  // a case whose factory already answered opens on the investigation after the answer
  useEffect(() => {
    abort.current?.abort(); setLive('idle'); setData(null)
    api.case(src).then((c) => load(c.submission ? 'after' : 'saved'))
  }, [src, load])

  const stepCount = trace?.steps.length ?? 0
  useEffect(() => {
    if (!playing && live !== 'running') return
    if (phase === 'reason') {
      const t = setTimeout(() => setPhase('result'), 950)
      return () => clearTimeout(t)
    }
    if (at < stepCount - 1) {
      const t = setTimeout(() => { setAt((a) => a + 1); setPhase('reason') }, 450)
      return () => clearTimeout(t)
    }
    if (live !== 'running') setPlaying(false)  // caught up with the end of the run
  }, [playing, live, phase, at, stepCount])

  const steps = trace?.steps ?? []
  const step: Step | undefined = steps[at]
  const final = trace?.final
  const complete = !!trace && at >= steps.length - 1 && phase === 'result' && !!final && live !== 'running'
  const thinking = live === 'running' && steps.length > 0 && at >= steps.length - 1 && phase === 'result'

  useEffect(() => {
    if (!step) return
    if (step.tool === 'read_document' && step.args.doc_id) setDoc(step.args.doc_id as string)  // what it is about to read
    const id = step.result?.evidence_id as string | undefined
    if (id && phase === 'result') setActive(id)  // what it found, a beat later
  }, [step, phase])
  useEffect(() => {
    if (complete && !playing && final?.key_evidence?.length) setActive((a) => a ?? final.key_evidence![0].id)
  }, [complete, playing, final])

  const target: Target | null = active ? parseEvidence(active) : null
  useEffect(() => {
    if (target?.doc) return setDoc(target.doc)
    // a photo checked against the feed: show that photo
    const sig = active?.match(/reading_vs_feed:(\w+)@/)?.[1]
    const photo = sig && data?.documents.find((d) => d.id.startsWith(`doc:photo-${sig}-`))
    if (photo) setDoc(photo.id)
  }, [target?.doc, active, data])

  const explanations: Explanation[] = useMemo(() => {
    if (complete && final?.explanations) return final.explanations
    const last = steps.slice(0, at + 1).filter((s) => s.tool === 'update_hypotheses').at(-1)
    return (last?.args.explanations as Explanation[] | undefined) ?? []
  }, [complete, final, steps, at])

  // the companion follows the investigation: reading or checking with each step, a hop when a step reaches
  // a key record, then asking (a record is missing) or can't-tell (a person decides) once the case rests there
  const watching = playing || live === 'running'
  const keySet = useMemo(() => new Set((final?.key_evidence ?? []).map((k) => k.id)), [final])
  const [found, setFound] = useState(false)
  const foundTimer = useRef(0), lastFound = useRef(0)
  useEffect(() => {
    const id = step?.result?.evidence_id as string | undefined
    if (!watching || phase !== 'result' || !id || !keySet.has(id)) return
    if (Date.now() - lastFound.current < 5000) return  // key records come in runs; one hop, then back to the work
    lastFound.current = Date.now()
    setFound(true); clearTimeout(foundTimer.current); foundTimer.current = window.setTimeout(() => setFound(false), 1800)
  }, [step, phase, watching, keySet])
  useEffect(() => () => clearTimeout(foundTimer.current), [])
  const resting = live === 'running' ? null : trace?.status
  const mood: Mood | null = found ? 'found' : watching ? (step ? toolMood(step.tool) : 'reading')
    : resting === 'insufficient' ? 'asking' : resting === 'review_required' ? 'cant-tell' : null
  useEffect(() => setMood(mood), [mood])
  useEffect(() => () => setMood(null), [])

  // the thread: from the line on the page to the record that tests it (one connection at a time)
  const grid = useRef<HTMLDivElement>(null)
  const [thread, setThread] = useState<{ d: string; x: number; y: number } | null>(null)
  const docObj = data?.documents.find((d) => d.id === doc) ?? data?.documents[0]
  const lit = docObj && target ? linesIn(docObj, target.start, target.end) : []
  useLayoutEffect(() => {
    const draw = () => {
      const g = grid.current, a = g?.querySelector('.record-highlight.active, #docAnchor'), b = g?.querySelector('#chartAnchor .chart-pin')
      if (!g || !a || !b || !target || innerWidth <= 760) return setThread(null)
      const r = g.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      const x1 = ra.right - r.left, y1 = ra.top + ra.height / 2 - r.top, x2 = rb.left + rb.width / 2 - r.left, y2 = rb.top + rb.height / 2 - r.top
      const mid = (x1 + x2) / 2
      const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
      setThread((t) => (t?.d === d ? t : { d, x: x2, y: y2 }))  // unchanged geometry: no re-render
    }
    draw()
    const t = setTimeout(draw, 300)
    addEventListener('resize', draw)
    return () => { clearTimeout(t); removeEventListener('resize', draw) }
  }, [active, doc, data, lit.length, allRecords])

  const showPane = (p: typeof pane) => {
    setPane(p)
    const g = grid.current
    if (!g || innerWidth > 760) return
    g.scrollIntoView({ behavior: 'smooth', block: 'start' })
    g.scrollTo({ left: ['documents', 'timeline', 'board'].indexOf(p) * g.clientWidth, behavior: 'smooth' })
  }
  const follow = (id: string) => { setPlaying(false); setPhase('result'); setActive(id); showPane(id.startsWith('doc:') ? 'documents' : 'timeline') }

  if (!data || !trace || !series) return <section className="case-view"><p className="loading">Opening the case file…</p></section>

  const ov = data.overview
  const ti = ov.treatment_interval
  const factory = `Factory ${data.overview.case_id.split('-')[1]?.toUpperCase() ?? ''}`
  const keyIds = (final?.key_evidence ?? []).map((k) => k.id)
  const spans = keyIds.map((id) => parseEvidence(id)).filter((e) => e.start && e.end && e.end.getTime() - e.start.getTime() < 20 * 3600_000)
  const full: [Date, Date] = [new Date(wall(ti.start).getTime() - 2 * 3600_000), wall(ti.end)]
  const range: [Date, Date] = allRecords || !spans.length ? full : [
    new Date(Math.max(full[0].getTime(), Math.min(...spans.map((e) => e.start!.getTime())) - 3 * 3600_000)),
    new Date(Math.min(full[1].getTime(), Math.max(...spans.map((e) => e.end!.getTime())) + 4 * 3600_000)),
  ]
  const shownSet = new Set<string>()
  keyIds.forEach((id) => parseEvidence(id).signals.forEach((s) => shownSet.add(s)))
  if (!complete) steps.slice(0, at + 1).forEach((s) => { if (s.args.signal) shownSet.add(s.args.signal as string) })
  target?.signals.forEach((s) => shownSet.add(s))
  const shown = ORDER.filter((s) => allRecords || shownSet.has(s))
  const claims = data.documents.filter((d) => d.type === 'maintenance_record').map((d) => ({ start: wall(d.covers[0]), end: wall(d.covers[1]) }))
  const status = live === 'running' ? null : (trace.status as Status | null)
  const request = final?.kind === 'evidence_request' ? final : typeof final?.evidence_request === 'object' ? final?.evidence_request : null
  const headline = headlineFor(active, steps)
  const why = complete ? final?.key_evidence?.find((k) => k.id === active)?.why : step?.why
  const reviews = data.review ?? []
  const lastReview = reviews.at(-1)

  // the gap in the story: what the maintenance record claims against how long power really stayed low
  const lowPower = keyIds.map((id) => parseEvidence(id)).find((e) => e.label?.toLowerCase().includes('power') && e.start && e.end)
  const gap = status === 'contradicts' && claims[0] && lowPower?.end && lowPower.end.getTime() > claims[0].end.getTime() + 30 * 60_000
    ? { claim: claims[0], low: lowPower } : null
  const physicalId = steps.find((s) => s.tool === 'check_reading_against_feed')?.result?.evidence_id as string | undefined

  const runLive = async () => {
    abort.current = new AbortController()
    const before = { trace, which, at }
    setLive('running'); setLiveError(''); setWhich('live'); setPlaying(false)
    setTrace({ ...trace, steps: [], final: null, status: null, ledger: [] }); setAt(-1); setPhase('result'); setActive(null)
    try {
      const res = await fetch(`/api/cases/${caseKey}/investigate`, { method: 'POST', signal: abort.current.signal })
      if (!res.ok) {
        // over a demo cap (or the server refused): back to the investigation that was showing, with the reason
        const detail = (await res.json().catch(() => ({}))).detail
        setTrace(before.trace); setWhich(before.which); setAt(before.at); setPhase('result')
        setLive(res.status === 429 ? 'limited' : 'error'); setLiveError(detail ?? `the server answered ${res.status}`)
        return
      }
      const reader = res.body!.getReader(), dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
          const kind = chunk.match(/^event: (\w+)/m)?.[1], payload = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] ?? 'null')
          // steps are revealed one beat at a time by the effect above; the final trace lets it play out to the end
          if (kind === 'step') setTrace((t) => t && { ...t, steps: [...t.steps, payload] })
          else if (kind === 'final') { setTrace(payload); setPlaying(true); setLive('idle') }
          else if (kind === 'error') { setLive('error'); setLiveError(payload.error) }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { setLive('error'); setLiveError((e as Error).message) }
    } finally { refreshRuns() }
  }

  const windowStart = Math.max(0, Math.min(at - 1, steps.length - 4))
  const enlargedDoc = data.documents.find((d) => d.id === enlarged)

  return (
    <section className="case-view">
      <div className="case-nav">
        <a href="#/">← The garment</a><span>THE CASE FILE</span>
        <div><a href="#/results">Results ↗</a><button onClick={() => setDialog('qr')}>Batch passport ▦</button></div>
      </div>

      <header className="case-header">
        <div className="case-identity">
          <span className="micro">{factory} (demo) · {ov.batch.shade} shade</span>
          <h1>Batch {ov.batch.id.split('-').at(-1)}</h1>
          <p>Produced {dayHm(wall(ov.batch.production_start))} to {dayHm(wall(ov.batch.production_end))} · {Math.round(ov.batch.planned_wastewater_m3)} m³ planned</p>
          <p>Treatment interval <strong>{dayHm(wall(ti.start))} to {dayHm(wall(ti.end))}</strong></p>
        </div>
        <div className="case-status">
          {status ? <Stamp status={status} /> : <span className="stamp stamp-working"><span className="stamp-mark"><i className="pulse" /></span><span>Investigating · step {Math.max(1, at + 1)}</span></span>}
          <small>{final?.scope_line ?? ''}</small>
        </div>
        <div className="case-switch" role="group" aria-label="Choose case">
          {CASES.map((c) => <button key={c.key} aria-pressed={c.key === caseKey} onClick={() => { location.hash = `#/case/${c.key}` }}><b>{c.key}</b><span>{c.label}</span></button>)}
        </div>
        {data.bangla_view && (
          <div className="logbook-language" role="group" aria-label="Language of the logbook pages">
            <span className="micro">LOGBOOK WRITTEN IN</span>
            <button aria-pressed={!bangla} onClick={() => { location.hash = `#/case/${caseKey}` }}>English</button>
            <button aria-pressed={bangla} lang="bn" onClick={() => { location.hash = `#/case/${caseKey}/bn` }}>বাংলা</button>
          </div>
        )}
      </header>

      <section className="case-finding">
        <div className="finding-label">
          <span className="micro">THE FINDING{which === 'after' ? ' · AFTER THE FACTORY’S RECORD' : which === 'live' ? ' · LIVE RUN' : ''}</span>
          <small>Tap a line to follow its evidence.</small>
        </div>
        <div>
          <p className="finding-summary">{live === 'running' ? 'Muse Spark is investigating. The finding appears when it finishes.' : final?.summary ?? final?.reason}</p>
          {live !== 'running' && (
            <div className="finding-sentences">
              {(final?.key_evidence ?? []).slice(0, 6).map((k) => (
                <button key={k.id} className={active === k.id ? 'chosen' : ''} onClick={() => follow(k.id)}>{k.why}<span>↗</span></button>
              ))}
            </div>
          )}
          {final?.limitations?.length ? <button className="text-btn limits-link" onClick={() => setDialog('limits')}>What this can’t show ↗</button> : null}
        </div>
      </section>

      {gap && (
        <section className="contradiction-ribbon">
          <div><span className="micro">THE GAP IN THE STORY</span>
            <p>Logged service <b>{hm(gap.claim.start)}–{hm(gap.claim.end)}</b><span>→</span>Low power <b>{hm(gap.low.start!)}–{hm(gap.low.end!)}</b></p></div>
          {physicalId && <button onClick={() => { follow(physicalId); document.querySelector('.physical-moment')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>Follow the physical evidence ↗</button>}
        </section>
      )}
      {request && (which === 'saved' || which === 'live') && (
        <section className="request-slip">
          <span className="request-icon">?</span>
          <div><span className="micro">A GAP, NOT A VERDICT</span>
            <p>Requested: {(request.items ?? []).join(', ')}{request.interval ? `, ${spanText(request.interval)}` : ''}. Why: {request.reason}</p></div>
          <div className="request-actions">
            <button className="text-btn" onClick={() => setDialog('letter')}>Draft it for the factory <span lang="bn">(বাংলা)</span> ↗</button>
            {caseKey === 'C' && !bangla && which === 'saved' && <button className="button acid small" onClick={() => setDialog('factory')}>Respond as factory ↗</button>}
          </div>
        </section>
      )}
      {which === 'after' && data.submission && (
        <section className="request-slip received">
          <span className="request-icon">↗</span>
          <div><span className="micro">RECORD RECEIVED</span>
            <p>{data.submission.file} · {spanText([wall(data.submission.covers[0]), wall(data.submission.covers[1])])}. Investigated again with the factory’s record; it still counts as the factory’s word until it agrees with the other signals.</p>
            {data.submission.note && <small>Factory note: {data.submission.note}</small>}</div>
          <button className="button ink small" onClick={async () => { await api.clearSubmission(caseKey); load('saved') }}>Reset the demo ↺</button>
        </section>
      )}

      <div className="phone-sections" role="tablist" aria-label="Case file sections">
        {(['documents', 'timeline', 'board'] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pane === p} onClick={() => showPane(p)}>{p === 'board' ? 'Explanations' : p === 'timeline' ? 'Timeline' : 'Documents'}</button>
        ))}
      </div>
      <div className="case-grid" ref={grid} onScroll={(e) => {
        if (innerWidth > 760) return
        const g = e.currentTarget, i = Math.round(g.scrollLeft / g.clientWidth)
        setPane((['documents', 'timeline', 'board'] as const)[i] ?? 'documents')
      }}>
        <svg className="case-thread" aria-hidden="true">{thread && <><path d={thread.d} /><circle r="4" cx={thread.x} cy={thread.y} /></>}</svg>

        <section className="case-panel documents-panel">
          <div className="panel-title"><h2>The documents</h2><span>CLAIMS & PHYSICAL RECORDS</span></div>
          <div className="document-tabs">
            {data.documents.map((d) => (
              <button key={d.id} aria-pressed={d.id === docObj?.id} className={d.is_claim ? '' : 'physical'} onClick={() => setDoc(d.id)}>
                {d.image ? <img src={d.image} alt="" /> : <span className="text-thumb">Aa</span>}<span>{docLabel(d.id)}</span>
              </button>
            ))}
          </div>
          {docObj && <DocView doc={docObj} lit={lit} focused={!!target && (target.doc === docObj.id || !!active?.includes('reading_vs_feed'))} onEnlarge={() => setEnlarged(docObj.id)} />}
        </section>

        <section className="case-panel timeline-panel">
          <div className="panel-title"><h2>Follow the signals</h2><span>{allRecords ? 'EVERY RECORD' : 'THE RECORDS THAT MATTER'}</span></div>
          <div id="chartAnchor" className="chart-label">
            <span className="chart-pin" />
            <div><b>{headline.title}</b><small>{headline.sub}</small></div>
            <span>{headline.value}</span>
          </div>
          <div className="chart stacked">
            <Timeline series={series} info={data.signals} shown={shown} range={range} highlight={target?.start ? target : null} bands={claims} />
          </div>
          <div className="timeline-key">
            <span><i className="evidence-band" />The stretch being checked</span>
            {claims.length > 0 && <span><i className="claim-band" />What the maintenance record claims</span>}
            {shown.includes('S3') && <span><i className="need-band" />Power the plant needs for its inflow</span>}
          </div>
          <button className="text-btn more-records" onClick={() => setAllRecords((v) => !v)}>{allRecords ? '▾ The records that matter' : '▸ More records'}</button>
          <Physical steps={steps} documents={data.documents} active={active} onPick={follow} />
        </section>

        <section className="case-panel board-panel">
          <div className="panel-title"><h2>What explains it?</h2><span>KEEP EVERY POSSIBILITY IN VIEW</span></div>
          <div className="explanations-board">
            {explanations.map((e) => {
              const state = e.status === 'contradicted' ? 'ruled out' : e.status === 'supported' ? 'supported' : 'open'
              const chips = e.status === 'contradicted' ? e.contradicting : e.supporting.length ? e.supporting : e.contradicting
              return (
                <article key={e.id} className={`explanation-card ${state.replace(' ', '-')}`}>
                  <div><span className="explanation-state">{state === 'supported' ? '↗' : state === 'ruled out' ? '−' : '○'} {state}</span><span className="mini-stitch">〰</span></div>
                  <h3>{e.label}</h3>
                  <div className="evidence-chips">
                    {chips.slice(0, 3).map((id) => <button key={id} aria-pressed={active === id} onClick={() => follow(id)}>{chipText(id)} ↗</button>)}
                    {e.missing.length > 0 && <span>Missing: {e.missing.map(chipText).join(', ')}</span>}
                  </div>
                </article>
              )
            })}
            {!explanations.length && <article className="explanation-card open"><h3>The investigator lists the possible explanations first.</h3></article>}
          </div>
          <p className="board-note">Ruled-out explanations stay visible. Each chip takes you to the record behind the decision.</p>
        </section>
      </div>

      <section className="case-explanation">
        <div>
          <span className="micro">{complete ? 'LET ME CONNECT THE DOTS'
            : !step && live === 'running' ? 'LIVE RUN · MUSE SPARK'
            : phase === 'reason' && step ? <><i className="pulse" />NEXT · {(NEXT[step.tool] ?? step.tool).toUpperCase()}</>
            : 'WHY THIS CHECK'}</span>
          <p aria-live="polite">{why ?? (live === 'running' ? 'Opening the case…' : 'Tap a line of the finding, a chip or a record to follow its evidence.')}</p>
          {thinking && <small className="thinking-line"><i className="pulse" />Muse Spark is choosing the next check…</small>}
        </div>
        <button onClick={() => setGuideOpen(true)}>Explain this simply ↗</button>
      </section>

      <section className="trail-section">
        <div className="trail-heading">
          <div><h2>Investigation trail</h2>
            <p>{live === 'running'
              ? `Live run by Muse Spark${trace.model ? ` (${trace.model})` : ''} · ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} so far`
              : `${steps.length} recorded steps by Muse Spark${trace.model ? ` (${trace.model})` : ''} · ${trace.checks_used || steps.length} checks · about ${Math.round(trace.seconds || 0)} s${which === 'after' ? ' · run after the factory’s record arrived' : which === 'live' ? ' · live run, just now' : ''}`}</p></div>
          <div className="trail-actions">
            <button className="button ink small" onClick={() => { if (playing) return setPlaying(false); setAt(0); setPhase('reason'); setPlaying(true) }} disabled={live === 'running'}>
              {playing ? 'Pause replay' : 'Watch the investigation'} <span>{playing ? 'Ⅱ' : '▶'}</span>
            </button>
            {bangla ? <small className="runs-left">The investigation Muse Spark ran on the Bangla pages. Live runs and reviews are on the English case.</small> : <>
            <button className="text-btn" onClick={runLive} disabled={live === 'running' || runs?.left === 0}>
              {live === 'running' ? 'Muse Spark is investigating…'
                : runs && !runs.live ? 'Live runs are off in this demo'
                : runs?.left === 0 ? 'Live runs used up for today'
                : 'Run it live with Muse Spark ↗'}
            </button>
            {runs?.live && runs.left > 0 && live !== 'running' && <small className="runs-left">{runs.left} of {runs.per_visitor} live runs left today</small>}
            </>}
          </div>
        </div>
        {live === 'error' && <p className="live-error">The live run stopped: {liveError}</p>}
        {live === 'limited' && <p className="live-error live-note">{liveError}</p>}
        <div className="trail-list">
          {steps.slice(windowStart, windowStart + 4).map((s, k) => {
            const i = windowStart + k
            return (
              <button key={i} aria-pressed={i === at} disabled={i > at && !complete && (playing || live === 'running')}
                onClick={() => { setPlaying(false); setPhase('result'); setAt(i) }}>
                <span className="trail-dot" /><b>{String(s.n).padStart(2, '0')} · {i === at && phase === 'reason' ? NEXT[s.tool] ?? s.tool : TOOL[s.tool] ?? s.tool}</b>
                <span>{s.why ?? '—'}</span>
              </button>
            )
          })}
        </div>
        <div className="trail-controls">
          <label htmlFor="trailScrub">Step {Math.max(1, at + 1)} of {steps.length}</label>
          <input id="trailScrub" type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.max(0, at)}
            onChange={(e) => { setPlaying(false); setPhase('result'); setAt(Number(e.target.value)) }} aria-label="Scrub the investigation's steps" />
          <button disabled={live === 'running'} onClick={() => { setPlaying(false); setPhase('result'); setAt(steps.length - 1) }}>Show final assessment ↗</button>
        </div>
      </section>

      <section className="review-bar">
        <div><span className="micro">THE HUMAN DECISION</span>
          <p>{lastReview ? `${lastReview.action === 'change' && lastReview.status ? `Changed to ${STATUS_LABEL[lastReview.status]}` : lastReview.action === 'approve' ? 'Approved' : 'Sent back'} · “${lastReview.reason}”` : 'The evidence is ready for a reviewer.'}</p></div>
        {!bangla && <a className="text-btn" href={`#/report/${caseKey}`}>Audit report ↗</a>}
        {bangla ? <a className="button ink small" href={`#/case/${caseKey}`}>Review on the English case ↗</a>
          : <button className="button acid small" disabled={!status} onClick={() => setDialog('review')}>Review assessment ↗</button>}
      </section>
      {reviews.length > 0 && (
        <section className="audit-trail"><h3>Decision history</h3>
          {reviews.slice().reverse().map((r, i) => (
            <div key={i} className="detail-row"><span>{dayHm(wall(r.at))} · {r.reviewer}</span>
              <span>{r.action === 'change' && r.status ? `Changed to ${STATUS_LABEL[r.status]}` : r.action === 'approve' ? 'Approved' : 'Sent back'} · “{r.reason}”</span></div>
          ))}
        </section>
      )}
      <div className="case-footer"><span>Prototype · records from the Tellwater simulator · real Muse Spark investigations</span><a href={`#/passport/${caseKey}`}>Open batch passport ↗</a></div>

      {enlargedDoc?.image && <Enlarged doc={enlargedDoc} caseKey={caseKey} close={() => setEnlarged(null)} />}
      <Guide caseKey={src} focus={active} open={guideOpen} onClose={() => setGuideOpen(false)} onCite={follow} />
      <Dialogs kind={dialog} close={() => setDialog(null)} caseKey={caseKey} status={status} reviews={reviews}
        limitations={final?.limitations ?? []} onReviewed={() => load(which === 'after' ? 'after' : 'saved')}
        onSubmitted={async () => { setDialog(null); await load('after'); setAt(0); setPhase('reason'); setPlaying(true) }}
        onPassport={() => { location.hash = `#/passport/${caseKey}` }} />
    </section>
  )
}

function Enlarged({ doc, caseKey, close }: { doc: CF['documents'][number]; caseKey: CaseKey; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="document-dialog" onClose={close} onClick={(e) => { if (e.target === ref.current) close() }}>
      <button className="close" onClick={close} aria-label="Close">×</button>
      <span className="micro">{doc.is_claim ? 'FACTORY CLAIM' : 'PHYSICAL RECORD'} · CASE {caseKey}</span>
      <h2>{docLabel(doc.id)}</h2>
      <img className="full-document" src={doc.image!} alt={docLabel(doc.id)} />
    </dialog>
  )
}

function DocView({ doc, lit, focused, onEnlarge }: { doc: CF['documents'][number]; lit: ReturnType<typeof linesIn>; focused: boolean; onEnlarge: () => void }) {
  const physical = !doc.is_claim
  const caption = `${doc.author} · ${physical ? 'physical record' : 'the factory’s own record'} · ${dayHm(wall(doc.covers[0]))}`
  return (
    <div id="documentViewer">
      <div className={`doc-type ${physical ? 'physical' : 'claim'}`}><span>{physical ? 'PHYSICAL RECORD' : 'FACTORY CLAIM'}</span><b>{docLabel(doc.id)}</b></div>
      {doc.image ? (
        <div className="doc-stage"><div className="doc-image-wrap">
          <img src={doc.image} alt={`${docLabel(doc.id)}, ${doc.author}, from the Tellwater simulator`} />
          {lit.map((l, i) => (
            <span key={l.index} className={`record-highlight ${i === 0 ? 'active' : ''}`} title={`${l.time} ${l.text}`}
              style={{ left: `${l.box.x_min / 10}%`, top: `${l.box.y_min / 10}%`, width: `${(l.box.x_max - l.box.x_min) / 10}%`, height: `${(l.box.y_max - l.box.y_min) / 10}%` }} />
          ))}
          {!lit.length && focused && <span id="docAnchor" className="document-pin" />}
        </div></div>
      ) : (
        <div className="operator-statement">
          <span className="micro">{doc.type === 'operator_statement' ? 'OPERATOR STATEMENT' : 'FACTORY SUBMISSION'} · RECEIVED {dayHm(wall(doc.received_at)).toUpperCase()}</span>
          <blockquote id={focused ? 'docAnchor' : undefined}>“{String((doc.content as { text?: string })?.text ?? '')}”</blockquote>
        </div>
      )}
      <div className="doc-caption"><span>{caption}</span>{doc.image && <button onClick={onEnlarge}>Enlarge ↗</button>}</div>
      {doc.lines?.some((l) => l.en) && <Translation lines={doc.lines} lit={lit} />}
    </div>
  )
}

/** A Bangla page with the English each entry was written from, line by line. The investigator never sees this:
 * it read the handwritten Bangla on the photo itself. */
function Translation({ lines, lit }: { lines: NonNullable<CF['documents'][number]['lines']>; lit: ReturnType<typeof linesIn> }) {
  const shown = new Set(lit.map((l) => l.index))
  return (
    <div className="translation">
      <div className="translation-head"><span className="micro">ENGLISH, LINE BY LINE</span>
        <small>The page is in Bangla. Muse Spark read the handwriting itself and was never given this English.</small></div>
      <ol>
        {lines.map((l) => (
          <li key={l.index} className={`${shown.has(l.index) ? 'lit' : ''} ${l.crossed_out ? 'crossed' : ''}`}>
            <time>{l.time}</time><span lang="bn">{l.text}</span><span>{l.en}{l.crossed_out ? ' (crossed out on the page)' : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Logbook lines written inside the window, the factory's own words about that stretch. */
function linesIn(doc: CF['documents'][number], start?: Date, end?: Date) {
  if (!doc.lines || !start || !end) return []
  const day = wall(doc.covers[0])
  return doc.lines.filter((l) => {
    const [h, m] = l.time.split(':').map(Number)
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
    return t >= new Date(start.getTime() - 20 * 60_000) && t <= new Date(end.getTime() + 20 * 60_000) && !ROUTINE.test(l.text)
  })
}

function chipText(id: string) {
  const t = parseEvidence(id)
  if (t.kind === 'doc') return docLabel(id)
  // the case header gives the date; a chip only needs the hours (or the moment, for a reading)
  const point = t.start && t.end && t.end.getTime() - t.start.getTime() <= 10 * 60_000
  const span = !t.start || !t.end ? '' : point ? ` ${hm(t.start)}` : t.start.toDateString() === t.end.toDateString() ? ` ${hm(t.start)}–${hm(t.end)}` : ' whole interval'
  return `${t.kind === 'signal' ? t.signals[0] : t.label}${span}`
}

function spanText(x: string | [string, string] | [Date, Date]) {
  const [a, b] = typeof x === 'string' ? x.split(' to ').map(wall) : x.map((v) => (typeof v === 'string' ? wall(v) : v))
  if (!b) return hm(a)
  return a.toDateString() === b.toDateString() ? `${a.getDate()} ${a.toLocaleString('en', { month: 'short' })} ${hm(a)}–${hm(b)}` : `${dayHm(a)} to ${dayHm(b)}`
}

/** The chart's headline for the evidence in focus, from the tool result that produced it. */
function headlineFor(active: string | null, steps: Step[]): { title: string; sub: string; value: string } {
  if (!active) return { title: 'The records', sub: 'Pick a line of the finding or a step', value: '' }
  const t = parseEvidence(active)
  const r = steps.find((s) => s.result?.evidence_id === active)?.result as Record<string, unknown> | undefined
  const sub = t.start && t.end ? spanText([t.start, t.end]) : ''
  if (r && 'observed_mean_kw' in r) return { title: 'Power against what the inflow needs', sub: `kW · ${sub}`, value: `${r.observed_mean_kw} vs ${r.expected_mean_kw}` }
  if (r && 'reading_given' in r) return { title: 'Meter photo against the feed', sub: `kW · ${sub}`, value: `${r.reading_given} / ${r.feed_nearest}` }
  if (r && 'mean' in r && t.kind === 'signal') return { title: String(r.name ?? t.signals[0]), sub: `${r.unit} · ${sub}`, value: r.mean === null ? 'No record' : `${r.min}–${r.max}` }
  if (r && 'etp' in r) {
    const tank = r.tank as { unaccounted_m3?: number } | null
    return { title: 'Water balance', sub: `m³ · ${sub}`, value: tank ? `${tank.unaccounted_m3} m³ unaccounted` : 'Tank balance: no record' }
  }
  if (r && 'comparisons' in r) {
    const longest = Math.max(0, ...(r.comparisons as { longest_identical_stretch_minutes: number }[]).map((c) => c.longest_identical_stretch_minutes))
    return { title: 'Replay check', sub, value: longest >= 60 ? `${longest} min copied` : 'No copied stretch' }
  }
  return { title: t.label, sub, value: '' }
}

/** The physical cross-check: meter photos checked against the feed, and lab samples. From the investigation's own results. */
function Physical({ steps, documents, active, onPick }: { steps: Step[]; documents: CF['documents']; active: string | null; onPick: (id: string) => void }) {
  const photos = steps.filter((s) => s.tool === 'check_reading_against_feed' && s.result?.reading_given !== undefined)
  const labs = (steps.find((s) => s.tool === 'get_lab_results')?.result?.lab_results as Record<string, unknown>[] | undefined) ?? []
  if (!photos.length && !labs.length) return null
  return (
    <div className="physical-moment">
      <span className="micro">THE PHYSICAL CROSS-CHECK · RECORDS A FEED CANNOT FAKE</span>
      {photos.map((s) => {
        const r = s.result as Record<string, number | string | boolean>
        const sig = String(r.signal), time = String(r.time).slice(11, 16)
        const img = documents.find((d) => d.id.startsWith(`doc:photo-${sig}-`))?.image
        const below = r.reading_vs_expected_band === 'below'
        return (
          <div key={String(r.evidence_id)}>
            <div className="meter-comparison">
              <button aria-pressed={active === r.evidence_id} onClick={() => onPick(String(r.evidence_id))}>{img && <img src={img} alt={`Meter photo reading ${r.reading_given} at ${time}`} />}</button>
              <div><b>{String(r.reading_given)} <small>{sig === 'S3' ? 'kW' : ''}</small></b><span>Meter photo · {time}</span>
                <p>Feed <strong>{String(r.feed_nearest)}</strong>{r.expected_kw_from_inflow !== undefined && <><br />Needed about <strong>{String(r.expected_kw_from_inflow)}</strong></>}</p></div>
            </div>
            <p>{r.consistent ? 'The photo matches the feed, so the reading is real, not a meter fault.' : 'The photo disagrees with the feed: the feed is what is wrong.'}{below ? ' And it sits below what the plant needs for the water coming in.' : ''}</p>
          </div>
        )
      })}
      {labs.map((l) => {
        const over = Number(l.bod_mg_l) > Number(l.bod_limit_mg_l)
        return (
          <button key={String(l.evidence_id)} className="lab-moment" aria-pressed={active === l.evidence_id} onClick={() => onPick(String(l.evidence_id))}>
            <span>{String(l.sample_point).toUpperCase()} · {String(l.sample_time).slice(-5)}</span>
            <strong>BOD {String(l.bod_mg_l)} <small>mg/L</small></strong>
            <span>Limit {String(l.bod_limit_mg_l)} mg/L · pH {String(l.ph)} <b>{over ? 'Above the limit ↗' : 'Within the limit ↗'}</b></span>
          </button>
        )
      })}
    </div>
  )
}
