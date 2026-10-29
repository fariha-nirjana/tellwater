// The investigation workspace, in iteration 02's composition, on real engine output:
// the factory's claim (the real logbook photo) threaded to the record that tests it,
// the explanation strip, the possible stories, the steps, and the finding.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, STATUS_LABEL, type CaseFile as CF, type CaseKey, type Explanation, type Series, type Status, type Step, type Trace } from './api'
import { Dialogs, type DialogKind } from './Dialogs'
import { docLabel, parseEvidence, wall, dayHm, hm, type Target } from './evidence'
import { ORDER, Timeline } from './Timeline'

const CASES: { key: CaseKey; label: string; title: string }[] = [
  { key: 'A', label: 'Maintenance', title: 'Power stopped. The water waited.' },
  { key: 'B', label: 'Low power', title: 'The service ended. The low power didn’t.' },
  { key: 'C', label: 'Missing record', title: 'A pause in treatment. A gap in the story.' },
]
const TOOL: Record<string, string> = {
  get_case_overview: 'Opened the case', update_hypotheses: 'Updated the stories', get_signal_window: 'Looked at a record',
  compute_water_balance: 'Balanced the water', check_power_vs_load: 'Checked power against load',
  compare_similar_windows: 'Checked for a replayed feed', read_document: 'Read a document',
  check_reading_against_feed: 'Checked a photo against the feed', get_lab_results: 'Read the lab results',
  get_production: 'Read the production plan', submit_assessment: 'Gave the assessment', request_evidence: 'Asked for evidence',
}
const ROUTINE = /^Lime dosed/

