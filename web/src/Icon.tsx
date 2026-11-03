// Line icons in the site's own style: drawn in the text's colour with round caps, sized in em so they follow the
// text around them. They stand in for symbol characters (arrows, a check, a play mark), which phones draw as
// colour emoji.
import type { ReactNode } from 'react'

export type IconName =
  | 'ne' | 'right' | 'left' | 'up' | 'down' | 'play' | 'pause' | 'undo' | 'redo' | 'swap'
  | 'check' | 'minus' | 'circle' | 'chevron' | 'qr' | 'wave'

const PATHS: Record<IconName, ReactNode> = {
  ne: <path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" />,
  right: <path d="M3 8h10M9 4l4 4-4 4" />,
  left: <path d="M13 8H3M7 4 3 8l4 4" />,
  up: <path d="M8 13V3M4 7l4-4 4 4" />,
  down: <path d="M8 3v10M4 9l4 4 4-4" />,
  play: <path d="M5 3.5 12.5 8 5 12.5z" fill="currentColor" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2.2} />,
  undo: <path d="M3.6 8.5a4.5 4.5 0 1 0 1.6-4.1M4.8 1.8v3h3" />,
  redo: <path d="M12.4 8.5a4.5 4.5 0 1 1-1.6-4.1M11.2 1.8v3h-3" />,
  swap: <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  minus: <path d="M3.5 8h9" />,
  circle: <circle cx="8" cy="8" r="4.5" />,
  chevron: <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />,
  qr: <path d="M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11" />,
  wave: <path d="M1.5 8Q3.75 4.5 6 8t4.5 0 4.5 0" />,
}

export function Icon({ n, className }: { n: IconName; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 16 16" width="1em" height="1em" fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[n]}
    </svg>
  )
}
