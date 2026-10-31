// The chat in the corner: the whole companion in a tile with a card beside it. Like Bunbun's, its line and its pose follow
// where you are. On the home page it waits for the end of the story, where the companion is happy, and then appears; in a
// case file it appears once the desk the companion sits on is scrolled away, and during a replay it tells each step.
import { useEffect, useState } from 'react'
import { art, NAME, type Mood, type StepLine } from './companion'

export type ChatPage = 'home' | 'case' | 'factory' | 'passport' | 'trace' | 'how' | 'results' | 'report'
const SITUATION: Record<ChatPage, [string, Mood]> = {
  home: ['That’s my story. Questions?', 'found'],
  case: ['Anything in this case', 'calm'],
  factory: ['What a request means', 'asking'],
  passport: ['About this shirt, or me', 'calm'],
  trace: ['I’ll follow any run you pick', 'checking'],
  how: ['How I work, in plain words', 'reading'],
  results: ['What these numbers mean', 'reading'],
  report: ['Anything in this report', 'reading'],
}

export function ChatLauncher({ page, hidden, motion, onOpen }: { page: ChatPage; hidden: boolean; motion: boolean; onOpen: () => void }) {
  const home = page === 'home', inCase = page === 'case'
  // home: shown from the end of the story on; case: shown while the desk is out of view
  const [shown, setShown] = useState(!home && !inCase)
  useEffect(() => {
    if (!home && !inCase) return setShown(true)
    setShown(false)
    let io: IntersectionObserver | null = null
    const watch = () => {  // the story and the case file render after the page does
      const el = document.querySelector(home ? '.road-finish' : '#caseDock')
      if (!el) return false
      io = new IntersectionObserver(([e]) => { if (home) { if (e.isIntersecting) setShown(true) } else setShown(!e.isIntersecting) }, { threshold: 0.5 })
      io.observe(el)
      return true
    }
    const t = watch() ? 0 : window.setInterval(() => { if (watch()) clearInterval(t) }, 400)
    return () => { clearInterval(t); io?.disconnect() }
  }, [home, inCase])
  const [step, setStep] = useState<StepLine | null>(null)
  const [caseMood, setCaseMood] = useState<Mood | null>(null)
  useEffect(() => {
    if (!inCase) return
    const s = (e: Event) => setStep((e as CustomEvent<StepLine | null>).detail)
    const m = (e: Event) => setCaseMood((e as CustomEvent<Mood | null>).detail)
    addEventListener('tw:step', s); addEventListener('tw:mood', m)
    return () => { removeEventListener('tw:step', s); removeEventListener('tw:mood', m) }
  }, [inCase])
  // inside the home page's phone (the passport shown at phone size) there is no chat of its own
  if (hidden || window.self !== window.top || !shown) return null
  const [line, mood] = SITUATION[page]
  return (
    <button className={`chat-launcher${step ? ' telling' : ''}`} onClick={onOpen} aria-label={NAME ? `Ask ${NAME}, the guide` : 'Ask the guide'}>
      {step
        ? <span className="cl-card" aria-live="polite"><b>{step.label}</b><small>{step.line}</small></span>
        : <span className="cl-card"><b>{NAME ? `Ask ${NAME}` : 'Ask me'}</b><small>{line}</small></span>}
      <span className="cl-tile"><img src={art('g1', caseMood ?? mood, motion)} alt="" draggable={false} /><i className="cl-online" /></span>
    </button>
  )
}
