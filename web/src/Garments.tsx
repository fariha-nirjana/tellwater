import { useState } from 'react'
// Garment photographs for the label section, the phone story and the passport: one per product, made with
// Muse Image (design/photos/gen.py) in one look, each in its run's dye shade. Generated pictures, not of real stock.
import TAGS from './tags.json'

export const SHADE: Record<string, { fill: string; detail: string; name: string }> = {
  light: { fill: '#c9d3ef', detail: '#9aaacf', name: 'Light' },
  medium: { fill: '#57372b', detail: '#af8971', name: 'Medium' },
  dark: { fill: '#2b2f66', detail: '#7d84c8', name: 'Dark' },
}

const NAME: Record<string, string> = {
  tee: 'crew-neck T-shirt', longsleeve: 'long-sleeve T-shirt', 'kids-tee': "kids' T-shirt", polo: "men's polo shirt",
  'polo-w': "women's polo shirt", hoodie: 'hoodie', sweatshirt: 'sweatshirt', joggers: 'joggers',
}
export const photoKind = (kind: string, shade?: string) => shade === 'light' && ['tee', 'longsleeve'].includes(kind) ? `${kind}-light` : kind
export const photo = (kind: string, tag = false, shade?: string) => `${import.meta.env.BASE_URL}garments/${photoKind(kind, shade)}${tag ? '-tag' : ''}.jpg`

/** The garment's photo; with `tag`, the one with its hang tag, and `qr` (a data URL) printed on the tag. */
export function Garment({ kind, shade, tag = false, qr, className }: { kind: string; shade?: string; tag?: boolean; qr?: string; className?: string }) {
  const box = (TAGS as Record<string, { x: number; y: number; w: number; h: number }>)[photoKind(kind, shade)]
  const src = photo(kind, tag, shade)
  // the QR is placed on this photo's tag, so it waits until this photo (not the previous garment's) has loaded
  const [loaded, setLoaded] = useState('')
  return (
    <span className={`garment-photo ${className ?? ''}`}>
      <img src={src} alt={`A ${NAME[kind] ?? kind} on a hanger${tag ? ', with its hang tag' : ''}`} loading={tag ? 'eager' : 'lazy'} draggable={false}
        onLoad={() => setLoaded(src)} ref={(el) => { if (el?.complete && el.naturalWidth && loaded !== src) setLoaded(src) }} />
      {tag && qr && box && loaded === src && (
        // the QR printed on the blank card, a little inside its edges
        <img className="tag-print" src={qr} alt="" aria-hidden="true"
          style={{ left: `${(box.x + box.w * 0.14) * 100}%`, top: `${(box.y + box.h * 0.24) * 100}%`, width: `${box.w * 0.72 * 100}%` }} />
      )}
    </span>
  )
}
