// The home page's middle: scanning a garment's label (batch -> garment -> its tag's QR), and how it works in three beats.
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api, type CatalogBatch } from './api'
import { dayHm, wall } from './evidence'
import { Garment, SHADE } from './Garments'

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
                <Garment kind={p.kind} shade={batch.batch.shade} /><span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="scan-tag">
          <span className="scan-step">3 · SCAN ITS TAG</span>
          <div className="tag-stage">
            <Garment kind={product.kind} shade={batch.batch.shade} tag className="tag-garment" />
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
