import type { Step } from './api'

const TOOL: Record<string, string> = {
  get_case_overview: 'Opened the case', update_hypotheses: 'Updated the explanations', get_signal_window: 'Looked at a record',
  compute_water_balance: 'Balanced the water', check_power_vs_load: 'Checked power against load',
  compare_similar_windows: 'Checked for a replayed feed', read_document: 'Read a document',
  check_reading_against_feed: 'Checked a photo against the feed', get_lab_results: 'Read the lab results',
  get_production: 'Read the production plan', submit_assessment: 'Gave the assessment', request_evidence: 'Asked for evidence',
}

type Props = { steps: Step[]; at: number; onPick: (i: number) => void }

/** The investigator's real steps, in order, each with its one-sentence reason. */
export function Trail({ steps, at, onPick }: Props) {
  return (
    <ol className="flex flex-col" aria-label="Investigation trail">
      {steps.map((s, i) => {
        const done = i <= at
        const subject = (s.args.signal as string) ?? (s.args.doc_id as string)?.replace('doc:', '') ?? ''
        return (
          <li key={i}>
            <button onClick={() => onPick(i)} disabled={!done}
              className={`grid w-full grid-cols-[28px_1fr] gap-2 border-l-2 py-1.5 pl-3 text-left transition-opacity ${i === at ? 'border-indigo' : 'border-rule'} ${done ? '' : 'opacity-30'}`}>
              <span className="micro pt-0.5 text-mute">{String(s.n).padStart(2, '0')}</span>
              <span>
                <span className="text-sm font-semibold">{TOOL[s.tool] ?? s.tool}</span>
                {subject && <span className="ml-1.5 text-xs text-mute">{subject}</span>}
                {s.why && i === at && <span className="mt-0.5 block text-sm leading-snug text-ink/80">{s.why}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
