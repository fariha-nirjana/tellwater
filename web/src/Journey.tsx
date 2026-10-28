// Iteration 02's journey: arrival, hero, chapter bar, the origin story with its walking route,
// the footer, and the one companion that docks beside explanations and walks the story path.
import { useEffect, useRef, useState } from 'react'

export function Symbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id="weave" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 1H7M1 0V7" stroke="#171735" strokeOpacity=".13" strokeWidth="1" /></pattern>
        <symbol id="friend" viewBox="0 0 120 140">
          <g className="limbs" fill="none" stroke="var(--limb-color,#4945ff)" strokeWidth="5" strokeLinecap="round">
            <path d="M29 74Q6 63 12 48M91 74Q110 90 114 68" /><path className="leg-left" d="M43 110Q37 130 24 126" /><path className="leg-right" d="M77 110Q82 130 94 125" />
          </g>
          <path className="body" d="M31 20Q60 10 92 23L96 104Q64 119 25 103Z" fill="#e5ff52" stroke="#171735" strokeWidth="2" />
          <path d="M31 20Q60 10 92 23L96 104Q64 119 25 103Z" fill="url(#weave)" />
          <path d="M37 28Q63 21 84 29L87 97Q62 107 34 97Z" fill="none" stroke="#4945ff" strokeWidth="2" strokeDasharray="4 4" />
          <path d="M53 18Q41 1 54 3Q69 4 65 17" fill="none" stroke="#4945ff" strokeWidth="3" />
          <g className="eyes" fill="#171735"><ellipse cx="47" cy="61" rx="4" ry="6" /><ellipse cx="73" cy="59" rx="4" ry="6" /></g>
          <path d="M51 77Q61 87 71 75" fill="none" stroke="#171735" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="38" cy="73" rx="5" ry="3" fill="#ff705b" /><ellipse cx="82" cy="71" rx="5" ry="3" fill="#ff705b" />
        </symbol>
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

/** The thread-and-weave arrival; two panels then leave in opposite directions. */
export function Arrival({ motion, onDone, replay }: { motion: boolean; onDone: () => void; replay: number }) {
  const [state, setState] = useState<'on' | 'departing' | 'off'>(motion ? 'on' : 'off')
  useEffect(() => {
    if (!motion) { setState('off'); onDone(); return }
    setState('on'); document.body.classList.add('arriving')
    const t = setTimeout(finish, 1950)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, motion])
  function finish() {
    setState('departing'); document.body.classList.remove('arriving')
    setTimeout(() => { setState('off'); onDone() }, 1100)
  }
  if (state === 'off') return null
  return (
    <div id="arrival" aria-hidden="true" className={state === 'departing' ? 'departing' : ''}>
      <div className="arrival-half left" /><div className="arrival-half right" />
      <div className="arrival-center">
        <span className="micro">A LITTLE THREAD. A BIG QUESTION.</span>
        <svg className="assembly" viewBox="0 0 180 180">
          <path className="loose-thread" d="M5 150C80 180 160 130 125 90S35 30 50 85S145 150 125 55S40 20 40 105L125 105L125 40L45 40" />
          <g className="weaving" fill="none" stroke="#171735" strokeWidth="3">
            <path d="M62 42H120M60 53H122M59 64H123M58 75H124M57 86H125M56 97H125M55 108H126M57 119H123" />
            <path d="M65 38V120M77 36V123M89 35V125M101 36V124M113 39V122" />
          </g>
          <g className="assemble-friend"><use href="#friend" x="30" y="15" width="120" height="140" /></g>
        </svg>
        <p>Every story starts<br />with a thread.</p>
      </div>
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
          <span className="hero-foot">ONE BATCH. THREE POSSIBLE STORIES. YOU’RE THE REVIEWER.</span>
          <svg className="hero-scribble" viewBox="0 0 600 90" aria-hidden="true"><path d="M-10 65C70 0 100 100 200 50S310 20 360 50S460 90 610 10" /></svg>
        </div>
        <div className="hero-object">
          <span className="micro object-label">EXHIBIT 001 / A VERY ORDINARY SHIRT</span>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <button className="garment-entry" onClick={onEnter} aria-label="Follow the thread from the garment label">
            <svg className="big-shirt" viewBox="0 0 440 470" aria-label="Illustrated cotton shirt with a Tellwater label" role="img"><use href="#shirt" /></svg>
          </button>
          <div className="label-note"><span>pull here</span><svg viewBox="0 0 100 55"><path d="M90 4Q80 53 12 32M12 32L27 28M12 32L20 45" /></svg></div>
          <div id="heroDock" className="hero-friend-anchor" />
          <span className="stitch-tag">B04<br /><small>100% COTTON · DEMO BATCH</small></span>
          <span className="round-seal">EVERY DROP<br /><b>HAS A</b><br />STORY ↗</span>
        </div>
      </section>
      <div className="chapter-bar"><span>01 / FOLLOW THE EVIDENCE</span><span>A claim is where the story starts. It isn’t where it ends.</span><span>SCROLL TO UNRAVEL ↓</span></div>
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
        <article className="story-stop stop-three">
          <div className="connection-art" aria-hidden="true"><span className="art-label">THE CLAIM</span><span className="art-paper">“All treated.”</span>
            <svg viewBox="0 0 340 90"><path d="M30 40C70 0 95 85 140 45S220 5 260 45S300 80 330 30" /></svg>
            <span className="art-record">THE RECORD<br /><b>Let’s check. ↗</b></span></div>
          <div className="story-text"><span className="micro">03 / THE MISSING CONNECTION</span><h3>That’s where<br /><em>I come in.</em></h3>
            <p>I help you follow a claim back to its records. And when the evidence is missing, I say so. A small thread, asking an important question.</p></div>
        </article>
        <div className="road-finish"><span className="micro">ONE THREAD. ALL THE WAY THROUGH.</span><h3>A little curiosity.<br /><em>A clearer picture.</em></h3>
          <a href="#investigation" className="button acid">Follow another story <span>↗</span></a></div>
      </section>
    </>
  )
}

