import { SHADE } from './Garments'
// The case file, the buyer's reviewer's workspace, on real engine output. It fits the window: a top row (the batch, its
// status stamp, the cases, the human decision), the desk where the companion tells the finding or the replay step by step,
// and three panels that scroll inside themselves: documents threaded to the signals (with the gap in the story or the
// evidence request), and the explanations board.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, STATUS_LABEL, type Allowance, type CaseFile as CF, type CaseKey, type Explanation, type ViewKey, type Series, type Status, type Step, type Trace, type CatalogBatch } from './api'
import { setMood, setStepLine, toolMood, type Mood } from './companion'
import { Dialogs, type DialogKind } from './Dialogs'
import { Guide } from './Guide'
import { CALC_SIGNALS, dayHm, docLabel, hm, parseEvidence, wall, type Target } from './evidence'
import { ORDER, Timeline } from './Timeline'
import { Icon } from './Icon'

// the buyer's suppliers and their dye runs: factory A's three, a second supplier's two. Each is named for what drew a
// look (the alert or the claim), never for the answer
const SUPPLIERS: [string, CaseKey[]][] = [['Factory A', ['A', 'B', 'C']], ['Factory B', ['D', 'E']]]
const SCENARIO: Record<CaseKey, string> = {
  A: 'Planned ETP stop', B: 'Aerator service, low power', C: 'ETP stop, tank log missing', D: 'High pH at the outfall', E: 'Extra water at the outfall',
}
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
const STAMP: Record<Status, [number, ReactNode]> = { supports: [0, <Icon n="ne" />], contradicts: [1, '!'], review_required: [2, <Icon n="redo" />], insufficient: [3, '?'] }
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
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const [live, setLive] = useState<'idle' | 'running' | 'error' | 'limited'>('idle')
  const [liveError, setLiveError] = useState('')
  const [runs, setRuns] = useState<Allowance | null>(null)
  const refreshRuns = useCallback(() => { api.limits().then((l) => setRuns(l.runs)).catch(() => setRuns(null)) }, [])
  useEffect(refreshRuns, [refreshRuns])
  const [guideOpen, setGuideOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogBatch[]>([])
  useEffect(() => { api.catalog().then(setCatalog).catch(() => setCatalog([])) }, [])
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
  }, [src])
  // a case whose factory already answered opens on the investigation after the answer
  useEffect(() => {
    abort.current?.abort(); setLive('idle'); setData(null)
    api.case(src).then(async (c) => {
      await load(c.submission ? 'after' : 'saved')
      // the factory just sent the record on its own page: the buyer's side watches the investigation run again with it
      let replay = false
      try { replay = !!c.submission && sessionStorage.getItem('tw:replay-after') === src; if (replay) sessionStorage.removeItem('tw:replay-after') } catch { /* private window */ }
      if (replay) { setAt(0); setPhase('reason'); setPlaying(true) }
    })
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
    if (complete && !playing && final?.key_evidence?.length) setActive((a) => a ?? final.key_evidence![0].id)
  }, [complete, playing, final])

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
  // the corner card follows the replay once the desk is scrolled away
  useEffect(() => setStepLine(watching && step ? { label: `Step ${at + 1} of ${stepCount} · ${TOOL[step.tool] ?? step.tool}`, line: step.why ?? '' } : null), [watching, step, at, stepCount])
  useEffect(() => () => setStepLine(null), [])

  const follow = (id: string) => { setPlaying(false); setPhase('result'); setActive(id) }
  const enlargedDoc = data?.documents.find((d) => d.id === enlarged)
  // the steps list keeps the step being shown in view
  const stepsBox = useRef<HTMLOListElement>(null)
  useEffect(() => { stepsBox.current?.querySelector('[aria-current=step]')?.scrollIntoView({ block: 'nearest' }) }, [at])

  if (!data || !trace || !series) return <section className="case-view"><p className="loading">Opening the case file…</p></section>

  const ov = data.overview
  const ti = ov.treatment_interval
  const factory = `Factory ${data.overview.case_id.split('-')[1]?.toUpperCase() ?? ''}`
  const keyIds = (final?.key_evidence ?? []).map((k) => k.id)
  const claims = data.documents.filter((d) => d.type === 'maintenance_record').map((d) => ({ start: wall(d.covers[0]), end: wall(d.covers[1]) }))
  const status = live === 'running' ? null : (trace.status as Status | null)
  const request = final?.kind === 'evidence_request' ? final : typeof final?.evidence_request === 'object' ? final?.evidence_request : null
  const atRest = complete && !playing
  const supplier = SUPPLIERS.find(([, keys]) => keys.includes(caseKey))![0]
  const reviews = data.review ?? []
  const lastReview = reviews.at(-1)
  // the API pairs the second reading with the saved investigation or its replay, never a fresh live run
  const secondReader = which !== 'live' ? data.second_reader : null
  const readersDisagree = secondReader?.agrees === false
  const needsPerson = live !== 'running' && data.awaiting_person
  // the gap in the story: what the maintenance record claims against how long power really stayed low
  const lowPower = keyIds.map((id) => parseEvidence(id)).find((e) => e.label?.toLowerCase().includes('power') && e.start && e.end)
  const gap = status === 'contradicts' && claims[0] && lowPower?.end && lowPower.end.getTime() > claims[0].end.getTime() + 30 * 60_000
    ? { claim: claims[0], low: lowPower } : null
  const physicalId = steps.find((s) => s.tool === 'check_reading_against_feed')?.result?.evidence_id as string | undefined

  // what the middle shows: at rest the record behind the line picked; during the investigation the record each step is about
  const focus: Focus = atRest || !step ? (live === 'running' ? { kind: 'opening' } : focusOf(active ?? keyIds[0] ?? 'all', steps))
    : focusOfStep(step, steps)
  const full: [Date, Date] = [new Date(wall(ti.start).getTime() - 2 * 3600_000), wall(ti.end)]
  const caption = captionOf(focus, data.documents)
  const sayLabel = !step && live === 'running' ? 'LIVE RUN · MUSE SPARK'
    : atRest ? `THE FINDING${which === 'after' ? ' · AFTER THE FACTORY’S RECORD' : which === 'live' ? ' · LIVE RUN' : ''}`
    : phase === 'reason' && watching ? <><i className="pulse" />NEXT · {(NEXT[step!.tool] ?? step!.tool).toUpperCase()}</>
    : 'MUSE SPARK’S REASON'
  const sayText = atRest ? 'Tap a line of the finding to see the record behind it, or watch how I got here.'
    : step?.why ?? (step?.tool === 'update_hypotheses' ? 'Updating the explanations it keeps open.' : step?.tool === 'submit_assessment' ? 'Giving the assessment.' : live === 'running' ? 'Opening the case…' : '')

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

  return (
    <section className="case-view case-stage">
      <header className="case-header">
        <div className="case-identity">
          <span className="micro">{factory} (demo) · {SHADE[ov.batch.shade]?.name ?? ov.batch.shade}</span>
          <h1>Batch {ov.batch.id.split('-').at(-1)}</h1>
        </div>
        {status ? secondReader || needsPerson ? (
          <div className="case-readers-status" data-pending={needsPerson || undefined}>
            <Stamp status={needsPerson ? 'review_required' : status} label={needsPerson ? 'Needs a person · the two readers disagree' : undefined} />
            {secondReader?.agrees && <small>Second reader agrees · Muse Glimmer, an open model that can run at the factory</small>}
          </div>
        ) : <Stamp status={status} /> : <span className="stamp stamp-working"><span className="stamp-mark"><i className="pulse" /></span><span>Investigating · step {Math.max(1, at + 1)}</span></span>}
        <div className="case-pick">
          {/* two tiles: the supplier, then one of its dye runs */}
          <Picker label="FACTORY" value={supplier} options={SUPPLIERS.map(([name, keys]) => ({ value: name, title: `${name} (demo)`, sub: `${keys.length} dye runs checked` }))}
            onPick={(name) => { location.hash = `#/case/${SUPPLIERS.find(([n]) => n === name)![1][0]}` }} />
          <Picker label="CASE" value={caseKey} options={SUPPLIERS.find(([n]) => n === supplier)![1].map((k) => {
            const b = catalog.find((c) => c.key === k)?.batch
            return { value: k, title: SCENARIO[k], sub: b ? `Run ${b.id.split('-').at(-1)} · ${SHADE[b.shade]?.name ?? b.shade}` : '' }
          })} onPick={(k) => { location.hash = `#/case/${k}` }} />
        </div>
        {data.bangla_view && (
          <div className="logbook-language" role="group" aria-label="Language of the logbook pages">
            <span className="micro">LOGBOOK IN</span>
            <button aria-pressed={!bangla} onClick={() => { location.hash = `#/case/${caseKey}` }}>English</button>
            <button aria-pressed={bangla} lang="bn" onClick={() => { location.hash = `#/case/${caseKey}/bn` }}>বাংলা</button>
          </div>
        )}
        <div className="case-decision">
          <small>{lastReview ? `${lastReview.action === 'change' && lastReview.status ? `Changed to ${STATUS_LABEL[lastReview.status]}` : lastReview.action === 'approve' ? 'Approved' : 'Sent back'} · “${lastReview.reason}”` : needsPerson ? 'Waiting for a person: the readers disagree' : 'Ready for a reviewer'}</small>
          {bangla ? <a className="button ink small" href={`#/case/${caseKey}`}><span className="btn-words">Review on the English case <Icon n="ne" /></span></a>
            : <button className="button acid small" disabled={!status} onClick={() => setDialog('review')}><span className="btn-words">Review assessment <Icon n="ne" /></span></button>}
        </div>
      </header>

      <div className="stage">
        <section className="stage-col stage-left">
          {atRest ? (
            <>
              <h2>The finding, line by line</h2>
              <div className="finding-lines">
                {(final?.key_evidence ?? []).slice(0, 6).map((k) => (
                  <button key={k.id} aria-pressed={active === k.id} onClick={() => follow(k.id)}>{k.why} <span><Icon n="ne" /></span></button>
                ))}
              </div>
              <h3>The records</h3>
              <div className="record-thumbs">
                {data.documents.map((d) => (
                  <button key={d.id} aria-pressed={active === d.id} className={d.is_claim ? '' : 'physical'} onClick={() => follow(d.id)} title={docLabel(d.id)}>
                    {d.image ? <img src={d.image} alt="" /> : <span className="text-thumb">Aa</span>}<span>{docLabel(d.id)}</span>
                  </button>
                ))}
                <button aria-pressed={active === 'all'} onClick={() => follow('all')}><span className="text-thumb"><Icon n="wave" /></span><span>Every meter</span></button>
              </div>
            </>
          ) : (
            <>
              <h2>The steps</h2>
              <ol className="stage-steps" ref={stepsBox}>
                {steps.map((s, i) => (
                  <li key={i}><button aria-current={i === at ? 'step' : undefined} data-done={i < at || undefined} disabled={i > at && (playing || live === 'running')}
                    onClick={() => { setPlaying(false); setPhase('result'); setAt(i) }}>
                    <i>{s.n}</i>{i === at && phase === 'reason' && watching ? NEXT[s.tool] ?? s.tool : TOOL[s.tool] ?? s.tool}</button></li>
                ))}
                {thinking && <li className="thinking"><i className="pulse" />choosing the next check…</li>}
              </ol>
            </>
          )}
          <div className="stage-play">
            <button className="button ink small" onClick={() => { if (playing) return setPlaying(false); if (atRest || at >= steps.length - 1) { setAt(0); setPhase('reason') } setPlaying(true) }} disabled={live === 'running'}>
              {playing ? <>Pause <span><Icon n="pause" /></span></> : atRest ? <>Watch the investigation <span><Icon n="play" /></span></> : <>Play <span><Icon n="play" /></span></>}
            </button>
            {!atRest && <>
              <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.max(0, at)} aria-label="Scrub the investigation's steps"
                onChange={(e) => { setPlaying(false); setPhase('result'); setAt(Number(e.target.value)) }} />
              <small>{Math.max(1, at + 1)} / {steps.length}</small>
            </>}
            {!atRest && live !== 'running' && <button className="text-btn" onClick={() => { setPlaying(false); setPhase('result'); setAt(steps.length - 1) }}>The finding <Icon n="ne" /></button>}
            {atRest && !bangla && (
              <div className="stage-live">
                <button className="text-btn" onClick={runLive} disabled={runs?.left === 0}>
                  {runs && !runs.live ? 'Live runs are off in this demo' : runs?.left === 0 ? 'Live runs used up for today' : <>Run it live with Muse Spark <Icon n="ne" /></>}
                </button>
                {runs?.live && runs.left > 0 && <small>{runs.left} of {runs.per_visitor} left today</small>}
              </div>
            )}
            {atRest && bangla && <small>The investigation Muse Spark ran on the Bangla pages.</small>}
          </div>
        </section>

        <section className="stage-center">
          <div className="stage-head">
            <span className="micro">{atRest ? 'THE FINDING' : step ? `STEP ${step.n} · ${(TOOL[step.tool] ?? step.tool).toUpperCase()}` : 'LIVE RUN'}</span>
            {atRest
              ? <div className="stage-links"><button onClick={() => setDialog('limits')}>What this can’t show <Icon n="ne" /></button><button onClick={() => setDialog('qr')}>Batch passport <Icon n="qr" /></button>{!bangla && <a href={`#/report/${caseKey}`}>Audit report <Icon n="ne" /></a>}</div>
              : <small>{caption}</small>}
          </div>
          <div className="stage-view">
            {live === 'error' && <p className="live-error">The live run stopped: {liveError}</p>}
            {live === 'limited' && <p className="live-error live-note">{liveError}</p>}
            {atRest && (
              <>
                {gap && (
                  <section className="contradiction-ribbon">
                    <div><span className="micro">THE GAP IN THE STORY</span>
                      <p>Logged service <b>{hm(gap.claim.start)}–{hm(gap.claim.end)}</b><span><Icon n="right" /></span>Low power <b>{hm(gap.low.start!)}–{hm(gap.low.end!)}</b></p></div>
                    {physicalId && <button onClick={() => follow(physicalId)}>Follow the physical evidence <Icon n="ne" /></button>}
                  </section>
                )}
                {readersDisagree && secondReader && (
                  <section className="reader-slip" aria-label="The two readings">
                    <span className="reader-icon" aria-hidden="true"><Icon n="swap" /></span>
                    <div><span className="micro">TWO READERS, TWO ANSWERS</span>
                      <p><b>Muse Spark</b> (cloud): {STATUS_LABEL[status!]}.</p>
                      <p><b>Muse Glimmer</b> (open model, can run at the factory): {STATUS_LABEL[secondReader.status]}. “{secondReader.summary}”</p>
                      <small>{needsPerson ? 'Neither answer is used until you decide. Nothing is published to the batch passport before then.' : 'A person has reviewed the readings. The latest decision is recorded above.'}</small></div>
                    {bangla ? <a className="button acid small" href={`#/case/${caseKey}`}><span className="btn-words">Review both <Icon n="ne" /></span></a> : <button className="button acid small" onClick={() => setDialog('review')}><span className="btn-words">Review both <Icon n="ne" /></span></button>}
                  </section>
                )}
                {request && (which === 'saved' || which === 'live') && (
                  <section className="request-slip">
                    <span className="request-icon">?</span>
                    <div><span className="micro">A GAP, NOT A VERDICT</span>
                      <p>Requested: {(request.items ?? []).join(', ')}{request.interval ? `, ${spanText(request.interval)}` : ''}. Why: {request.reason}</p>
                      {!bangla && which === 'saved' && <small className="request-wait">Waiting for the factory’s record · <a href="#/factory">See the factory’s side <Icon n="ne" /></a></small>}</div>
                    <div className="request-actions"><button className="text-btn" onClick={() => setDialog('letter')}>Draft it for the factory <Icon n="ne" /></button></div>
                  </section>
                )}
                {which === 'after' && data.submission && (
                  <section className="request-slip received">
                    <span className="request-icon"><Icon n="ne" /></span>
                    <div><span className="micro">RECORD RECEIVED</span>
                      <p>{data.submission.file} · {spanText([wall(data.submission.covers[0]), wall(data.submission.covers[1])])}. Investigated again with the factory’s record; it still counts as the factory’s word until it agrees with the other signals.</p>
                      {data.submission.note && <small>Factory note: {data.submission.note}</small>}</div>
                    <button className="button ink small" onClick={async () => { await api.clearSubmission(caseKey); load('saved') }}><span className="btn-words">Reset the demo <Icon n="undo" /></span></button>
                  </section>
                )}
                {data.replies.length > 0 && (
                  <section className="factory-reply">
                    <span className="micro">THE FACTORY’S REPLY · {dayHm(wall(data.replies.at(-1)!.at)).toUpperCase()}</span>
                    <p>“{data.replies.at(-1)!.note}”</p>
                    <small>The factory’s word. It doesn’t change the finding.</small>
                  </section>
                )}
                <p className="stage-summary">{final?.summary ?? final?.reason}</p>
                <small className="stage-caption">{caption}</small>
              </>
            )}
            <FocusView compact={atRest} focus={focus} steps={steps} data={data} series={series} full={full} claims={claims} explanations={explanations}
              final={final ?? null} request={request} onPick={follow} onEnlarge={setEnlarged} />
          </div>
          <div className="stage-say">
            <div id="caseDock" className="desk-perch" aria-hidden="true" />
            <div><span className="micro">{sayLabel}</span><p aria-live="polite">{sayText}</p></div>
            <button className="text-btn" onClick={() => setGuideOpen(true)}>Explain this simply <Icon n="ne" /></button>
          </div>
        </section>

        <section className="stage-col stage-right">
          <h2>What explains it?</h2>
          <div className="stage-board">
            {explanations.map((e) => {
              const state = e.status === 'contradicted' ? 'ruled out' : e.status === 'supported' ? 'supported' : 'open'
              const chips = e.status === 'contradicted' ? e.contradicting : e.supporting.length ? e.supporting : e.contradicting
              return (
                <article key={e.id} className={`explanation-card ${state.replace(' ', '-')}`}>
                  <span className="explanation-state">{state === 'supported' ? <Icon n="ne" /> : state === 'ruled out' ? <Icon n="minus" /> : <Icon n="circle" />} {state}</span>
                  <h3>{e.label}</h3>
                  {atRest && (
                    <div className="evidence-chips">
                      {chips.slice(0, 3).map((id) => <button key={id} aria-pressed={active === id} onClick={() => follow(id)}>{chipText(id)} <Icon n="ne" /></button>)}
                      {e.missing.length > 0 && <span>Missing: {e.missing.map(chipText).join(', ')}</span>}
                    </div>
                  )}
                </article>
              )
            })}
            {!explanations.length && <p className="board-empty">The investigator lists the possible explanations first.</p>}
          </div>
          <p className="board-note">{atRest ? 'Ruled-out explanations stay visible. Each chip shows the record behind the decision.' : 'Ruled in or out each time the investigator updates them.'}</p>
        </section>
      </div>

      {enlargedDoc?.image && <Enlarged doc={enlargedDoc} caseKey={caseKey} close={() => setEnlarged(null)} />}
      <Guide caseKey={src} focus={active === 'all' ? null : active} open={guideOpen} onClose={() => setGuideOpen(false)} onCite={follow} />
      <Dialogs kind={dialog} close={() => setDialog(null)} caseKey={caseKey} status={status} reviews={reviews}
        limitations={final?.limitations ?? []} onReviewed={() => load(which === 'after' ? 'after' : 'saved')}
        onPassport={() => { location.hash = `#/passport/${caseKey}` }} />
    </section>
  )
}

