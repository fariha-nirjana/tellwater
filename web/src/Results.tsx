import { useEffect, useState } from 'react'
import { api } from './api'

type S = Record<string, unknown>
const CONDITIONS: [string, string, string][] = [
  ['C1', 'Rules on sensor data', 'What conventional monitoring catches'],
  ['C2', 'Rules plus document reading', 'Does reading the paperwork explain the gain?'],
  ['C3', 'Muse Spark, everything at once', 'The model without choosing its evidence'],
  ['C4', 'Muse Spark investigator', 'Choosing one check at a time'],
  ['C5', 'Muse Spark Open investigator', 'The same investigation on open weights'],
]
const n = (s: S | undefined, k: string) => (s?.[k] as number | null | undefined) ?? null

export function Results() {
  const [r, setR] = useState<Record<string, Record<string, S>> | null>(null)
  useEffect(() => { api.results().then(setR) }, [])
  if (!r) return <p className="p-8 text-mute">Loading results…</p>
  const dev = r.dev ?? {}
  const total = (n(dev.C4, 'problems') ?? 0) + (n(dev.C4, 'supported_cases') ?? 0) + (n(dev.C4, 'insufficient_cases') ?? 0)
  const rows: [string, (s: S | undefined) => string][] = [
    ['Agreement with the justified assessment', (s) => (s ? `${n(s, 'agreement')} / ${total || 60}` : '–')],
    ['Unsupported accusations', (s) => String(n(s, 'unsupported_accusations') ?? '–')],
    ['Missed problems', (s) => String(n(s, 'missed_problems') ?? '–')],
    ['Evidence requests naming the right record', (s) => (s && n(s, 'requests_scored') ? `${n(s, 'request_hits')} of ${n(s, 'requests_scored')}` : '–')],
    ['Documents that tried to direct the audit, obeyed', (s) => (s && n(s, 'mean_seconds') ? `${n(s, 'injection_followed')} of ${n(s, 'injection_cases')}` : '–')],
    ['Seconds per case', (s) => (n(s, 'mean_seconds') ? String(Math.round(n(s, 'mean_seconds')!)) : '–')],
  ]
  const scale = ['scale_3', 'scale_14', 'scale_45'].map((k, i) => ({ days: [3, 14, 45][i], c3: n(r[k]?.C3, 'mean_cost'), c4: n(r[k]?.C4, 'mean_cost'), a3: n(r[k]?.C3, 'agreement'), a4: n(r[k]?.C4, 'agreement') }))
  const max = Math.max(...scale.map((s) => Math.max(s.c3 ?? 0, s.c4 ?? 0)), 0.01)

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <p className="micro text-mute">Evaluation</p>
      <h1 className="mt-1 text-4xl font-extrabold">How well does it <span className="serif-em text-indigo">work?</span></h1>
      <p className="mt-2 max-w-2xl text-ink/80">Synthetic results establish prototype performance, not field reliability. Development set below; the held-out test set (120 cases, two factories, frozen before any test run) is pending.</p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink text-left">
              <th className="py-2 pr-4 font-normal text-mute">60 development cases</th>
              {CONDITIONS.map(([id, name, q]) => (
                <th key={id} className="px-3 py-2 align-bottom">
                  <span className="micro text-indigo">{id}</span><br /><span className="font-display font-bold">{name}</span><br /><span className="text-xs font-normal text-mute">{q}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label} className="border-b border-rule">
                <td className="py-2 pr-4 text-ink/80">{label}</td>
                {CONDITIONS.map(([id]) => <td key={id} className={`px-3 py-2 font-semibold ${id === 'C4' ? 'bg-indigo-soft' : ''}`}>{f(dev[id])}</td>)}
              </tr>
            ))}
            <tr><td className="py-2 pr-4 text-ink/80">Held-out test set</td>{CONDITIONS.map(([id]) => <td key={id} className="px-3 py-2 text-mute">pending</td>)}</tr>
          </tbody>
        </table>
      </div>

      <section className="mt-12 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-extrabold">More days of records</h2>
          <p className="mt-2 text-ink/80">The same 20 scenarios with 3, 14 and 45 days of data. Giving the model everything at once costs more with every day of records and stops fitting in its context at about 70 days. The investigator reads what it needs.</p>
          <ul className="mt-4 text-sm text-ink/80">
            {scale.map((s) => <li key={s.days}>{s.days} days · agreement C3 {s.a3}/20, C4 {s.a4}/20</li>)}
          </ul>
        </div>
        <svg viewBox="0 0 420 220" className="w-full" role="img" aria-label="Estimated cost per case by days of records, C3 against C4">
          {scale.map((s, i) => {
            const x = 60 + i * 120
            const h3 = ((s.c3 ?? 0) / max) * 160, h4 = ((s.c4 ?? 0) / max) * 160
            return (
              <g key={s.days}>
                <rect x={x} y={180 - h3} width={36} height={h3} fill="#ff705b" />
                <rect x={x + 40} y={180 - h4} width={36} height={h4} fill="#4945ff" />
                <text x={x + 18} y={175 - h3} fontSize={10} textAnchor="middle">${s.c3?.toFixed(2)}</text>
                <text x={x + 58} y={175 - h4} fontSize={10} textAnchor="middle">${s.c4?.toFixed(2)}</text>
                <text x={x + 38} y={198} fontSize={11} textAnchor="middle">{s.days} days</text>
              </g>
            )
          })}
          <rect x={60} y={208} width={10} height={8} fill="#ff705b" /><text x={74} y={216} fontSize={10}>C3 everything at once</text>
          <rect x={210} y={208} width={10} height={8} fill="#4945ff" /><text x={224} y={216} fontSize={10}>C4 investigator (estimated cost per case, list price)</text>
        </svg>
      </section>

      <section className="mt-12 rounded-2xl bg-ink p-6 text-white">
        <h2 className="text-2xl font-extrabold">What we don’t claim</h2>
        <ul className="mt-3 list-disc pl-5 text-white/85">
          <li>No compliance certification. An assessment is about one batch and the records it rests on.</li>
          <li>No inference of intent. Missing evidence is not proof of wrongdoing.</li>
          <li>Synthetic data only: these numbers show the prototype works on simulated factories, not real ones.</li>
          <li>One tuning case where our labelling rules and the investigator disagree. We kept our rules.</li>
        </ul>
      </section>
    </main>
  )
}
