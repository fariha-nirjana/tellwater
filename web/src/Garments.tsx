// Garment drawings for the label section and the passport, in the hero shirt's line style,
// filled with the batch's dye shade. Illustrations, not product photos.
import type { ReactNode } from 'react'

export const SHADE: Record<string, { fill: string; detail: string; name: string }> = {
  light: { fill: '#dfe3fb', detail: '#9aa2d8', name: 'Light' },
  medium: { fill: '#6c79dc', detail: '#c9cefa', name: 'Medium' },
  dark: { fill: '#2b2f66', detail: '#7d84c8', name: 'Dark' },
}

const TEE = 'M137 55L76 89 14 180 98 225 125 185 112 415Q218 443 331 415L318 185 345 225 427 180 367 88 304 55Q220 113 137 55Z'
const LONG = 'M137 55L76 89 26 330 92 346 125 185 112 415Q218 443 331 415L318 185 350 346 416 330 367 88 304 55Q220 113 137 55Z'
const FITTED = 'M137 55L76 89 20 172 98 212 128 182 118 300Q108 355 118 415Q218 440 322 415Q332 355 322 300L312 182 342 212 420 172 367 88 304 55Q220 113 137 55Z'
const JOGGERS = 'M138 40H302L326 392Q328 412 312 416L262 420Q248 420 246 404L226 168Q220 158 214 168L194 404Q192 420 178 420L128 416Q112 412 114 392Z'

function body(kind: string) {
  // the details each garment is recognised by
  const extra: Record<string, ReactNode> = {
    tee: <path d="M137 55Q160 141 220 140Q281 139 304 55M128 180L147 86M317 180L293 84M123 402Q220 427 321 402" />,
    'kids-tee': <path d="M137 55Q160 141 220 140Q281 139 304 55M128 180L147 86M317 180L293 84M123 402Q220 427 321 402" />,
    longsleeve: <path d="M137 55Q160 141 220 140Q281 139 304 55M30 312L94 328M346 328L412 312M123 402Q220 427 321 402" />,
    polo: <><path d="M137 55L176 104 220 78 264 104 304 55M220 78V176M128 180L147 86M317 180L293 84M123 402Q220 427 321 402" /><circle cx="220" cy="118" r="4" /><circle cx="220" cy="148" r="4" /></>,
    'polo-w': <><path d="M137 55L176 104 220 78 264 104 304 55M220 78V160M126 300Q220 318 314 300" /><circle cx="220" cy="114" r="4" /><circle cx="220" cy="140" r="4" /></>,
    hoodie: <path d="M146 62Q150 6 220 4Q290 6 294 62M196 96V160M244 96V160M150 300H290L306 372H134ZM30 312L94 328M346 328L412 312M120 396Q220 420 323 396" />,
    sweatshirt: <path d="M137 55Q160 120 220 119Q281 118 304 55M30 312L94 328M346 328L412 312M119 390Q220 414 324 390M150 398V418M190 402V424M230 403V425M270 401V423M300 397V417" />,
    joggers: <path d="M138 40H302M138 66H302M200 40V80M240 40V80M122 368L194 376M246 376L318 368" />,
  }
  return extra[kind]
}

export function Garment({ kind, shade = 'medium', tag = false, className }: { kind: string; shade?: string; tag?: boolean; className?: string }) {
  const s = SHADE[shade] ?? SHADE.medium
  const d = kind === 'joggers' ? JOGGERS : kind === 'longsleeve' || kind === 'hoodie' || kind === 'sweatshirt' ? LONG : kind === 'polo-w' ? FITTED : TEE
  const small = kind === 'kids-tee'
  return (
    <svg className={className} viewBox="0 0 440 470" role="img" aria-label={`${kind.replace('-', ' ')} illustration`}>
      <g transform={small ? 'translate(66 70) scale(.7)' : undefined}>
        {kind === 'hoodie' && <path d="M146 62Q150 6 220 4Q290 6 294 62Z" fill={s.fill} stroke="#171735" strokeWidth="3" />}
        <path d={d} fill={s.fill} stroke="#171735" strokeWidth="3" strokeLinejoin="round" />
        <path d={d} fill="url(#weave)" opacity=".18" />
        <g fill="none" stroke={s.detail} strokeWidth="2.5" strokeLinecap="round">{body(kind)}</g>
        {tag && (
          // the hang tag, tied at the neck or waistband: where the QR lives
          <g className="hang-tag">
            <path d={kind === 'joggers' ? 'M290 60Q330 80 338 128' : 'M290 74Q332 96 340 150'} fill="none" stroke="#4945ff" strokeWidth="3" strokeDasharray="5 5" />
            <g transform={`rotate(8 ${kind === 'joggers' ? 340 : 342} ${kind === 'joggers' ? 170 : 192})`}>
              <rect id="tagAnchor" x={kind === 'joggers' ? 312 : 314} y={kind === 'joggers' ? 128 : 150} width="58" height="82" rx="5" fill="#f9f9ed" stroke="#171735" strokeWidth="2.5" />
              <g fill="#171735">
                {[0, 1, 2, 3, 4].flatMap((r) => [0, 1, 2, 3, 4].map((c) => ((r * 7 + c * 3) % 4 !== 1 || r === c) ?
                  <rect key={`${r}${c}`} x={(kind === 'joggers' ? 323 : 325) + c * 7} y={(kind === 'joggers' ? 140 : 162) + r * 7} width="6" height="6" /> : null))}
              </g>
              <text x={kind === 'joggers' ? 322 : 324} y={kind === 'joggers' ? 198 : 220} fontSize="9" fontFamily="Arial" fontWeight="bold" fill="#4945ff">SCAN ME</text>
            </g>
          </g>
        )}
      </g>
    </svg>
  )
}
