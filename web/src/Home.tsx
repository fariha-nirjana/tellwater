// Scanning a garment's label: the full picker on its own page (#/trace: batch -> garment -> its tag's QR), and on the home page
// a phone that shows the same thing in three taps; then how it works in three beats.
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, type CatalogBatch } from './api'
import { dayHm, wall } from './evidence'
import { Garment, SHADE } from './Garments'
import TAGS from './tags.json'

export function ScanLabel() {
  const [log, setLog] = useState<CatalogBatch[]>([])
  const [key, setKey] = useState('B')
  const [gtin, setGtin] = useState('')
  const [qr, setQr] = useState('')
  useEffect(() => { api.catalog().then(setLog).catch(() => setLog([])) }, [])
  const batch = log.find((b) => b.key === key) ?? log[0]
  const product = batch?.products.find((p) => p.gtin === gtin) ?? batch?.products[0]
  const url = product ? `${location.origin}${product.link}` : ''
  useEffect(() => { if (url) QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#171735', light: '#f9f9ed' } }).then(setQr) }, [url])
  if (!batch || !product) return null
  const lot = (b: CatalogBatch) => b.products[0].lot
  return (
    <section className="scan-label" id="label" aria-label="Scan a garment's label">
      <div className="scan-heading">
        <div><span className="micro">THE PASSPORT ON THE LABEL</span>
          <h2>Every label can lead<br /><span className="serif">back to its water.</span></h2></div>
        <p>Garments don’t make wastewater; dye runs do. Pick a run from the production log, pick a garment cut from its fabric, and scan the tag. Every garment from a run carries that run’s answer.</p>
      </div>
      <div className="scan-grid">
        <div className="scan-log">
          <span className="scan-step">1 · PRODUCTION LOG <small>{batch.factory} (demo) · knit dyehouse</small></span>
          {log.map((b) => (
            <button key={b.key} aria-pressed={b.key === batch.key} onClick={() => { setKey(b.key); setGtin('') }}>
              <i className="shade-swatch" style={{ background: SHADE[b.batch.shade]?.fill }} />
              <span><b>Lot {lot(b)}</b><small>{dayHm(wall(b.batch.production_start))}–{dayHm(wall(b.batch.production_end)).split(' ').at(-1)} · {SHADE[b.batch.shade]?.name ?? b.batch.shade} shade · {b.fabric.toLowerCase()}</small></span>
            </button>
          ))}
          <p className="scan-note">Several dyeing machines run side by side, so runs can share a time. Simulated records.</p>
        </div>
        <div className="scan-products">
          <span className="scan-step">2 · MADE FROM THIS RUN <small>{batch.fabric}</small></span>
          <div className="product-row">
            {batch.products.map((p) => (
              <button key={p.gtin} aria-pressed={p.gtin === product.gtin} onClick={() => setGtin(p.gtin)}>
                <Garment kind={p.kind} /><span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="scan-tag">
          <span className="scan-step">3 · SCAN ITS TAG</span>
          <div className="tag-stage">
            <Garment kind={product.kind} tag qr={qr} className="tag-garment" />
            <span className="tag-pointer">the QR lives here,<br />on the hang tag<svg viewBox="0 0 80 50" aria-hidden="true"><path d="M74 6Q24 2 10 44M10 44L22 37M10 44L5 30" /></svg></span>
          </div>
          <div className="tag-qr">
            {qr && <img src={qr} alt={`QR code for the ${product.name}, lot ${product.lot}: opens its batch passport`} />}
            <div>
              <b>Point your phone here</b>
              <p>Opens the batch passport for this {product.name.toLowerCase()}.</p>
              <a className="button acid small" href={`#/passport/${batch.key}/${product.gtin}`}>Or open it here <span>↗</span></a>
              <code>GTIN {product.gtin} · Lot {product.lot}</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// the photo (4:5) fills the phone's height (9:19.5), so it is this much wider than the screen
const WIDE = (19.5 / 9) * 0.8 * 100

const STORY = [
  { title: 'Find the hang tag', text: 'Every garment cut from a dye run carries the same code on its tag.' },
  { title: 'Scan it with your phone', text: 'Any camera opens it. There is nothing to install.' },
  { title: 'Read the run’s answer', text: 'The batch passport: what was checked, what was found, and who reviewed it.' },
]

/** The home page's look at scanning: a phone that steps through tag, camera and the real passport page. */
export function PhoneStory() {
  const [batch, setBatch] = useState<CatalogBatch | null>(null)
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [seen, setSeen] = useState(false)  // the passport loads into the phone once it is first shown
  const [qr, setQr] = useState('')
  useEffect(() => { api.catalog().then((l) => setBatch(l.find((b) => b.key === 'B') ?? l[0] ?? null)).catch(() => setBatch(null)) }, [])
  const product = batch?.products[0]
  useEffect(() => { if (product) QRCode.toDataURL(`${location.origin}${product.link}`, { margin: 1, width: 240, color: { dark: '#171735', light: '#f9f9ed' } }).then(setQr) }, [product])
  const ref = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [batch])
  useEffect(() => {  // steps on by itself while it's on screen, until someone picks a step
    if (!auto || !inView) return
    const t = setInterval(() => setStep((s) => (s + 1) % STORY.length), 4200)
    return () => clearInterval(t)
  }, [auto, inView])
  useEffect(() => { if (step === 2) setSeen(true) }, [step])
  if (!batch || !product) return null
  const box = (TAGS as Record<string, { x: number; y: number; w: number; h: number }>)[product.kind]
  const go = (i: number) => { setAuto(false); setStep(i) }
  // where the QR printed on the tag sits on the phone's screen, in % of it: the camera zooms in around it and centres it
  // (the print starts 24% down the card and is as tall as it is wide: 72% of the card's width, the photo being 4:5)
  const ox = 50 + (box.x + box.w / 2 - 0.5) * WIDE, oy = (box.y + box.h * 0.24 + (box.w * 0.72 * 0.8) / 2) * 100
  return (
    <section className="phone-story" ref={ref} aria-label="Scanning a garment's tag">
      <div className="ps-copy">
        <span className="micro">THE PASSPORT ON THE LABEL</span>
        <h2>Scan the tag.<br /><span className="serif">Read the water behind it.</span></h2>
        <p>Garments don’t make wastewater; dye runs do. So every garment cut from a run carries that run’s answer, one scan away.</p>
        <ol className="ps-steps">
          {STORY.map((s, i) => (
            <li key={s.title}><button aria-pressed={i === step} onClick={() => go(i)}><b>{String(i + 1).padStart(2, '0')} · {s.title}</b><span>{s.text}</span></button></li>
          ))}
        </ol>
        <a className="button ink" href="#/trace">Trace a garment <span>↗</span></a>
        <small className="ps-note">Pick a run, pick a garment and scan its real code on the next page. Garment photos are generated with Muse Image.</small>
      </div>
      <div className="ps-phone" aria-hidden={step !== 2}>
        <div className="phone">
          <div className="phone-screen" data-step={step}>
            <div className="ps-screen ps-tag"><Garment kind={product.kind} tag qr={qr} /></div>
            <div className="ps-screen ps-camera">
              {/* the camera framed on the tag: the same photo, close in on it */}
              <div className="ps-zoom" style={{ transformOrigin: `${ox}% ${oy}%`, transform: step === 1 ? `translate(${50 - ox}%, ${50 - oy}%) scale(3.2)` : 'scale(1.4)' }}><Garment kind={product.kind} tag qr={qr} /></div>
              <svg className="ps-finder" viewBox="0 0 100 100"><path d="M4 26V8Q4 4 8 4H26M74 4H92Q96 4 96 8V26M96 74V92Q96 96 92 96H74M26 96H8Q4 96 4 92V74" /></svg><span className="ps-pill">Tellwater batch passport ↗</span>
            </div>
            <div className="ps-screen ps-passport">
              {seen && <iframe title="The batch passport, as it opens on a phone" src={`#/passport/${batch.key}/${product.gtin}`} loading="lazy" />}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function HowTeaser() {
  return (
    <section className="how-teaser" aria-label="How it works">
      <span className="micro">HOW I WORK</span>
      <ol>
        <li><b>01 · The claim</b><p>A factory writes “ETP running normal”. I treat it as a claim to test, never a fact.</p></li>
        <li><b>02 · The investigation</b><p>Muse Spark picks one record at a time, says why, and reads the meters, photos and lab reports. The arithmetic is done in code.</p></li>
        <li><b>03 · The passport</b><p>A person reviews the finding. The signed result travels on the label, and anyone can check it hasn’t been changed.</p></li>
      </ol>
      <a className="text-btn" href="#/how">How it works, in full ↗</a>
    </section>
  )
}
