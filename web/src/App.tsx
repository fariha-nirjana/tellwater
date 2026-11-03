import { useEffect, useState } from 'react'
import type { CaseKey } from './api'
import { CaseFile } from './CaseFile'
import { ChatLauncher } from './ChatLauncher'
import { Guide } from './Guide'
import { Arrival, Companion, Footer, Hero, Story, Symbols, useCurtain } from './Journey'
import { HowTeaser, PhoneStory, ScanLabel } from './Home'
import { HowItWorks } from './How'
import { Results } from './Pages'
import { Passport } from './Passport'
import { Factory } from './Factory'
import { Report } from './Report'
import { Icon } from './Icon'

// Hash routes: #/ (the garment and the story), #/story (the same, at the story), #/case/A (the case file; #/case/C/bn with its logbook in Bangla),
// #/passport/A, #/report/A (the audit report), #/results, #/trace (pick a run and a garment, scan its tag), #/factory (the factory's page)
function useHash() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(location.hash || '#/')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

type Role = 'all' | 'buyer' | 'factory' | 'shopper'
type Page = 'home' | 'case' | 'report' | 'passport' | 'results' | 'how' | 'trace' | 'factory'
const ROLES: [Role, string, string][] = [['all', 'Everything', 'All'], ['buyer', 'Buyer’s reviewer', 'Buyer'], ['factory', 'Factory', 'Factory'], ['shopper', 'Shopper', 'Shopper']]
// each audience's own pages, and where it starts
const PAGES: Record<Exclude<Role, 'all'>, Page[]> = {
  buyer: ['home', 'case', 'report', 'passport', 'how', 'results'],
  factory: ['home', 'factory', 'passport', 'how', 'results'],
  shopper: ['home', 'trace', 'passport', 'how', 'results'],
}
// where the home page's "follow the thread" links lead for each audience: [first story, another story, its label]
export const ENTRY: Record<Role, [string, string, string]> = {
  all: ['#/case/B', '#/case/C', 'Follow another story'],
  buyer: ['#/case/B', '#/case/C', 'Follow another story'],
  factory: ['#/factory', '#/factory', 'See your buyers’ requests'],
  shopper: ['#/trace', '#/trace', 'Trace a garment'],
}
const START: Record<Exclude<Role, 'all'>, string> = { buyer: '#/case/B', factory: '#/factory', shopper: '#/' }
const NAV: Record<Role, [string, string, Page | 'story'][]> = {
  all: [['#/case/B', 'The investigation', 'case'], ['#/trace', 'Trace a garment', 'trace'], ['#/how', 'How it works', 'how'], ['#/story', 'Why I was born', 'story'], ['#/results', 'Results', 'results']],
  buyer: [['#/case/B', 'Our suppliers’ cases', 'case'], ['#/how', 'How it works', 'how'], ['#/results', 'Results', 'results']],
  factory: [],
  shopper: [['#/trace', 'Trace a garment', 'trace'], ['#/how', 'How it works', 'how'], ['#/story', 'Why I was born', 'story']],
}

const prefersMotion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches

export function App() {
  const hash = useHash()
  const [motion, setMotion] = useState(prefersMotion)
  const [replay, setReplay] = useState(0)
  // the companion can be switched off from the footer; the choice is remembered
  const [companion, setCompanionState] = useState(() => { try { return localStorage.getItem('tw:companion') !== 'off' } catch { return true } })
  const setCompanion = (on: boolean) => { setCompanionState(on); try { localStorage.setItem('tw:companion', on ? 'on' : 'off') } catch { /* private window */ } }
  const { curtain, run } = useCurtain(motion)
  const [, caseKey, bangla] = (hash.match(/^#\/case\/([A-E])(\/bn)?$/) ?? []) as [string, CaseKey | undefined, string | undefined]
  const [, passport, scannedGtin, scanFlag] = (hash.match(/^#\/passport\/([A-E])(?:\/(\d{14}))?(\/scan)?$/) ?? []) as [string, CaseKey | undefined, string | undefined, string | undefined]
  // a garment's QR opens #/passport/X/<gtin>/scan: the person holding the garment sees the shopper's passport only, with no demo switcher
  // once someone arrives by scanning, the rest of their visit (this tab) stays in the shopper's view, with no demo switcher
  // (not from inside the home page's phone preview, an iframe, which shares the tab's storage)
  const scan = !!(passport && scanFlag)
  const inFrame = window.top !== window.self
  const [scanned, setScanned] = useState(() => { try { return sessionStorage.getItem('tw:scan') === '1' } catch { return false } })
  useEffect(() => { if (scan && !inFrame) { setScanned(true); try { sessionStorage.setItem('tw:scan', '1') } catch { /* private window */ } } }, [scan, inFrame])
  const scanVisit = scan || (scanned && !inFrame)
  const report = hash.match(/^#\/report\/([A-E])$/)?.[1] as CaseKey | undefined
  const results = hash === '#/results'
  const how = hash === '#/how'
  const trace = hash === '#/trace'
  const factoryId = hash.match(/^#\/factory(?:\/([ab]))?$/) ? (hash.endsWith('/b') ? 'B' : 'A') : null
  const factory = !!factoryId
  const home = !caseKey && !passport && !report && !results && !how && !trace && !factory
  // who is looking: everything (the default, and the demo), or one audience with only its own pages
  const [chosenRole, setRoleState] = useState<Role>(() => { try { return (localStorage.getItem('tw:role') as Role) || 'all' } catch { return 'all' } })
  const role: Role = scanVisit ? 'shopper' : chosenRole
  const setRole = (r: Role) => {
    setRoleState(r); try { localStorage.setItem('tw:role', r) } catch { /* private window */ }
    if (r !== 'all') location.hash = START[r]
  }
  const page: Page = caseKey ? 'case' : report ? 'report' : passport ? 'passport' : results ? 'results' : how ? 'how' : trace ? 'trace' : factory ? 'factory' : 'home'
  const allowed = scan || role === 'all' || PAGES[role].includes(page)
  const [arrived] = useState(home && hash !== '#/story') // only a first visit to the garment plays the arrival

  useEffect(() => { document.body.classList.toggle('reduced', !motion) }, [motion])
  useEffect(() => {
    if (hash === '#/story') setTimeout(() => document.getElementById('origin')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 60)
    else scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [hash])

  // the guide opens where you are: in a case file its own panel, on a passport about that batch, elsewhere about Tellwater
  const [chat, setChat] = useState(false)
  useEffect(() => setChat(false), [hash])
  const ask = () => { if (caseKey) dispatchEvent(new Event('tw:guide')); else setChat(true) }
  const cite = (id: string) => { location.hash = id === 'results' ? '#/results' : id.startsWith('case:') ? `#/case/${id.slice(5)}` : `#/case/${passport ?? 'B'}` }

  return (
    <>
      <Symbols />
      {home && (arrived || replay > 0) && <Arrival motion={motion} replay={replay} onDone={() => {}} />}
      {curtain}
      <header className="header">
        <a className="wordmark" href="#/" aria-label="Tellwater home"><img src="/logo.svg?v=2" alt="" />tellwater</a>
        {scan ? null : factory ? (
          <nav aria-label="Factory navigation">
            {([['fv-requests', 'Requests'], ['fv-runs', 'Our dye runs'], ['fv-records', 'Our records']] as const).map(([id, label]) => (
              <a key={id} href={hash} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{label}</a>
            ))}
          </nav>
        ) : (
          <nav aria-label="Main navigation">
            {NAV[role].map(([href, label, p]) => <a key={href} href={href} aria-current={p === page ? 'page' : undefined}>{label}</a>)}
          </nav>
        )}
        {!scanVisit && <div className="role-switch" role="group" aria-label="Demo: see it as" title="A demo control. In a real deployment, each person signs in and sees only their own view.">
          <div className="role-row">
            <span className="role-label"><span className="role-long">Demo: see it as…</span><span className="role-short">Demo</span></span>
            {ROLES.map(([r, long, short]) => (
              <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}><span className="role-long">{long}</span><span className="role-short">{short}</span></button>
            ))}
          </div>
          <small className="role-note">In a real deployment, each person signs in and sees only their own view.</small>
        </div>}
      </header>
      <main>
        {!allowed ? <OtherView role={role as Exclude<Role, 'all'>} onEverything={() => setRole('all')} /> : passport ? <Passport key={`${passport}${scannedGtin ?? ''}${scan ? 'scan' : role}`} caseKey={passport} gtin={scannedGtin} role={scan ? 'shopper' : role} /> : report ? <Report caseKey={report} /> : results ? <Results /> : how ? <HowItWorks /> : trace ? <ScanLabel /> : factoryId ? <Factory key={factoryId} which={factoryId} /> : caseKey ? <CaseFile key={caseKey + (bangla ?? '')} caseKey={caseKey} bangla={!!bangla} /> : (
          <>
            <Hero entry={ENTRY[role][0]} onEnter={() => run(() => { location.hash = ENTRY[role][0] })} />
            <PhoneStory />
            <HowTeaser />
            <Story next={ENTRY[role]} />
          </>
        )}
        <Footer motion={motion} setMotion={setMotion} replay={() => { location.hash = '#/'; setReplay((r) => r + 1) }} companion={companion} setCompanion={setCompanion} />
      </main>
      {(home || caseKey) && allowed && <Companion hidden={!companion} motion={motion} onClick={ask} inCase={!!caseKey} />}
      {caseKey && !companion && <button className="guide-pill" onClick={ask}>Ask the guide <Icon n="ne" /></button>}
      <ChatLauncher key={caseKey ? 'case' : 'page'} page={caseKey ? 'case' : passport ? 'passport' : report ? 'report' : results ? 'results' : how ? 'how' : trace ? 'trace' : factory ? 'factory' : 'home'} hidden={chat || (!!caseKey && !companion)} motion={motion} onOpen={ask} />
      {!caseKey && <Guide key={passport ?? 'site'} caseKey={passport ?? 'B'} scope={passport ? 'passport' : 'site'} languages={factory ? 'en-bn' : 'all'} focus={null} open={chat} onClose={() => setChat(false)} onCite={cite} />}
    </>
  )
}

/** A page that belongs to another audience than the one chosen. */
function OtherView({ role, onEverything }: { role: Exclude<Role, 'all'>; onEverything: () => void }) {
  const who = ROLES.find(([r]) => r === role)![1]
  return (
    <section className="other-view">
      <span className="micro">VIEWING AS {who.toUpperCase()}</span>
      <h1>This page isn’t part of the {who.toLowerCase()} view.</h1>
      <div><a className="button ink small" href={START[role]}>Go to the {who.toLowerCase()} view <span><Icon n="ne" /></span></a>
        <button className="text-btn" onClick={onEverything}>See everything <Icon n="ne" /></button></div>
    </section>
  )
}