export function Workspace({ caseKey, setCase, onPassport }: { caseKey: CaseKey; setCase: (k: CaseKey) => void; onPassport: (k: CaseKey) => void }) {
  const [data, setData] = useState<CF | null>(null)
  const [series, setSeries] = useState<Series | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [which, setWhich] = useState<'saved' | 'after' | 'live'>('saved')
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [doc, setDoc] = useState('')
  const [allRecords, setAllRecords] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [live, setLive] = useState<'idle' | 'running' | 'error'>('idle')
  const [liveError, setLiveError] = useState('')
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async (w: 'saved' | 'after') => {
    const [c, t] = await Promise.all([api.case(caseKey), api.trace(caseKey, w)])
    const ti = c.overview.treatment_interval
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm(d)}`
    setSeries(await api.signals(caseKey, iso(new Date(wall(ti.start).getTime() - 2 * 3600_000)), iso(wall(ti.end)), 15))
    setData(c); setTrace(t); setWhich(w); setAt(t.steps.length - 1); setActive(null); setPlaying(false)
    setDoc(c.documents.find((d) => d.type === 'logbook')?.id ?? c.documents[0]?.id ?? '')
  }, [caseKey])
  useEffect(() => { abort.current?.abort(); setLive('idle'); load('saved') }, [load])

  useEffect(() => {
    if (!playing || !trace) return
    if (at >= trace.steps.length - 1) { setPlaying(false); return }
    const t = setTimeout(() => setAt((a) => a + 1), 1200)
    return () => clearTimeout(t)
  }, [playing, at, trace])

  const steps = trace?.steps ?? []
  const step: Step | undefined = steps[at]
  const final = trace?.final
  const complete = !!trace && at >= steps.length - 1 && !!final && live !== 'running'

  useEffect(() => {
    if (!step) return
    const id = step.result?.evidence_id as string | undefined
    if (id) setActive(id)
    if (step.tool === 'read_document' && step.args.doc_id) setDoc(step.args.doc_id as string)
  }, [step])
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

  // the thread: from the claim on the page to the record that tests it
  const stage = useRef<HTMLDivElement>(null)
  const [thread, setThread] = useState<string | null>(null)
  const docObj = data?.documents.find((d) => d.id === doc) ?? data?.documents[0]
  const lit = docObj && target ? linesIn(docObj, target.start, target.end) : []
  useLayoutEffect(() => {
    const draw = () => {
      const s = stage.current, a = s?.querySelector('.lit-line, .doc-anchor'), b = s?.querySelector('#chartAnchor .chart-pin')
      if (!s || !a || !b || !target) return setThread(null)
      const r = s.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      if (innerWidth <= 760) return setThread(null)
      const x1 = ra.right - r.left, y1 = ra.top + ra.height / 2 - r.top, x2 = rb.left + rb.width / 2 - r.left, y2 = rb.top + rb.height / 2 - r.top
      const mid = (x1 + x2) / 2
      setThread(`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`)
    }
    draw()
    const t = setTimeout(draw, 250)
    addEventListener('resize', draw)
    return () => { clearTimeout(t); removeEventListener('resize', draw) }
  }, [active, doc, data, lit.length, target])

  if (!data || !trace || !series) {
    return <section id="investigation" className="investigation section-pad"><p className="loading">Opening the case file…</p></section>
  }

  const ov = data.overview
  const ti = ov.treatment_interval
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
  const claimBands = data.documents.filter((d) => d.type === 'maintenance_record').map((d) => ({ start: wall(d.covers[0]), end: wall(d.covers[1]) }))
  const status = complete ? (trace.status as Status) : null
  const request = complete ? (final?.kind === 'evidence_request' ? final : typeof final?.evidence_request === 'object' ? final?.evidence_request : null) : null
  const meta = CASES.find((c) => c.key === caseKey)!
  const why = complete ? final?.key_evidence?.find((k) => k.id === active)?.why : step?.why
  const headline = headlineFor(active, steps)

  const runLive = async () => {
    abort.current = new AbortController()
    setLive('running'); setLiveError(''); setWhich('live'); setPlaying(false)
    setTrace({ ...trace, steps: [], final: null, status: null, ledger: [] }); setAt(-1); setActive(null)
    try {
      const res = await fetch(`/api/cases/${caseKey}/investigate`, { method: 'POST', signal: abort.current.signal })
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
          if (kind === 'step') { setTrace((t) => t && { ...t, steps: [...t.steps, payload] }); setAt((a) => a + 1) }
          else if (kind === 'final') { setTrace(payload); setAt(payload.steps.length - 1); setLive('idle') }
          else if (kind === 'error') { setLive('error'); setLiveError(payload.error) }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { setLive('error'); setLiveError((e as Error).message) }
    }
  }

  return (
    <section id="investigation" className="investigation section-pad">
      <div className="section-heading">
        <div><span className="micro">THE INVESTIGATION / BUYER & REVIEWER VIEW</span><h2>Does the story<br /><span className="serif">hold together?</span></h2></div>
        <p>A factory says the water was treated.<br />Pick a case. Follow one connection at a time.</p>
      </div>

      <div className="workspace">
        <div className="workspace-top">
          <div className="batch"><span className="batch-icon">〰</span><div><b>Batch {ov.batch.id.split('-').at(-1)} · {ov.batch.shade} shade</b>
            <small>FACTORY A · SIMULATED RECORDS · TREATED {dayHm(wall(ti.start)).toUpperCase()} TO {dayHm(wall(ti.end)).toUpperCase()}</small></div></div>
          <div className="case-picker" role="group" aria-label="Choose demo case">
            {CASES.map((c, i) => (
              <button key={c.key} aria-pressed={c.key === caseKey} onClick={() => setCase(c.key)}><span>0{i + 1}</span> {c.label}</button>
            ))}
          </div>
          <button className="text-btn" onClick={() => setDialog('factory')} disabled={!(caseKey === 'C' && which === 'saved')}>Factory view ↗</button>
        </div>

        <div className="workspace-title">
          <div>
            <span className="status" data-type={status ?? 'working'}>{status ? STATUS_LABEL[status].toUpperCase() : `INVESTIGATING · STEP ${Math.max(1, at + 1)} OF ${steps.length || '…'}`}</span>
            <h3>{meta.title}</h3>
          </div>
          <div className="title-actions">
            <button className="button ink small" onClick={() => { setAt(0); setPlaying(true) }} disabled={live === 'running'}>
              {playing ? 'Watching…' : 'Watch the investigation'} <span>▶</span>
            </button>
            <button className="text-btn" onClick={runLive} disabled={live === 'running'}>
              {live === 'running' ? 'Muse Spark is investigating…' : 'Run it live with Muse Spark ↗'}
            </button>
          </div>
        </div>
        {live === 'error' && <p className="live-error">The live run stopped: {liveError}</p>}

        <div className="evidence-stage" ref={stage}>
          <svg className="connection" aria-hidden="true">
            {thread && <><path id="connectionShadow" d={thread} /><path className="drawing" key={thread} d={thread} /></>}
          </svg>

          <article className="claim">
            <div className="card-caption">
              <span>01 / {docObj?.is_claim ? 'WHAT THE FACTORY SAYS' : 'A PHYSICAL RECORD'}</span>
              <span className="doc-picker" role="tablist" aria-label="Documents">
                {data.documents.map((d) => (
                  <button key={d.id} role="tab" aria-selected={d.id === docObj?.id} className={d.is_claim ? 'is-claim' : 'is-record'} onClick={() => setDoc(d.id)}>{docLabel(d.id)}</button>
                ))}
              </span>
            </div>
            {docObj && <DocView doc={docObj} lit={lit} focused={target?.doc === docObj.id} />}
            <p className="claim-note">{docObj?.is_claim ? 'A written claim. Let’s see what backs it up.' : 'Measured, not written: physical evidence.'}</p>
          </article>

          <article className="record">
            <div className="card-caption">
              <span>02 / WHAT THE RECORDS SHOW</span>
              <button className="text-btn" onClick={() => setAllRecords((v) => !v)}>{allRecords ? 'The records that matter' : 'All records ↗'}</button>
            </div>
            <div id="chartAnchor" className="chart-label">
              <span className="chart-pin" />
              <div><b>{headline.title}</b><small>{headline.sub}</small></div>
              <span>{headline.value}</span>
            </div>
            <div className="chart stacked">
              <Timeline series={series} info={data.signals} shown={shown} range={range} highlight={target?.start ? target : null} bands={claimBands} />
            </div>
            <div className="chart-legend">
              <span><i /> Recorded signal</span><span><i /> The stretch being checked</span>
              {claimBands.length > 0 && <span className="legend-claim"><i /> What the maintenance record claims</span>}
              {shown.includes('S3') && <span className="legend-band"><i /> Power the plant needs for its inflow</span>}
            </div>
          </article>
        </div>

        <Measured steps={steps} active={active} onPick={(id) => { setPlaying(false); setActive(id) }} />

        <div className="explanation">
          <div id="evidenceDock" className="evidence-friend-anchor" />
          <div className="explanation-copy">
            <span className="micro">{complete ? 'LET ME CONNECT THE DOTS' : 'WHY THIS CHECK'}</span>
            <p aria-live="polite">{why ?? (live === 'running' ? 'Opening the case…' : '…')}</p>
          </div>
        </div>

        <div className="stories">
          <div className="card-caption"><span>03 / THE POSSIBLE STORIES</span><span>{explanations.filter((e) => e.status === 'contradicted').length} RULED OUT · {explanations.filter((e) => e.status === 'supported').length} SUPPORTED · {explanations.filter((e) => e.status === 'open').length} OPEN</span></div>
          <ul className="story-cards">
            {explanations.map((e) => {
              const chips = e.status === 'contradicted' ? e.contradicting : e.supporting.length ? e.supporting : e.contradicting
              return (
                <li key={e.id} className="story-card" data-state={e.status}>
                  <span className="story-state">{e.status === 'contradicted' ? 'RULED OUT' : e.status === 'supported' ? 'SUPPORTED' : 'STILL OPEN'}</span>
                  <p>{e.label}</p>
                  <div className="chips">
                    {chips.slice(0, 3).map((id) => (
                      <button key={id} aria-pressed={active === id} onClick={() => { setPlaying(false); setActive(id) }}>{chipText(id)}</button>
                    ))}
                  </div>
                  {e.missing.length > 0 && <small>Missing: {e.missing.join(', ')}</small>}
                </li>
              )
            })}
            {!explanations.length && <li className="story-card empty"><p>The investigator lists the possible stories first.</p></li>}
          </ul>
        </div>

        <div className="workspace-bottom">
          <div className="progress-steps" aria-label="Investigation progress">
            <button onClick={() => { setPlaying(false); setAt((a) => Math.max(0, a - 1)) }} disabled={at <= 0} aria-label="Previous step"><b>‹</b></button>
            <span />
            <button className="selected" onClick={() => setStepsOpen((v) => !v)}>
              <b>{Math.max(1, at + 1)}</b> {step ? TOOL[step.tool] ?? step.tool : '…'} <em className="of">of {steps.length} steps · {Math.round(trace.seconds || 0)} s</em>
            </button>
            <span />
            <button onClick={() => { setPlaying(false); setAt((a) => Math.min(steps.length - 1, a + 1)) }} disabled={at >= steps.length - 1} aria-label="Next step"><b>›</b></button>
          </div>
          <button className="text-btn" onClick={() => setStepsOpen((v) => !v)}>{stepsOpen ? 'Hide the steps' : 'See every step ↗'}</button>
        </div>
        {stepsOpen && (
          <ol className="step-list">
            {steps.map((s, i) => (
              <li key={i}><button aria-current={i === at} disabled={i > at && !complete} onClick={() => { setPlaying(false); setAt(i) }}>
                <b>{String(s.n).padStart(2, '0')}</b><span><strong>{TOOL[s.tool] ?? s.tool}</strong> {(s.args.signal as string) ?? ''}{s.why && <em>{s.why}</em>}</span>
              </button></li>
            ))}
          </ol>
        )}

        {complete && status && (
          <div className="finding" id="finding">
            <div>
              <span className="micro">THE FINDING / {which === 'after' ? 'AFTER THE FACTORY’S SUBMISSION' : which === 'live' ? 'LIVE RUN, JUST NOW' : 'SAVED INVESTIGATION'}</span>
              <h3>{STATUS_LABEL[status]}.</h3>
              <p>{final?.summary ?? final?.reason}</p>
              {final?.scope_line && <p className="scope">{final.scope_line}</p>}
              {request && (
                <div className="request-slip">
                  <span className="micro">EVIDENCE REQUESTED</span>
                  <b>{(request.items ?? []).join(', ')}{request.interval ? ` · ${spanText(request.interval)}` : ''}</b>
                  <span>{request.reason}</span>
                </div>
              )}
            </div>
            <div className="finding-actions">
              {caseKey === 'C' && which === 'saved' && <button className="button small" onClick={() => setDialog('factory')}>Add the missing record <span>+</span></button>}
              {caseKey === 'C' && which === 'after' && <button className="text-btn" onClick={async () => { await api.clearSubmission('C'); load('saved') }}>Reset the demo ↺</button>}
              <button className="text-btn" onClick={() => setDialog('review')}>Review the assessment ↗</button>
              {final?.limitations?.length ? <button className="text-btn" onClick={() => setDialog('limits')}>What this can’t show ↗</button> : null}
            </div>
          </div>
        )}
      </div>
      <div className="workspace-note">
        <span><i className="dot" /> Simulated records · Real Muse Spark investigation{trace.model ? ` (${trace.model})` : ''} · {trace.checks_used || steps.length} checks</span>
        <button className="text-btn" onClick={() => onPassport(caseKey)}>View the batch passport ↗</button>
      </div>

      <Dialogs kind={dialog} close={() => setDialog(null)} caseKey={caseKey} status={status} reviews={data.review ?? []}
        limitations={final?.limitations ?? []} onReviewed={() => load(which === 'after' ? 'after' : 'saved')}
        onSubmitted={async () => { setDialog(null); await load('after'); setAt(0); setPlaying(true) }} onPassport={() => onPassport(caseKey)} />
    </section>
  )
}

function DocView({ doc, lit, focused }: { doc: CF['documents'][number]; lit: ReturnType<typeof linesIn>; focused: boolean }) {
  // a tall page shows through a window that keeps the highlighted line in view
  const clip = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(0)
  const firstY = lit[0]?.box.y_min
  useEffect(() => {
    const c = clip.current, inner = c?.firstElementChild as HTMLElement | null
    if (!c || !inner) return
    c.scrollTo({ top: firstY === undefined ? 0 : Math.max(0, (firstY / 1000) * inner.offsetHeight - 110), behavior: 'smooth' })
  }, [firstY, loaded, doc.id])
  if (!doc.image) {
    return (
      <div className="paper">
        <div className="paper-head">{doc.type === 'operator_statement' ? 'OPERATOR STATEMENT' : 'FACTORY SUBMISSION'} <span>{dayHm(wall(doc.received_at)).toUpperCase()}</span></div>
        <p className={`handwriting ${focused ? 'doc-anchor' : ''}`}>“{String((doc.content as { text?: string })?.text ?? '')}”</p>
        <div className="paper-foot">{doc.author.toUpperCase()} <span>A CLAIM, CHECKED AGAINST THE RECORDS</span></div>
      </div>
    )
  }
  return (
    <div className={doc.is_claim ? 'paper photo-paper' : 'instrument'}>
      <div className="paper-head">{docLabel(doc.id).toUpperCase()} <span>{doc.author.toUpperCase()}</span></div>
      <div ref={clip} className={`doc-photo ${focused && !lit.length ? 'doc-anchor' : ''}`}>
        <div className="doc-photo-inner">
          <img src={doc.image} alt={`${docLabel(doc.id)}, ${doc.author}`} onLoad={() => setLoaded((n) => n + 1)} />
          {lit.map((l, i) => (
            <span key={l.index} className={i === 0 ? 'line-box lit-line' : 'line-box'} title={`${l.time} ${l.text}`}
              style={{ left: `${l.box.x_min / 10}%`, top: `${l.box.y_min / 10}%`, width: `${(l.box.x_max - l.box.x_min) / 10}%`, height: `${(l.box.y_max - l.box.y_min) / 10}%` }} />
          ))}
        </div>
      </div>
      <div className="paper-foot">{doc.is_claim ? 'PHONE PHOTO OF THE FACTORY’S RECORD' : 'PHYSICAL RECORD'} <span>{dayHm(wall(doc.covers[0])).toUpperCase()}</span></div>
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
  if (!active) return { title: 'The records', sub: 'Pick a story or a step', value: '' }
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

/** Records a feed cannot fake: meter photos checked against the feed, and lab samples. From the investigation's own results. */
function Measured({ steps, active, onPick }: { steps: Step[]; active: string | null; onPick: (id: string) => void }) {
  const photos = steps.filter((s) => s.tool === 'check_reading_against_feed' && s.result?.reading_given !== undefined)
  const labs = (steps.find((s) => s.tool === 'get_lab_results')?.result?.lab_results as Record<string, unknown>[] | undefined) ?? []
  if (!photos.length && !labs.length) return null
  return (
    <div className="measured">
      <div className="card-caption"><span>MEASURED, NOT WRITTEN / RECORDS A FEED CANNOT FAKE</span></div>
      <div className="measured-cards">
        {photos.map((s) => {
          const r = s.result as Record<string, number | string | boolean>
          const sig = String(r.signal)
          const below = r.reading_vs_expected_band === 'below'
          return (
            <button key={String(r.evidence_id)} className="measured-card" aria-pressed={active === r.evidence_id} onClick={() => onPick(String(r.evidence_id))}
>
              <span className="micro">METER PHOTO · {sig} · {String(r.time).slice(11, 16)}</span>
              <span className="measured-figures">
                <span className={below ? 'is-low' : ''}><b>{String(r.reading_given)}</b><small>the meter shows</small></span>
                <span><b>{String(r.feed_nearest)}</b><small>the digital feed says</small></span>
                {r.expected_kw_from_inflow !== undefined && <span><b>{String(r.expected_kw_from_inflow)}</b><small>what the inflow needs</small></span>}
              </span>
              <span className="measured-note">{r.consistent ? 'The photo matches the feed, so the reading is real, not a meter fault.' : 'The photo disagrees with the feed: the feed is what is wrong.'}
                {below ? ' And it sits below what the plant needs for the water coming in.' : ''}</span>
            </button>
          )
        })}
        {labs.map((l) => {
          const over = Number(l.bod_mg_l) > Number(l.bod_limit_mg_l)
          return (
            <button key={String(l.evidence_id)} className="measured-card" aria-pressed={active === l.evidence_id} onClick={() => onPick(String(l.evidence_id))}>
              <span className="micro">LAB SAMPLE · {String(l.sample_point).toUpperCase()} · {String(l.sample_time).slice(-5)}</span>
              <span className="measured-figures">
                <span className={over ? 'is-low' : ''}><b>{String(l.bod_mg_l)}</b><small>BOD, mg/L</small></span>
                <span><b>{String(l.bod_limit_mg_l)}</b><small>the limit</small></span>
                <span><b>{String(l.ph)}</b><small>pH</small></span>
              </span>
              <span className="measured-note">{over ? 'Above the limit: treatment was not working when this sample was taken.' : 'Within the limit when this sample was taken.'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
