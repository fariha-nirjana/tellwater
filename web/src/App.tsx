import { useEffect, useState } from 'react'
import type { CaseKey } from './api'
import { CaseFile } from './CaseFile'
import { Arrival, Companion, Footer, Hero, Story, Symbols, useCurtain } from './Journey'
import { HowTeaser, ScanLabel } from './Home'
import { HowItWorks } from './How'
import { Results } from './Pages'
import { Passport } from './Passport'

// Hash routes: #/ (the garment and the story), #/story (the same, at the story), #/case/A (the case file; #/case/C/bn with its logbook in Bangla),
// #/passport/A, #/results
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
  const [replay, setReplay] = useState(0)
  const { curtain, run } = useCurtain(motion)
  const [, caseKey, bangla] = (hash.match(/^#\/case\/([ABC])(\/bn)?$/) ?? []) as [string, CaseKey | undefined, string | undefined]
  const [, passport, scannedGtin] = (hash.match(/^#\/passport\/([ABC])(?:\/(\d{14}))?$/) ?? []) as [string, CaseKey | undefined, string | undefined]
  const results = hash === '#/results'
  const how = hash === '#/how'
  const home = !caseKey && !passport && !results && !how
  const [arrived] = useState(home && hash !== '#/story') // only a first visit to the garment plays the arrival

  useEffect(() => { document.body.classList.toggle('reduced', !motion) }, [motion])
  useEffect(() => {
    if (hash === '#/story') setTimeout(() => document.getElementById('origin')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 60)
    else scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [hash])

  const openCase = (k: CaseKey = 'B') => run(() => { location.hash = `#/case/${k}` })
  const ask = () => { if (caseKey) dispatchEvent(new Event('tw:guide')); else { location.hash = '#/case/B'; setTimeout(() => dispatchEvent(new Event('tw:guide')), 400) } }

  return (
    <>
      <Symbols />
      {home && (arrived || replay > 0) && <Arrival motion={motion} replay={replay} onDone={() => {}} />}
      {curtain}
      <header className="header">
        <a className="wordmark" href="#/" aria-label="Tellwater home"><svg viewBox="0 0 40 20"><path d="M2 16C8 0 10 25 19 7S29 20 38 3" /></svg>tellwater</a>
        <nav aria-label="Main navigation">
          <a href="#/case/B" aria-current={caseKey ? 'page' : undefined}>The investigation</a>
          <a href="#/how" aria-current={how ? 'page' : undefined}>How it works</a>
          <a href="#/story">Why I was born</a>
          <a href="#/results" aria-current={results ? 'page' : undefined}>Results</a>
        </nav>
        <span className="prototype"><i /> Prototype · records from the Tellwater simulator</span>
        <button className="menu-chat" onClick={ask}>Ask a thread ↗</button>
      </header>
      <main>
        {passport ? <Passport key={`${passport}${scannedGtin ?? ''}`} caseKey={passport} gtin={scannedGtin} /> : results ? <Results /> : how ? <HowItWorks /> : caseKey ? <CaseFile key={caseKey + (bangla ?? '')} caseKey={caseKey} bangla={!!bangla} /> : (
          <>
            <Hero onEnter={() => openCase('B')} />
            <ScanLabel />
            <HowTeaser />
            <Story />
          </>
        )}
        <Footer motion={motion} setMotion={setMotion} replay={() => { location.hash = '#/'; setReplay((r) => r + 1) }} />
      </main>
      {(home || caseKey) && <Companion hidden={false} motion={motion} onClick={ask} />}
    </>
  )
}