export function Footer({ motion, setMotion, replay }: { motion: boolean; setMotion: (m: boolean) => void; replay: () => void }) {
  return (
    <footer>
      <a className="wordmark" href="#/">〰 tellwater</a>
      <p>Made to make the invisible understandable.</p>
      <div>
        <span>PROTOTYPE · SIMULATED RECORDS · REAL MUSE SPARK INVESTIGATIONS</span>
        <button onClick={replay}>Replay my arrival ↻</button>
        <button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? 'Motion on' : 'Motion off'}</button>
      </div>
    </footer>
  )
}

/**
 * The one companion. Docks in the hero, beside the explanation strip (#evidenceDock),
 * then walks the stitched route through the origin story as the page scrolls.
 */
export function Companion({ hidden, motion, onClick }: { hidden: boolean; motion: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const f = ref.current
    if (!f) return
    let mode = '', frame = 0, walkTimer = 0, travelTimer = 0, roadLength = 0
    const $ = (s: string) => document.querySelector(s) as (SVGPathElement & HTMLElement) | null
    const setFriend = (x: number, y: number, m: string) => {
      if (m !== mode) {
        f.classList.toggle('road-mode', m === 'road'); f.classList.toggle('dock-mode', m === 'evidence')
        f.classList.add('traveling'); clearTimeout(travelTimer); travelTimer = window.setTimeout(() => f.classList.remove('traveling'), 650)
        mode = m
      }
      f.style.left = `${x}px`; f.style.top = `${y}px`
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
      const road = rect('#roadSvg'), intro = rect('#origin'), ev = rect('#evidenceDock'), hero = rect('#heroDock'), footer = rect('footer')
      const focus = innerHeight * 0.55
      const rb = $('#roadBase'), ib = $('#introBase')
      if (road && rb && road.top < focus && road.bottom > innerHeight * 0.2) {
        $('#introProgress')!.style.strokeDashoffset = '0'
        const desired = Math.max(0, Math.min(innerWidth <= 760 ? 1420 : 1250, ((focus - road.top) / road.height) * 1550))
        let lo = 0, hi = roadLength
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (rb.getPointAtLength(mid).y < desired) lo = mid; else hi = mid }
        const len = (lo + hi) / 2, p = rb.getPointAtLength(len)
        setFriend(road.left + (p.x / 1200) * road.width, road.top + (p.y / 1550) * road.height, 'road')
        $('#roadProgress')!.style.strokeDashoffset = String(roadLength - len)
      } else if (intro && ib && intro.top < innerHeight * 0.65 && intro.bottom > 0) {
        const il = ib.getTotalLength(), target = Math.max(0, Math.min(500, ((focus - intro.top) / intro.height) * 500))
        let lo = 0, hi = il
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (ib.getPointAtLength(mid).y < target) lo = mid; else hi = mid }
        const prog = (lo + hi) / 2, p = ib.getPointAtLength(prog)
        setFriend(intro.left + (p.x / 1200) * intro.width, intro.top + (p.y / 500) * intro.height, 'road')
        $('#introProgress')!.style.strokeDashoffset = String(il - prog); $('#roadProgress')!.style.strokeDashoffset = String(roadLength)
      } else if (ev && ev.top > 60 && ev.bottom < innerHeight - 15) setFriend(ev.left + ev.width / 2, ev.top + ev.height / 2, 'evidence')
      else if (hero && hero.top > 70 && hero.top < innerHeight - 50) setFriend(hero.left + hero.width / 2, hero.top + hero.height / 2, 'hero')
      else if (footer && footer.top < innerHeight) setFriend(innerWidth - 65, Math.max(60, footer.top - 55), 'rest')
      else setFriend(innerWidth - 45, innerHeight - 60, 'rest')
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { position(); frame = 0 })
      if (mode === 'road' && motion) { f.classList.add('walking'); clearTimeout(walkTimer); walkTimer = window.setTimeout(() => f.classList.remove('walking'), 140) }
    }
    const onResize = () => { setupRoad(); position() }
    setupRoad(); position()
    const settle = window.setInterval(position, 500) // content above (the case file) loads after mount
    addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onResize)
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', onResize); clearInterval(settle); cancelAnimationFrame(frame) }
  }, [motion])
  if (hidden) return null
  return (
    <button ref={ref} className="companion" aria-label="Your thread friend" onClick={onClick}>
      <svg viewBox="0 0 120 140"><use href="#friend" /></svg>
      <span className="friend-tooltip">I’m here if you need me.</span>
    </button>
  )
}