type Focus =
  | { kind: 'doc'; id: string; window?: [Date, Date] } | { kind: 'photo'; id: string } | { kind: 'lab' }
  | { kind: 'chart'; target: Target; title?: string } | { kind: 'all' } | { kind: 'stories' } | { kind: 'production'; result: Record<string, unknown> }
  | { kind: 'finding' } | { kind: 'request' } | { kind: 'opening' }

/** The record behind an evidence id, picked at rest (a line of the finding, a chip, a document). */
function focusOf(id: string, steps: Step[]): Focus {
  if (id === 'all') return { kind: 'all' }
  if (id.includes('reading_vs_feed')) return { kind: 'photo', id }
  if (id.startsWith('doc:lab') && steps.some((s) => s.tool === 'get_lab_results')) return { kind: 'lab' }
  if (id.startsWith('doc:')) return { kind: 'doc', id }
  if (id.startsWith('plan:')) {
    const r = steps.find((s) => s.result?.evidence_id === id)?.result
    if (r) return { kind: 'production', result: r }
  }
  const t = parseEvidence(id)
  return t.signals.length ? { kind: 'chart', target: t } : { kind: 'all' }
}

/** The record a step of the investigation is about, from what it asked for (shown before its result arrives too). */
function focusOfStep(s: Step, steps: Step[]): Focus {
  const a = s.args as Record<string, string>
  const id = s.result?.evidence_id as string | undefined
  switch (s.tool) {
    case 'get_case_overview': return { kind: 'all' }
    case 'update_hypotheses': return { kind: 'stories' }
    case 'submit_assessment': return { kind: 'finding' }
    case 'request_evidence': return { kind: 'request' }
    case 'get_lab_results': return { kind: 'lab' }
    case 'read_document': return a.doc_id?.includes('lab') && steps.some((x) => x.tool === 'get_lab_results') ? { kind: 'doc', id: a.doc_id } : { kind: 'doc', id: a.doc_id }
    case 'get_production': return s.result && !s.result.error ? { kind: 'production', result: s.result } : { kind: 'all' }
    case 'check_reading_against_feed': if (id) return { kind: 'photo', id }
  }
  if (id && !id.startsWith('doc:')) return focusOf(id, steps)
  // before the result (or a check refused by the budget): the window it asked about
  const signals = a.signal ? [a.signal] : CALC_SIGNALS[s.tool.replace(/^(check_|compute_)/, '')] ?? []
  if (!signals.length || !a.start) return { kind: 'all' }
  return { kind: 'chart', target: { kind: 'signal', id: '', signals, start: wall(a.start), end: wall(a.end ?? a.start), label: signals[0] } }
}

