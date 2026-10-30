// The chat in the corner: the companion's face in a speech bubble, on every page outside the case files (which have the
// companion itself). On the home page it waits for the end of the story, where the companion is happy, and then appears.
import { useEffect, useState } from 'react'
import { art } from './companion'

export function ChatLauncher({ home, hidden, onOpen }: { home: boolean; hidden: boolean; onOpen: () => void }) {
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
    <button className="chat-launcher" onClick={onOpen} aria-label="Ask the guide">
      <span className="cl-label">Ask me</span>
      <span className="cl-face"><img src={art('g1', 'calm', true)} alt="" draggable={false} /></span>
    </button>
  )
}
