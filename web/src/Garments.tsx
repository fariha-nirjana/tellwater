// Garment photographs for the label section, the phone story and the passport: one per product, made with
// Muse Image (design/photos/gen.py) in one look, each in its run's dye shade. Generated pictures, not of real stock.
import TAGS from './tags.json'

export const SHADE: Record<string, { fill: string; detail: string; name: string }> = {
  light: { fill: '#dfe3fb', detail: '#9aa2d8', name: 'Light' },
  medium: { fill: '#6c79dc', detail: '#c9cefa', name: 'Medium' },
  dark: { fill: '#2b2f66', detail: '#7d84c8', name: 'Dark' },
}

const NAME: Record<string, string> = {
  tee: 'crew-neck T-shirt', longsleeve: 'long-sleeve T-shirt', 'kids-tee': "kids' T-shirt", polo: "men's polo shirt",
  'polo-w': "women's polo shirt", hoodie: 'hoodie', sweatshirt: 'sweatshirt', joggers: 'joggers',
}
export const photo = (kind: string, tag = false) => `${import.meta.env.BASE_URL}garments/${kind}${tag ? '-tag' : ''}.jpg`

/** The garment's photo; with `tag`, the one with its hang tag, and `qr` (a data URL) printed on the tag. */
export function Garment({ kind, tag = false, qr, className }: { kind: string; shade?: string; tag?: boolean; qr?: string; className?: string }) {
  const box = (TAGS as Record<string, { x: number; y: number; w: number; h: number }>)[kind]
  return (
    <span className={`garment-photo ${className ?? ''}`}>
      <img src={photo(kind, tag)} alt={`A ${NAME[kind] ?? kind} on a hanger${tag ? ', with its hang tag' : ''}`} loading="lazy" draggable={false} />
      {tag && qr && box && (
        // the QR printed on the blank card, a little inside its edges
        <img className="tag-print" src={qr} alt="" aria-hidden="true"
          style={{ left: `${(box.x + box.w * 0.14) * 100}%`, top: `${(box.y + box.h * 0.24) * 100}%`, width: `${box.w * 0.72 * 100}%` }} />
      )}
    </span>
  )
}
