// Iteration 02's journey: arrival, hero, chapter bar, the origin story with its walking route,
// the footer, and the one companion that docks beside explanations and walks the story path.
import { useEffect, useRef, useState } from 'react'
import { art, MOODS, type Cloth, type Mood } from './companion'

export function Symbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id="weave" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 1H7M1 0V7" stroke="#171735" strokeOpacity=".13" strokeWidth="1" /></pattern>
        <symbol id="shirt" viewBox="0 0 440 470">
          <path d="M137 55L76 89 14 180 98 225 125 185 112 415Q218 443 331 415L318 185 345 225 427 180 367 88 304 55Q220 113 137 55Z" fill="#f9f9ed" stroke="#171735" strokeWidth="3" />
          <path d="M137 55Q160 141 220 140Q281 139 304 55M150 66Q174 127 220 126Q267 125 292 66M128 180L147 86M317 180L293 84M123 402Q220 427 321 402" fill="none" stroke="#c8c8b9" strokeWidth="2" />
          <path d="M137 55L76 89 14 180 98 225 125 185 112 415Q218 443 331 415L318 185 345 225 427 180 367 88 304 55" fill="url(#weave)" opacity=".4" />
          <path d="M300 200Q280 248 302 350" fill="none" stroke="#4945ff" strokeWidth="3" strokeDasharray="5 6" />
          <rect x="256" y="267" width="72" height="102" rx="5" fill="#4945ff" transform="rotate(8 292 318)" />
          <path d="M283 265Q291 235 300 262" fill="none" stroke="#4945ff" strokeWidth="3" />
          <text x="272" y="300" fill="#e5ff52" fontSize="10" fontFamily="Arial" fontWeight="bold" transform="rotate(8 292 318)">FOLLOW</text>
          <text x="272" y="318" fill="#fff" fontSize="10" fontFamily="Arial" fontWeight="bold" transform="rotate(8 292 318)">MY</text>
          <text x="272" y="337" fill="#fff" fontSize="10" fontFamily="Arial" fontWeight="bold" transform="rotate(8 292 318)">THREAD ↗</text>
        </symbol>
      </defs>
    </svg>
  )
}

// the folded gamchha the thread weaves in the arrival: a front panel woven row by row, a rolled fold, a fringe
const X0 = 196, Y0 = 300, W = 208, H = 120, ROWS = 6, ROW = H / ROWS
const range = (from: number, to: number, step: number) => Array.from({ length: Math.max(0, Math.ceil((to - from) / step)) }, (_, i) => from + i * step)
const BANDS_Y = range(Y0 + 10, Y0 + H, 38), BANDS_X = range(X0 + 12, X0 + W, 38)
const WEFT = `M${X0} ${Y0 + ROW / 2}` + range(0, ROWS - 1, 1).map((i) => `H${i % 2 ? X0 : X0 + W}V${Y0 + (i + 1.5) * ROW}`).join('') + `H${X0 + W}`

function Spark({ x, y, s, delay }: { x: number; y: number; s: number; delay: number }) {
  const k = s * 0.18
  return <g transform={`translate(${x} ${y})`}><path className="arr-spark" style={{ animationDelay: `${delay}s` }} d={`M0 ${-s}Q${k} ${-k} ${s} 0Q${k} ${k} 0 ${s}Q${-k} ${k} ${-s} 0Q${-k} ${-k} 0 ${-s}Z`} fill="#8a87ff" /></g>
}

/**
 * The arrival, on acid: a thread draws in and weaves the gamchha check row by row into a folded cloth,
 * which jumps and lands as the companion; then purple sweeps over the left half and the halves part.
 */
