// The chat in the corner: the whole companion in a tile with a card beside it, on every page outside the case files (which
// have the companion itself). Like Bunbun's, its line and its pose follow where you are. On the home page it waits for the
// end of the story, where the companion is happy, and then appears.
import { useEffect, useState } from 'react'
import { art, NAME, type Mood } from './companion'

export type ChatPage = 'home' | 'passport' | 'trace' | 'how' | 'results' | 'report'
const SITUATION: Record<ChatPage, [string, Mood]> = {
  home: ['That’s my story. Questions?', 'found'],
  passport: ['About this shirt, or me', 'calm'],
  trace: ['I’ll follow any run you pick', 'checking'],
  how: ['How I work, in plain words', 'reading'],
  results: ['What these numbers mean', 'reading'],
  report: ['Anything in this report', 'reading'],
}

export function ChatLauncher({ page, hidden, motion, onOpen }: { page: ChatPage; hidden: boolean; motion: boolean; onOpen: () => void }) {
  const home = page === 'home'
  const [atEnd, setAtEnd] = useState(false)
  useEffect(() => {
    if (!home) return
    let io: IntersectionObserver | null = null
    const watch = () => {  // the story renders after the page does
      const end = document.querySelector('.road-finish')
      if (!end) return false
      io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setAtEnd(true) }, { threshold: 0.5 })
      io.observe(end)
      return true
    }
    const t = watch() ? 0 : window.setInterval(() => { if (watch()) clearInterval(t) }, 400)
    return () => { clearInterval(t); io?.disconnect() }
  }, [home])
  // inside the home page's phone (the passport shown at phone size) there is no chat of its own
  if (hidden || window.self !== window.top || (home && !atEnd)) return null
  return (
    <button className="chat-launcher" onClick={onOpen} aria-label={NAME ? `Ask ${NAME}, the guide` : 'Ask the guide'}>
      <span className="cl-card"><b>{NAME ? `Ask ${NAME}` : 'Ask me'}</b><small>{SITUATION[page][0]}</small></span>
      <span className="cl-tile"><img src={art('g1', SITUATION[page][1], motion)} alt="" draggable={false} /><i className="cl-online" /></span>
    </button>
  )
}
