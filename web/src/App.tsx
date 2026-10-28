import { useEffect, useState } from 'react'
import type { CaseKey } from './api'
import { Arrival, Companion, Footer, Hero, Story, Symbols, useCurtain } from './Journey'
import { Passport, Results } from './Pages'
import { Workspace } from './Workspace'

// Hash routes: #/ (the journey), #/case/A (the journey, opened at a case), #/passport/A, #/results
function useHash() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(location.hash || '#/')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

const prefersMotion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches

export function App() {
  const hash = useHash()
  const [motion, setMotion] = useState(prefersMotion)
  const routeCase = hash.match(/^#\/case\/([ABC])$/)?.[1] as CaseKey | undefined
  const [arrived, setArrived] = useState(!!routeCase) // a case link skips the arrival
  const [replay, setReplay] = useState(0)
  const { curtain, run } = useCurtain(motion)
  const [caseKey, setCaseKey] = useState<CaseKey>(routeCase ?? 'B')
  const passport = hash.match(/^#\/passport\/([ABC])$/)?.[1] as CaseKey | undefined
  const results = hash === '#/results'

  useEffect(() => { document.body.classList.toggle('reduced', !motion) }, [motion])
  useEffect(() => { if (routeCase) setCaseKey(routeCase) }, [routeCase])
  useEffect(() => {
    if (!routeCase || !arrived) return
    // after the workspace has laid out
    const t = setTimeout(() => document.getElementById('investigation')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived])

  const enter = () => run(() => document.getElementById('investigation')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }))
  const journey = !passport && !results

  return (
    <>
      <Symbols />
      {journey && !routeCase && <Arrival motion={motion} replay={replay} onDone={() => setArrived(true)} />}
      {curtain}
      <header className="header">
        <a className="wordmark" href="#/" aria-label="Tellwater home"><svg viewBox="0 0 40 20"><path d="M2 16C8 0 10 25 19 7S29 20 38 3" /></svg>tellwater</a>
        <nav aria-label="Main navigation">
          <a href="#/case/B" onClick={(e) => { if (journey) { e.preventDefault(); enter() } }}>The investigation</a>
          <a href="#/results">The results</a>
          {journey && <a href="#origin">Why I was born</a>}
        </nav>
        <span className="prototype"><i /> PROTOTYPE · SIMULATED RECORDS</span>
      </header>
      <main>
        {passport ? <Passport caseKey={passport} /> : results ? <Results /> : (
          <>
            <Hero onEnter={enter} />
            <Workspace caseKey={caseKey} setCase={(k) => { setCaseKey(k); history.replaceState(null, '', `#/case/${k}`) }} onPassport={(k) => { location.hash = `#/passport/${k}` }} />
            <Story />
          </>
        )}
        <Footer motion={motion} setMotion={setMotion} replay={() => { scrollTo({ top: 0 }); location.hash = '#/'; setReplay((r) => r + 1) }} />
      </main>
      {journey && <Companion hidden={false} motion={motion} onClick={() => document.getElementById('investigation')?.scrollIntoView({ behavior: 'smooth' })} />}
    </>
  )
}
