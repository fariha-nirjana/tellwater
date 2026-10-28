import { useEffect, useState } from 'react'
import { api, type CaseKey, type Status } from './api'
import { CaseFile } from './CaseFile'
import { Passport } from './Passport'
import { Results } from './Results'
import { Stamp } from './ui'

// Hash routes: #/  #/case/A  #/passport/A  #/results
function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const on = () => { setHash(location.hash || '#/'); window.scrollTo(0, 0) }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return [hash, (h: string) => { location.hash = h }] as const
}

export function App() {
  const [hash, go] = useRoute()
  const kase = hash.match(/^#\/case\/([ABC])$/)?.[1] as CaseKey | undefined
  const passport = hash.match(/^#\/passport\/([ABC])$/)?.[1] as CaseKey | undefined
  if (passport) return <Passport caseKey={passport} go={go} />
  return (
    <>
      <Header go={go} />
      {kase ? <CaseFile key={kase} caseKey={kase} go={go} /> : hash === '#/results' ? <Results /> : <Landing go={go} />}
    </>
  )
}

function Header({ go }: { go: (h: string) => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-6 border-b border-ink bg-paper px-4 sm:px-8">
      <button onClick={() => go('#/')} className="flex items-center gap-1.5 font-display text-2xl font-extrabold tracking-tight">
        <svg viewBox="0 0 40 20" className="h-5 w-8" fill="none" stroke="#4945ff" strokeWidth={3.5} aria-hidden="true"><path d="M2 10c6-8 10 8 16 0s10 8 20 0" /></svg>
        tellwater
      </button>
      <nav className="flex gap-4 text-sm">
        <button onClick={() => go('#/case/B')}>Case files</button>
        <button onClick={() => go('#/results')}>Results</button>
      </nav>
      <span className="micro ml-auto hidden text-mute sm:inline">Prototype · simulated records</span>
    </header>
  )
}

/** Placeholder landing until iteration 02's hero is ported. */
function Landing({ go }: { go: (h: string) => void }) {
  const [cases, setCases] = useState<{ key: CaseKey; status: Status; summary: string }[]>([])
  useEffect(() => { api.cases().then(setCases) }, [])
  return (
    <main>
      <section className="bg-indigo px-4 py-16 text-white sm:px-8 sm:py-24">
        <p className="micro text-acid">From the label to the truth</p>
        <h1 className="mt-3 text-5xl font-extrabold leading-[0.95] sm:text-7xl">Nice shirt.<br />What about<br /><span className="serif-em text-acid">its water?</span></h1>
        <p className="mt-6 max-w-md text-white/85">A factory says the water was treated. Tellwater follows the thread from that claim to the records that test it.</p>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:px-8 md:grid-cols-3">
        {cases.map((c) => (
          <button key={c.key} onClick={() => go(`#/case/${c.key}`)} className="card flex flex-col gap-3 p-5 text-left hover:border-indigo">
            <span className="micro text-mute">Case {c.key}</span>
            <Stamp status={c.status} small />
            <span className="text-sm text-ink/80">{c.summary}</span>
            <span className="text-sm font-semibold text-indigo">Open the case file ↗</span>
          </button>
        ))}
      </section>
    </main>
  )
}