export function Arrival({ motion, onDone, replay }: { motion: boolean; onDone: () => void; replay: number }) {
  const [state, setState] = useState<'on' | 'departing' | 'off'>(motion ? 'on' : 'off')
  useEffect(() => {
    if (!motion) { setState('off'); onDone(); return }
    setState('on'); document.body.classList.add('arriving')
    const t = setTimeout(finish, 4050)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, motion])
  function finish() {
    setState('departing'); document.body.classList.remove('arriving')
    setTimeout(() => { setState('off'); onDone() }, 1600)
  }
  if (state === 'off') return null
  return (
    <div id="arrival" aria-hidden="true" className={state === 'departing' ? 'departing' : ''}>
      <div className="arrival-half left" /><div className="arrival-half right" />
      <svg className="arrival-art" viewBox="0 40 600 520" preserveAspectRatio="xMidYMid meet">
        <defs>
          <mask id="arr-weave">{range(0, ROWS, 1).map((i) => <rect key={i} className={`arr-weft ${i % 2 ? 'from-r' : 'from-l'}`} style={{ animationDelay: `${1 + i * 0.12}s` }} x={X0} y={Y0 + i * ROW} width={W} height={ROW + 0.6} fill="#fff" />)}</mask>
          <clipPath id="arr-front"><rect x={X0} y={Y0} width={W} height={H} rx="6" /></clipPath>
        </defs>
        <ellipse className="arr-shadow" cx="300" cy="432" rx="118" ry="9" fill="#171735" opacity=".1" />
        <path className="arr-thread" pathLength={1} d={`M-30 200C70 130 130 280 220 196S332 104 302 186S150 262 ${X0} ${Y0 + ROW / 2}`} fill="none" stroke="#4945ff" strokeWidth="6" strokeLinecap="round" />
        <g className="arr-folded">
          <g className="arr-fringe">{range(Y0 + 6, Y0 + H, 9).map((y) => <path key={y} d={`M${X0 + W} ${y}h12`} stroke="#aeacff" strokeWidth="4" strokeLinecap="round" />)}</g>
          <g clipPath="url(#arr-front)"><g mask="url(#arr-weave)">
            <rect x={X0} y={Y0} width={W} height={H} fill="#fff" />
            {BANDS_Y.map((y) => <rect key={`h${y}`} x={X0} y={y} width={W} height="14" fill="#aeacff" />)}
            {BANDS_X.map((x) => <rect key={`v${x}`} x={x} y={Y0} width="14" height={H} fill="#aeacff" />)}
            {BANDS_X.flatMap((x) => BANDS_Y.map((y) => <rect key={`c${x}-${y}`} x={x} y={y} width="14" height="14" fill="#7774ff" />))}
            {BANDS_Y.map((y) => <path key={`lh${y}`} d={`M${X0} ${y + 26}H${X0 + W}`} stroke="#ff8a78" strokeWidth="2.5" />)}
            {range(X0 + 12, X0 + W - 25, 38).map((x) => <path key={`lv${x}`} d={`M${x + 25} ${Y0}V${Y0 + H}`} stroke="#ff8a78" strokeWidth="2.5" />)}
          </g></g>
          <rect className="arr-outline" x={X0} y={Y0} width={W} height={H} rx="6" fill="none" stroke="#c9c8fb" strokeWidth="3" />
          <path className="arr-weft-thread" pathLength={1} d={WEFT} fill="none" stroke="#4945ff" strokeWidth="3.5" strokeLinejoin="round" />
          <g className="arr-roll">
            <rect x={X0 - 6} y={Y0 - 16} width={W + 12} height="28" rx="14" fill="#fff" />
            {BANDS_X.map((x) => <rect key={x} x={x} y={Y0 - 16} width="14" height="28" fill="#aeacff" />)}
            <rect x={X0 - 6} y={Y0 - 2} width={W + 12} height="14" rx="7" fill="#7774ff" opacity=".22" />
            <rect x={X0 - 6} y={Y0 - 16} width={W + 12} height="28" rx="14" fill="none" stroke="#c9c8fb" strokeWidth="3" />
          </g>
        </g>
        <g className="arr-companion"><image href={art('g1', 'calm', true)} x="140" y="118" width="320" height="320" /></g>
        <Spark x={140} y={210} s={18} delay={2.86} /><Spark x={468} y={168} s={14} delay={2.94} /><Spark x={122} y={300} s={11} delay={3.02} />
        <text className="arr-line" x="300" y="500" textAnchor="middle">Every story starts with a thread.</text>
      </svg>
      <button id="skipArrival" onClick={finish}>Skip intro ↗</button>
    </div>
  )
}

/** Two panels moving vertically in opposite directions; `run` calls back at the covered moment. */
export function useCurtain(motion: boolean) {
  const [active, setActive] = useState(false)
  const run = (atCover: () => void) => {
    if (!motion) return atCover()
    setActive(true)
    setTimeout(atCover, 590)
    setTimeout(() => setActive(false), 1300)
  }
  const curtain = <div id="curtain" aria-hidden="true" className={active ? 'active' : ''}><div /><div /></div>
  return { curtain, run }
}

