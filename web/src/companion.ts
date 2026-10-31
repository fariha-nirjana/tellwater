// What the companion is doing, told by the page that knows: the case file (which step the investigation is on)
// and the guide (while it writes an answer). The art lives in public/companion, drawn by design/mascot/moods.py.
/** The companion's name, once it has one: the corner chat then reads "Ask <name>". */
export const NAME = ''

export type Mood = 'calm' | 'reading' | 'checking' | 'asking' | 'found' | 'cant-tell' | 'walk'
export type Cloth = 'g1' | 'g2'  // white gamchha, or acid gamchha for purple sections

export const MOODS: Mood[] = ['calm', 'reading', 'checking', 'asking', 'found', 'cant-tell', 'walk']
export const art = (cloth: Cloth, mood: Mood, motion: boolean) =>
  `${import.meta.env.BASE_URL}companion/${cloth}-${mood}${motion ? '' : '-still'}.svg`

/** The case file's mood for the companion; null hands it back to calm. */
export const setMood = (mood: Mood | null) => { dispatchEvent(new CustomEvent('tw:mood', { detail: mood })) }
/** The step a replay is on, for the corner card once the case file's desk is out of view; null when nothing plays. */
export type StepLine = { label: string; line: string }
export const setStepLine = (step: StepLine | null) => { dispatchEvent(new CustomEvent('tw:step', { detail: step })) }
/** The guide is writing an answer: the companion reads meanwhile. */
export const setGuideBusy = (busy: boolean) => { dispatchEvent(new CustomEvent('tw:guide-busy', { detail: busy })) }

// investigation tools that check a signal (the rest read documents and records)
const SIGNAL_TOOLS = new Set(['get_signal_window', 'compute_water_balance', 'check_power_vs_load', 'compare_similar_windows', 'check_reading_against_feed'])
export const toolMood = (tool: string): Mood => tool === 'request_evidence' ? 'asking' : SIGNAL_TOOLS.has(tool) ? 'checking' : 'reading'