function captionOf(f: Focus, docs: CF['documents']): string {
  if (f.kind === 'doc') { const d = docs.find((x) => x.id === f.id); return d ? `${docLabel(d.id)} · ${d.is_claim ? 'the factory’s own record' : 'physical record'}` : '' }
  if (f.kind === 'photo') { const t = parseEvidence(f.id); return `Meter photo ${t.signals[0] ?? ''} against the feed${t.start ? ` · ${dayHm(t.start)}` : ''}` }
  if (f.kind === 'chart') return `${f.target.signals.join(', ')}${f.target.start && f.target.end ? ` · ${spanText([f.target.start, f.target.end])}` : ''}`
  if (f.kind === 'all') return 'Every meter over the treatment interval'
  if (f.kind === 'lab') return 'Lab results'
  if (f.kind === 'production') return 'The factory’s production plan'
  return ''
}

type FocusProps = {
  compact?: boolean
  focus: Focus; steps: Step[]; data: CF; series: Series; full: [Date, Date]; claims: { start: Date; end: Date }[]; explanations: Explanation[]
  final: Trace['final']; request: { items?: string[]; interval?: string | [string, string]; reason?: string } | null | undefined
  onPick: (id: string) => void; onEnlarge: (id: string) => void
}

/** One record, large: a document, a meter photo against its feed, the lab result, or the meters over the window in question. */
function FocusView({ compact, focus, steps, data, series, full, claims, explanations, final, request, onPick, onEnlarge }: FocusProps) {
  if (focus.kind === 'opening') return <p className="stage-empty">Opening the case…</p>
  if (focus.kind === 'doc') {
    const d = data.documents.find((x) => x.id === focus.id)
    return d ? <DocView doc={d} lit={[]} focused={false} onEnlarge={() => onEnlarge(d.id)} /> : null
  }
  if (focus.kind === 'photo') return <Physical steps={steps} documents={data.documents} only={focus.id} onPick={onPick} />
  if (focus.kind === 'lab') {
    // the lab report itself beside what it measured
    const page = data.documents.find((d) => d.type === 'lab_report' && d.image)
    return (
      <div className="stage-lab">
        {page && <button onClick={() => onEnlarge(page.id)}><img src={page.image!} alt="The lab report" /></button>}
        <Physical steps={steps} documents={data.documents} only="lab" onPick={onPick} />
      </div>
    )
  }
  if (focus.kind === 'stories') return (
    <div className="stage-stories">{explanations.map((e) => <div key={e.id} className={`explanation-card ${e.status === 'contradicted' ? 'ruled-out' : e.status === 'supported' ? 'supported' : 'open'}`}><h3>{e.label}</h3></div>)}</div>
  )
  if (focus.kind === 'production') {
    const batches = (focus.result.batches as { id: string; start: string; end: string; shade: string; planned_wastewater_m3: number }[] | undefined) ?? []
    return (
      <table className="stage-table"><thead><tr><th>Dye run</th><th>Time</th><th>Shade</th><th>Planned water</th></tr></thead>
        <tbody>{batches.map((b) => <tr key={b.id}><td>{b.id.split('-').at(-1)}</td><td>{dayHm(wall(b.start))}–{hm(wall(b.end))}</td><td>{b.shade}</td><td>{Math.round(b.planned_wastewater_m3)} m³</td></tr>)}</tbody></table>
    )
  }
  if (focus.kind === 'finding') return <div className="stage-finding"><p>{final?.summary ?? final?.reason}</p></div>
  if (focus.kind === 'request') return request ? <p className="stage-finding">Requested: {(request.items ?? []).join(', ')}. {request.reason}</p> : null
  if (focus.kind === 'all') return <div className="chart stacked"><Timeline series={series} info={data.signals} shown={ORDER} range={full} highlight={null} bands={claims} /></div>
  const t = focus.target
  const pad = 2 * 3600_000
  const range: [Date, Date] = t.start && t.end
    ? [new Date(Math.max(full[0].getTime(), t.start.getTime() - pad)), new Date(Math.min(full[1].getTime(), t.end.getTime() + pad))] : full
  const shown = ORDER.filter((s) => t.signals.includes(s))
  const headline = headlineFor(t.id, steps)
  return (
    <div className="stage-chart">
      {headline.value && <div className="chart-label"><div><b>{headline.title}</b><small>{headline.sub}</small></div><span>{headline.value}</span></div>}
      <div className="chart stacked">
        <Timeline series={series} info={data.signals} shown={shown.length ? shown : ORDER} range={range} highlight={t} bands={claims} focusRow={compact ? (shown.length <= 1 ? 140 : 80) : shown.length <= 1 ? 230 : shown.length === 2 ? 150 : 90} />
      </div>
      <div className="timeline-key">
        <span><i className="evidence-band" />The stretch being checked</span>
        {claims.length > 0 && <span><i className="claim-band" />What the maintenance record claims</span>}
        {shown.includes('S3') && <span><i className="need-band" />Power the plant needs for its inflow</span>}
      </div>
    </div>
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
      <div className="doc-caption"><span>{caption}</span>{doc.image && <button onClick={onEnlarge}>Enlarge <Icon n="ne" /></button>}</div>
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

/** The physical cross-check, one record of it: a meter photo checked against the feed, or the lab samples. From the investigation's own results. */
function Physical({ steps, documents, only, onPick }: { steps: Step[]; documents: CF['documents']; only: string; onPick: (id: string) => void }) {
  const photos = only === 'lab' ? [] : steps.filter((s) => s.tool === 'check_reading_against_feed' && s.result?.reading_given !== undefined && s.result.evidence_id === only)
  const labs = only !== 'lab' ? [] : (steps.find((s) => s.tool === 'get_lab_results')?.result?.lab_results as Record<string, unknown>[] | undefined) ?? []
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
              <button onClick={() => onPick(String(r.evidence_id))}>{img && <img src={img} alt={`Meter photo reading ${r.reading_given} at ${time}`} />}</button>
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
          <button key={String(l.evidence_id)} className="lab-moment" onClick={() => onPick(String(l.evidence_id))}>
            <span>{String(l.sample_point).toUpperCase()} · {String(l.sample_time).slice(-5)}</span>
            <strong>BOD {String(l.bod_mg_l)} <small>mg/L</small></strong>
            <span>Limit {String(l.bod_limit_mg_l)} mg/L · pH {String(l.ph)} <b>{over ? 'Above the limit' : 'Within the limit'} <Icon n="ne" /></b></span>
          </button>
        )
      })}
    </div>
  )
}

/** A tile that shows the current choice and opens its list when tapped. */
function Picker({ label, value, options, onPick }: { label: string; value: string; options: { value: string; title: string; sub: string }[]; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('mousedown', away); addEventListener('keydown', esc)
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc) }
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div className="picker" ref={box}>
      <button className="picker-tile" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="micro">{label}</span><b>{current?.title}</b><small>{current?.sub}</small><i aria-hidden="true"><Icon n="chevron" /></i>
      </button>
      {open && (
        <ul className="picker-list" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button onClick={() => { setOpen(false); if (o.value !== value) onPick(o.value) }}><b>{o.title}</b><small>{o.sub}</small></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