export function Hero({ onEnter }: { onEnter: () => void }) {
  return (
    <>
      <section id="top" className="hero">
        <div className="hero-copy">
          <span className="micro light"><i className="dot" /> FROM THE LABEL TO THE TRUTH</span>
          <h1>Nice shirt.<br />What about<br /><em>its water?</em></h1>
          <p>There’s a story behind every garment.<br />Let’s follow the thread to the evidence.</p>
          <button className="button acid" onClick={onEnter}>Follow the thread <span>↗</span></button>
          <span className="hero-foot">EVERY GARMENT HAS A RUN. EVERY RUN HAS RECORDS. YOU’RE THE REVIEWER.</span>
          <svg className="hero-scribble" viewBox="0 0 600 90" aria-hidden="true"><path d="M-10 65C70 0 100 100 200 50S310 20 360 50S460 90 610 10" /></svg>
        </div>
        <div className="hero-object">
          <span className="micro object-label">EXHIBIT 001 / A VERY ORDINARY SHIRT</span>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <button className="garment-entry" onClick={onEnter} aria-label="Follow the thread from the garment label">
            <img className="hero-photo" src={`${import.meta.env.BASE_URL}garments/hero.jpg`} alt="An undyed cotton T-shirt on a hanger, its blank tag tied on with a purple thread" />
          </button>
          <div className="label-note"><span>pull here</span><svg viewBox="0 0 100 55"><path d="M90 4Q80 53 12 32M12 32L27 28M12 32L20 45" /></svg></div>
          <div id="heroDock" className="hero-friend-anchor" />
          <span className="stitch-tag">B04<br /><small>100% COTTON · DEMO BATCH</small></span>
          <span className="round-seal">EVERY DROP<br /><b>HAS A</b><br />STORY ↗</span>
        </div>
      </section>
      <div className="chapter-bar"><span>FOLLOW THE EVIDENCE</span><span>A claim is where the story starts. It isn’t where it ends.</span><a href="#/case/B">OPEN THE CASE FILE ↗</a></div>
    </>
  )
}

export function Story() {
  return (
    <>
      <section className="story-intro" id="origin">
        <svg id="introRoad" viewBox="0 0 1200 500" preserveAspectRatio="none" aria-hidden="true"><path id="introBase" /><path id="introProgress" /></svg>
        <span className="micro">02 / FOLLOW ME A LITTLE FURTHER</span>
        <h2>But why<br />was I <span className="serif">born?</span></h2>
        <p>You’ve seen the records.<br />Let me show you why they matter.</p>
        <span className="scroll-prompt">KEEP SCROLLING. I’LL WALK WITH YOU. ↓</span>
        <div className="story-loop" aria-hidden="true" />
      </section>
      <section className="story-road" id="storyRoad" aria-label="Follow the thread through our origin story">
        <svg id="roadSvg" viewBox="0 0 1200 1550" preserveAspectRatio="none" aria-hidden="true"><path id="roadBase" /><path id="roadProgress" /></svg>
        <article className="story-stop stop-one">
          <div className="photo-frame"><img src="/assets/garment-worker.jpg" alt="A garment worker tending spools of blue yarn" loading="lazy" /><span className="photo-sticker">IT STARTS<br />WITH PEOPLE.</span></div>
          <div className="story-text"><span className="micro">01 / THE GARMENT</span><h3>More than<br />something <em>you wear.</em></h3>
            <p>Behind a shirt are people, skills, and livelihoods. That’s where my story begins—with something familiar.</p>
            <small>Contextual photograph · Unsplash<br />Not from the demo factory.</small></div>
        </article>
        <article className="story-stop stop-two">
          <div className="story-text"><span className="micro">02 / THE WATER</span><h3>The part<br /><em>you don’t see.</em></h3>
            <p>Dyeing and washing leave water behind. What happens to it matters to the people living beside the river.</p>
            <small>Contextual photograph · Unsplash<br />Not evidence of pollution by any factory.</small></div>
          <div className="photo-frame"><img src="/assets/river.jpg" alt="Wooden boats on a river beside a city" loading="lazy" /><span className="photo-sticker coral">THE STORY<br />KEEPS FLOWING.</span></div>
        </article>
        <blockquote className="story-quote">
          <p>“The gap is not necessarily a lack of documentation; it is the difficulty of connecting the documents with real operating conditions.”</p>
          <footer><b>Rajib Singha</b> · Vice President, Human Resources &amp; Administration, Pearl Global Industries Ltd</footer>
        </blockquote>
        <article className="story-stop stop-three">
          <div className="connection-art" aria-hidden="true"><span className="art-label">THE CLAIM</span><span className="art-paper">“All treated.”</span>
            <svg viewBox="0 0 340 90"><path d="M30 40C70 0 95 85 140 45S220 5 260 45S300 80 330 30" /></svg>
            <span className="art-record">THE RECORD<br /><b>Let’s check. ↗</b></span></div>
          <div className="story-text"><span className="micro">03 / THE MISSING CONNECTION</span><h3>That’s where<br /><em>I come in.</em></h3>
            <p>I help you follow a claim back to its records. And when the evidence is missing, I say so. A small thread, asking an important question.</p></div>
        </article>
        <div className="road-finish"><span className="micro">ONE THREAD. ALL THE WAY THROUGH.</span><h3>A little curiosity.<br /><em>A clearer picture.</em></h3>
          <a href="#/case/C" className="button acid">Follow another story <span>↗</span></a></div>
      </section>
    </>
  )
}

