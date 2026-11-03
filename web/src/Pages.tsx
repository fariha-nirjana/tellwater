// The results page.
import { useEffect, useState } from 'react'
import { api } from './api'
import { Stamp } from './CaseFile'
import { Icon } from './Icon'

type S = Record<string, unknown>
const CONDITIONS: [string, string, string][] = [
  ['C1', 'Rules on sensor data', 'What conventional monitoring catches'],
  ['C2', 'Rules + document reading', 'Does reading the paperwork explain the gain?'],
  ['C3', 'Muse Spark, everything at once', 'The model without choosing its evidence'],
  ['C4', 'Muse Spark investigator', 'Choosing one check at a time'],
  ['C5', 'Muse Spark Open investigator', 'The same investigation on open weights'],
]
const TEST_CONDITIONS: [string, string, string][] = [
  ...CONDITIONS,
  ['C6', 'Muse Glimmer investigator', 'Fine-tuned open weights on our own GPU'],
  ['two_readers', 'Two readers', 'C4 and C6; a person decides when they differ'],
]
const n = (s: S | undefined, k: string) => (s?.[k] as number | null | undefined) ?? null

export function Results() {
  const [r, setR] = useState<Record<string, Record<string, S>> | null>(null)
  useEffect(() => { api.results().then(setR) }, [])
  if (!r) return <p className="loading">Loading the results…</p>
  const dev = r.dev ?? {}, test = r.test ?? {}
  const table = (set: Record<string, S>, cols: [string, string, string][]) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th />{cols.map(([id, name, q]) => <th key={id} data-hl={id === 'C4' || undefined}><span className="micro">{id === 'two_readers' ? 'C4 + C6' : id}</span><b>{name}</b><small>{q}</small></th>)}</tr></thead>
        <tbody>
          {rows.map(([label, f]) => <tr key={label}><td>{label}</td>{cols.map(([id]) => <td key={id} data-hl={id === 'C4' || undefined}>{f(set[id])}</td>)}</tr>)}
          {set.two_readers && <tr><td>Sent to a person (readers disagreed)</td>{cols.map(([id]) => <td key={id} data-hl={id === 'C4' || undefined}>{id === 'two_readers' ? `${n(set.two_readers, 'routed_to_a_person')} of ${n(set.two_readers, 'cases')}` : '–'}</td>)}</tr>}
        </tbody>
      </table>
    </div>
  )
  const t4 = test.C4, two = test.two_readers
  const rows: [string, (s: S | undefined) => string][] = [
    ['Agreement with the justified assessment', (s) => (s ? `${n(s, 'agreement')} / ${n(s, 'cases')}` : '–')],
    ['Unsupported accusations', (s) => String(n(s, 'unsupported_accusations') ?? '–')],
    ['Missed problems', (s) => String(n(s, 'missed_problems') ?? '–')],
    ['Held up a clean run', (s) => String(n(s, 'false_escalations') ?? '–')],
    ['Evidence requests naming the right record', (s) => (s && n(s, 'requests_scored') ? `${n(s, 'request_hits')} of ${n(s, 'requests_scored')}` : '–')],
    ['Documents that tried to direct the audit, obeyed', (s) => (s && n(s, 'mean_seconds') ? `${n(s, 'injection_followed')} of ${n(s, 'injection_cases')}` : '–')],
    ['Seconds per case', (s) => (n(s, 'mean_seconds') ? String(Math.round(n(s, 'mean_seconds')!)) : '–')],
  ]
  const scale = ['scale_3', 'scale_14', 'scale_45'].map((k, i) => ({ days: [3, 14, 45][i], c3: n(r[k]?.C3, 'mean_cost'), c4: n(r[k]?.C4, 'mean_cost'), a3: n(r[k]?.C3, 'agreement'), a4: n(r[k]?.C4, 'agreement') }))
  const max = Math.max(...scale.map((s) => Math.max(s.c3 ?? 0, s.c4 ?? 0)), 0.01)
  const glimmer = r.check?.C6
  const right = n(glimmer, 'agreement'), cases = n(glimmer, 'cases'), accusations = n(glimmer, 'unsupported_accusations')
  const valid = n(glimmer, 'valid_share'), seconds = n(glimmer, 'mean_seconds')
  return (
    <main className="results section-pad">
      <div className="section-heading">
        <div><span className="micro">THE EVALUATION</span><h1 className="results-title">How well does it<br /><span className="serif">actually work?</span></h1></div>
        <p>Synthetic results establish prototype performance, not field reliability.<br />First the held-out test: 120 cases from two factories, generated and<br />frozen before any test run. Then the development set that shaped it.</p>
      </div>
      {t4 && (
        <div className="workspace">
          <div className="workspace-top"><div className="batch"><span className="batch-icon"><Icon n="wave" /></span><div><b>The held-out test: {n(t4, 'cases')} cases it had never seen</b><small>TEST SET · FACTORY A AND FACTORY B · RUN ONCE, ON THE FROZEN INVESTIGATOR</small></div></div></div>
          {table(test, TEST_CONDITIONS)}
          <div className="explanation">
            <div className="explanation-copy"><span className="micro">WHAT IT SHOWS</span>
              <p>The investigator (C4) agreed with the justified answer on {n(t4, 'agreement')} of {n(t4, 'cases')}, with {n(t4, 'unsupported_accusations')} unsupported accusations against {n(test.C1, 'unsupported_accusations')} for rules alone. It never cleared a run that broke the rules; the {n(t4, 'missed_problems')} problems it passed were sensor faults a person should have weighed.
                Given everything at once (C3), Muse Spark did as well or slightly better here; the investigator's edge is cost as the records grow (below) and asking for the one missing record.
                {two && ` With Muse Glimmer as a second reader, ${n(two, 'missed_problems')} problems were passed as fine and ${n(two, 'unsupported_accusations')} accusation was unsupported; the price is ${n(two, 'routed_to_a_person')} of ${n(two, 'cases')} cases going to a person.`}</p></div>
          </div>
        </div>
      )}
      <div className="workspace">
        <div className="workspace-top"><div className="batch"><span className="batch-icon"><Icon n="wave" /></span><div><b>Five ways to check the same 60 cases</b><small>DEVELOPMENT SET · FACTORY A · C4 RERUN ON THE FROZEN INVESTIGATOR</small></div></div></div>
        {table(dev, CONDITIONS)}
        <div className="explanation">
          <div className="explanation-copy"><span className="micro">WHAT IT SHOWS</span>
            <p>Reading the paperwork alone barely helps (C2). The gain comes from reasoning over the physical records, and no approach that reasons made an unsupported accusation.</p></div>
        </div>
      </div>

      <div className="scale">
        <div>
          <span className="micro">MORE DAYS OF RECORDS</span>
          <h3>Everything at once gets<br /><em>expensive fast.</em></h3>
          <p>The same 20 scenarios with 3, 14 and 45 days of data. Giving the model everything costs more with every day of records, and by our estimate stops fitting in its context at about 70 days. The investigator reads what it needs.</p>
          <ul>{scale.map((s) => <li key={s.days}>{s.days} days · agreement C3 {s.a3}/20 · C4 {s.a4}/20</li>)}</ul>
        </div>
        <svg viewBox="0 0 420 230" role="img" aria-label="Estimated cost per case by days of records, C3 against C4">
          {scale.map((s, i) => {
            const x = 50 + i * 125, h3 = ((s.c3 ?? 0) / max) * 165, h4 = ((s.c4 ?? 0) / max) * 165
            return (
              <g key={s.days}>
                <rect x={x} y={185 - h3} width={40} height={h3} fill="#ff705b" stroke="#171735" />
                <rect x={x + 46} y={185 - h4} width={40} height={h4} fill="#4945ff" stroke="#171735" />
                <text x={x + 20} y={179 - h3} textAnchor="middle">${s.c3?.toFixed(2)}</text>
                <text x={x + 66} y={179 - h4} textAnchor="middle">${s.c4?.toFixed(2)}</text>
                <text x={x + 43} y={203} textAnchor="middle" className="axis">{s.days} DAYS</text>
              </g>
            )
          })}
          <rect x={50} y={215} width={10} height={8} fill="#ff705b" /><text x={64} y={223}>C3 everything at once</text>
          <rect x={200} y={215} width={10} height={8} fill="#4945ff" /><text x={214} y={223}>C4 investigator · est. cost per case</text>
        </svg>
      </div>

      <div className="fresh">
        <span className="micro">MORE CHECKS · SEPARATE FROM THE HELD-OUT TEST</span>
        <div className="fresh-cards">
          <div className="fresh-card">
            <span className="micro">C6 · MUSE GLIMMER, DISTILLED</span>
            <b>{right ?? '–'} of {cases ?? '–'}</b>
            <p>A small model fine-tuned on Muse Spark's own correct investigations, then run on fresh cases.
              {right !== null && cases !== null && cases > 0 ? ` Right on ${right} of ${cases}.` : ' Fresh-case results are not available yet.'}
              {accusations !== null ? ` ${accusations} unsupported ${accusations === 1 ? 'accusation' : 'accusations'}.` : ' Unsupported accusation count not available.'}
              {valid !== null && ` ${Number((valid * 100).toFixed(1))}% of runs passed validation.`}
              {seconds !== null && ` About ${Math.round(seconds)} s a case.`}</p>
          </div>
          <div className="fresh-card">
            <span className="micro">C4 · A SECOND FACTORY (FACTORY B)</span>
            <b>{n(r.check_b?.C4, 'agreement') ?? '–'} of {n(r.check_b?.C4, 'cases') ?? '–'}</b>
            <p>A differently built plant nothing was tuned on. The first run got 9 of 10: the miss exposed a rule that was too strict for every factory (a stop with a rising tank and a dry outfall did hold its water). After narrowing it, 10 of 10, and the 15 development cases with a stop answered exactly as before.</p>
          </div>
        </div>
      </div>

      {r.localize && (
        <div className="linefind">
          <div>
            <span className="micro">READING THE LOGBOOK · WHERE IS EACH LINE?</span>
            <h3>Square the photo,<br /><em>find the line.</em></h3>
            <p>The case file highlights the logbook line a check is about, so the model has to say where each line is. We measured it on 60 photographed pages ({n(r.localize['spark/dev'], 'lines')} lines) against the renderer’s true positions. Muse Spark places its boxes on a square grid: sent as is, a portrait photo’s boxes land on the wrong line; padded to a square, nearly every line is right.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th><b>Muse Spark</b><small>photo as is</small></th><th data-hl><b>Muse Spark</b><small>padded to a square</small></th><th><b>Muse Spark Open</b><small>padded to a square</small></th></tr></thead>
              <tbody>
                {([['Boxes on the right line', 'right_line'], ['Box overlap of at least half', 'iou_at_0.5'], ['Line text read exactly', 'text_exact']] as const).map(([label, k]) => (
                  <tr key={k}><td>{label}</td>{(['spark/dev', 'spark/dev-square', 'open/dev-square'] as const).map((m) => (
                    <td key={m} data-hl={m === 'spark/dev-square' || undefined}>{n(r.localize[m], k) === null ? '–' : `${(n(r.localize[m], k)! * 100).toFixed(1).replace(/\.0$/, '')}%`}</td>))}</tr>
                ))}
                <tr><td>Seconds per page</td>{(['spark/dev', 'spark/dev-square', 'open/dev-square'] as const).map((m) => <td key={m} data-hl={m === 'spark/dev-square' || undefined}>{n(r.localize[m], 'seconds_per_page')}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="stamp-reference">
        <span className="micro">FOUR POSSIBLE ANSWERS</span>
        <div>{(['supports', 'contradicts', 'review_required', 'insufficient'] as const).map((st) => <Stamp key={st} status={st} />)}</div>
      </div>

      <div className="finding dont-claim">
        <div><span className="micro">WHAT WE DON’T CLAIM</span><h3>Honest about the edges.</h3>
          <p>No compliance certification: an assessment is about one batch and the records it rests on. No inference of intent: missing evidence is not proof of wrongdoing. Synthetic data only. And one tuning case where our labelling rules and the investigator disagree: we kept our rules.</p></div>
      </div>
    </main>
  )
}