export function Footer({ motion, setMotion, replay, companion, setCompanion }: { motion: boolean; setMotion: (m: boolean) => void; replay: () => void; companion: boolean; setCompanion: (c: boolean) => void }) {
  return (
    <footer>
      <a className="wordmark" href="#/">〰 tellwater</a>
      <p>Made to make the invisible understandable.</p>
      <div>
        <span>PROTOTYPE · SIMULATED RECORDS · REAL MUSE SPARK INVESTIGATIONS</span>
        <button onClick={replay}>Replay my arrival ↻</button>
        <button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? 'Motion on' : 'Motion off'}</button>
        <button aria-pressed={companion} onClick={() => setCompanion(!companion)}>{companion ? 'Companion on' : 'Companion off'}</button>
      </div>
    </footer>
  )
}

const OBSTACLES = '.story-quote'  // the road crosses the quote card; everything else is laid out clear of the road
// resting in a story section, the companion acts it out: looking into the water, reading the quote,
// asking at the missing connection, a hop at the clearer picture
const ROAD_MOODS: [string, Mood][] = [['.stop-two', 'checking'], ['.story-quote', 'reading'], ['.stop-three', 'asking'], ['.road-finish', 'found']]
const rectOf = (sel: string) => document.querySelector(sel)?.getBoundingClientRect()
// whether the page behind a point is one of the purple sections (the companion and its thread don't count)
const onPurple = (x: number, y: number, self: Element) => {
  for (let el = document.elementsFromPoint(x, y).find((e) => !self.contains(e) && !e.closest('.companion-thread')) ?? null; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg === 'rgb(73, 69, 255)'
  }
  return false
}

/**
 * The one companion, and the way into the guide. Docks in the hero,
 * then walks the stitched route through the origin story as the page scrolls.
 */
export function Companion({ hidden, motion, onClick, inCase }: { hidden: boolean; motion: boolean; onClick: () => void; inCase: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const thread = useRef<SVGPathElement>(null)  // the thread it hangs from, top of the screen to its ring
  const [cloth, setCloth] = useState<Cloth>('g1')  // acid cloth while it walks the purple story
  const [walking, setWalking] = useState(false)
  const [caseMood, setCaseMood] = useState<Mood | null>(null)
  const [guideBusy, setGuideBusy] = useState(false)
  const [roadMood, setRoadMood] = useState<Mood | null>(null)  // what the story section it rests in is about
  useEffect(() => {
    const m = (e: Event) => setCaseMood((e as CustomEvent<Mood | null>).detail)
    const g = (e: Event) => setGuideBusy((e as CustomEvent<boolean>).detail)
    addEventListener('tw:mood', m); addEventListener('tw:guide-busy', g)
    return () => { removeEventListener('tw:mood', m); removeEventListener('tw:guide-busy', g) }
  }, [])
  useEffect(() => {  // every pose loaded up front, so a change of mood never flashes empty
    for (const c of ['g1', 'g2'] as Cloth[]) for (const m of MOODS) new Image().src = art(c, m, motion)
  }, [motion])
  useEffect(() => {
    const f = ref.current
    if (!f) return
    let mode = '', frame = 0, walkTimer = 0, travelTimer = 0, hopTimer = 0, roadLength = 0, lastY = 0
    const $ = (s: string) => document.querySelector(s) as (SVGPathElement & HTMLElement) | null
    const setFriend = (x: number, y: number, m: string) => {
      if (m !== mode) {
        f.classList.toggle('road-mode', m === 'road'); f.classList.toggle('dock-mode', m === 'evidence')
        f.classList.toggle('hanging', m !== 'road'); thread.current?.parentElement?.classList.toggle('let-go', m === 'road')
        f.classList.add('traveling'); clearTimeout(travelTimer); travelTimer = window.setTimeout(() => f.classList.remove('traveling'), 650)
        mode = m
      } else if (m === 'road' && Math.abs(y - lastY) > 70) {  // cleared something on the road: hop across it
        f.classList.add('hopping'); clearTimeout(hopTimer); hopTimer = window.setTimeout(() => f.classList.remove('hopping'), 600)
      }
      lastY = y
      f.style.left = `${x}px`; f.style.top = `${y}px`
      setCloth(m === 'road' || onPurple(x, y, f) ? 'g2' : 'g1')  // acid cloth on purple, white cloth everywhere else
      // the section in the middle of the screen, not where it stands (it steps off the quote to keep it readable)
      setRoadMood(m === 'road' ? [...ROAD_MOODS].reverse().find(([sel]) => { const r = rectOf(sel); return r && r.top < innerHeight * 0.6 && r.bottom > innerHeight * 0.25 })?.[1] ?? null : null)
    }
    // never stand on the quote: wait at its near edge, then hop to the far one
    const avoid = (x: number, y: number): [number, number] => {
      const w = f.offsetWidth / 2 + 8, h = f.offsetHeight / 2 + 8
      let dir = 0
      for (let i = 0; i < 8; i++) {
        const hit = [...document.querySelectorAll(OBSTACLES)].map((el) => el.getBoundingClientRect())
          .find((r) => r.height && x + w > r.left && x - w < r.right && y + h > r.top && y - h < r.bottom)
        if (!hit) break
        dir ||= y > (hit.top + hit.bottom) / 2 ? 1 : -1
        y = dir > 0 ? hit.bottom + h : hit.top - h
      }
      return [x, y]
    }
    const setupRoad = () => {
      const mobile = innerWidth <= 760
      const introD = mobile ? 'M1100 0 C1080 100 1140 210 1100 340 S130 420 115 500' : 'M600 0 C630 100 650 180 600 260 S540 400 600 500'
      const d = mobile ? 'M115 0 C90 140 160 250 120 400 S70 650 130 820 S170 1100 120 1260 S80 1430 120 1530'
        : 'M600 0 C600 70 570 120 620 200 S680 350 590 420 S470 500 580 620 S710 740 610 840 S480 940 600 1060 S700 1170 600 1260 L600 1265'
      const ib = $('#introBase'), ip = $('#introProgress'), rb = $('#roadBase'), rp = $('#roadProgress')
      if (!ib || !ip || !rb || !rp) return
      ib.setAttribute('d', introD); ip.setAttribute('d', introD); ip.style.strokeDasharray = String(ib.getTotalLength())
      rb.setAttribute('d', d); rp.setAttribute('d', d); roadLength = rb.getTotalLength(); rp.style.strokeDasharray = String(roadLength)
    }
    const position = () => {
      if (document.body.classList.contains('arriving')) return
      const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect()
      const road = rect('#roadSvg'), intro = rect('#origin'), ev = rect('#caseDock'), hero = rect('#heroDock'), footer = rect('footer')
      const focus = innerHeight * 0.55
      const rb = $('#roadBase'), ib = $('#introBase')
      if (road && rb && road.top < focus && road.bottom > innerHeight * 0.2) {
        $('#introProgress')!.style.strokeDashoffset = '0'
        const desired = Math.max(0, Math.min(innerWidth <= 760 ? 1420 : 1250, ((focus - road.top) / road.height) * 1550))
        let lo = 0, hi = roadLength
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (rb.getPointAtLength(mid).y < desired) lo = mid; else hi = mid }
        const len = (lo + hi) / 2, p = rb.getPointAtLength(len)
        setFriend(...avoid(road.left + (p.x / 1200) * road.width, road.top + (p.y / 1550) * road.height), 'road')
        $('#roadProgress')!.style.strokeDashoffset = String(roadLength - len)
      } else if (intro && ib && intro.top < innerHeight * 0.65 && intro.bottom > 0) {
        const il = ib.getTotalLength(), target = Math.max(0, Math.min(500, ((focus - intro.top) / intro.height) * 500))
        let lo = 0, hi = il
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (ib.getPointAtLength(mid).y < target) lo = mid; else hi = mid }
        const prog = (lo + hi) / 2, p = ib.getPointAtLength(prog)
        setFriend(...avoid(intro.left + (p.x / 1200) * intro.width, intro.top + (p.y / 500) * intro.height), 'road')
        $('#introProgress')!.style.strokeDashoffset = String(il - prog); $('#roadProgress')!.style.strokeDashoffset = String(roadLength)
      } else if (ev && ev.top > 60 && ev.bottom < innerHeight - 15) setFriend(ev.left + ev.width / 2, ev.top + ev.height / 2, 'evidence')
      else {
        // off the road it hangs on its thread at the right and travels down the page with you: level with the hero's
        // garment while that's on screen, then at a steady height, and it stops above the footer
        let y = innerHeight * 0.6
        if (hero && hero.top + hero.height / 2 > y) y = hero.top + hero.height / 2
        if (footer && footer.top - 60 < y) y = footer.top - 60
        y = Math.min(Math.max(y, 90), innerHeight - 70)  // always on screen, whatever the zoom or layout
        setFriend(innerWidth - Math.max(60, innerWidth * 0.05), y, 'hang')
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { position(); frame = 0 })
      if (mode === 'road' && motion) { setWalking(true); clearTimeout(walkTimer); walkTimer = window.setTimeout(() => setWalking(false), 450) }
    }
    // off the road it hangs by its mill ring from a thread down from the top of the screen; the thread follows it every frame
    let tie = 0
    const tieThread = () => {
      const t = thread.current
      if (t && mode !== 'road') {
        const r = f.getBoundingClientRect(), side = Math.min(r.width, r.height)
        // the top of its mill ring (160, 115 in the 512 drawing): the thread is tied through it
        const x = r.left + (r.width - side) / 2 + (160 / 512) * side, y = r.top + (r.height - side) / 2 + (115 / 512) * side
        t.setAttribute('d', `M${x + 8} 0Q${x - 4} ${y * 0.55} ${x} ${y}`)
      }
      tie = requestAnimationFrame(tieThread)
    }
    tieThread()
    const onResize = () => { setupRoad(); position() }
    setupRoad(); position()
    const settle = window.setInterval(position, 500) // content above (the case file) loads after mount
    addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onResize)
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', onResize); clearInterval(settle); cancelAnimationFrame(frame); cancelAnimationFrame(tie) }
  }, [motion, hidden])
  // until the guide has been opened once, a bubble says what the companion is for
  const [introduce, setIntroduce] = useState(() => { try { return !localStorage.getItem('tw:guide-opened') } catch { return true } })
  useEffect(() => { const t = setTimeout(() => setIntroduce(false), 10_000); return () => clearTimeout(t) }, [])  // it doesn't sit over the page for long
  if (hidden) return null
  const mood: Mood = walking ? 'walk' : guideBusy ? 'reading' : roadMood ?? caseMood ?? 'calm'
  const open = () => { setIntroduce(false); try { localStorage.setItem('tw:guide-opened', '1') } catch { /* private window */ } onClick() }
  return (
    <>
      <svg className="companion-thread" aria-hidden="true"><path ref={thread} /></svg>
      <button ref={ref} className={`companion${introduce && inCase ? ' introduce' : ''}`} aria-label="Ask the guide about the evidence" onClick={open}>
        <img src={art(cloth, mood, motion)} alt="" draggable={false} />
        <span className="friend-tooltip">Ask me about this case. I explain the evidence.</span>
      </button>
    </>
  )
}
