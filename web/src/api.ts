// Types and fetchers for the Tellwater API (api/app.py).

export type Status = 'supports' | 'contradicts' | 'review_required' | 'insufficient'
export type PublishedStatus = Status | 'pending_review'
export type CaseKey = 'A' | 'B' | 'C' | 'D' | 'E'
// a case, or its view with the logbook pages in Bangla (read-only)
export type ViewKey = CaseKey | `${CaseKey}-bn`

export type Line = { index: number; time: string; text: string; en?: string; crossed_out: boolean; box: { x_min: number; y_min: number; x_max: number; y_max: number } }
export type Doc = {
  id: string; type: string; author: string; is_claim: boolean; covers: [string, string]; received_at: string
  image: string | null; content: Record<string, unknown> | null; lines: Line[] | null
}
export type SignalInfo = Record<string, [string, string]>
export type Overview = {
  case_id: string
  batch: { id: string; production_start: string; production_end: string; shade: string; planned_wastewater_m3: number }
  treatment_interval: { start: string; end: string; basis: string }
  case_data_range: { start: string; end: string }
  signals: Record<string, { name: string; unit: string; coverage_of_treatment_interval: number; gaps: [string, string][] }>
  [k: string]: unknown
}
export type Submission = { signal: string; file: string; note: string; at: string; covers: [string, string] }
export type Reply = { note: string; at: string }
export type Review = { action: 'approve' | 'change' | 'return'; status: Status | null; reason: string; reviewer: string; at: string }
export type SecondReader = { model: string; status: Status; summary: string; agrees: boolean }
export type CaseFile = {
  key: ViewKey; overview: Overview; documents: Doc[]; signals: SignalInfo; submission: Submission | null; review: Review[] | null
  replies: Reply[]; logbook_language: 'en' | 'bn'; bangla_view: boolean
  second_reader: SecondReader | null
  awaiting_person: boolean
}

export type Explanation = { id: string; label: string; supporting: string[]; contradicting: string[]; missing: string[]; status: 'open' | 'supported' | 'contradicted' }
export type Step = { n: number; tool: string; args: Record<string, unknown>; why: string | null; result: Record<string, unknown>; t: number }
export type Final = {
  kind: 'assessment' | 'evidence_request'; status?: Status; summary?: string; explanations?: Explanation[]
  key_evidence?: { id: string; why: string }[]; scope_line?: string; limitations?: string[]
  evidence_request?: { items?: string[]; interval?: string; reason?: string } | string | null
  items?: string[]; interval?: [string, string]; reason?: string
}
export type Trace = { case_id: string; model: string; steps: Step[]; ledger: Explanation[][]; final: Final | null; status: Status | null; valid: boolean; seconds: number; checks_used: number; cost_usd: number | null }
export type Series = { times: string[]; series: Record<string, (number | null)[]>; power_band_half_width_kw?: number }
export type Product = { gtin: string; lot: string; name: string; link: string; kind: string; fabric: string }
export type CatalogBatch = { key: CaseKey; batch: Overview['batch']; factory: string; fabric: string; products: Product[] }
export type SignedRecord = {
  issued_at: string; status: Status; product: Product
  evidence: { items: { id: string; sha256: string }[]; root: string }
  investigation: { sha256: string; model: string | null; finished_at: string | null; checks: number | null; citations_validated: boolean | null }
  proof: { alg: string; key_id: string; signature: string }
  [k: string]: unknown
}
export type Verification = {
  signature_valid: boolean; key_id: string; evidence_matches: boolean; changed: string[]; missing: string[]; added: string[]
  items: number; investigation_matches: boolean
}
export type Allowance = { left: number; per_visitor: number; live: boolean }
export type Limits = { runs: Allowance; questions: Allowance; voice: Allowance }
export type Passport = {
  batch: Overview['batch']; product: Product; products: Product[]; scanned: boolean; status: PublishedStatus | null; assessed_status: Status | null; summary: string | null
  held?: { reason: 'two_readers_disagree' }
  scope_line: string | null; limitations: string[]; key_evidence: { id: string; why: string }[]; review: Review | null
  record: SignedRecord | null; verification: Verification | null; disclosure: string
  evidence_request: { items?: string[]; interval?: string; reason?: string } | null; treatment_interval: [string, string]
  garment: { composition: string; care: string[]; origin: string; factory: string; reuse_share: number | null }
  lab: { sample_time: string; sample_point: string; bod_mg_l: number; bod_limit_mg_l: number; ph: number; evidence_id: string }[]
  investigation: { model: string | null; checks: number | null; seconds: number | null; finished_at: string | null; citations_validated: boolean | null }
  reviews: Review[]
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}

export const api = {
  cases: () => get<{ key: CaseKey; case_id: string; batch: string; status: PublishedStatus; summary: string | null }[]>('/api/cases'),
  case: (k: ViewKey) => get<CaseFile>(`/api/cases/${k}`),
  signals: (k: ViewKey, start?: string, end?: string, step = 15) =>
    get<Series>(`/api/cases/${k}/signals?step=${step}${start ? `&start=${start}` : ''}${end ? `&end=${end}` : ''}`),
  trace: (k: ViewKey, which: 'saved' | 'after' = 'saved') => get<Trace>(`/api/cases/${k}/trace?which=${which}`),
  passport: (k: CaseKey, gtin?: string) => get<Passport>(`/api/passport/${k}${gtin ? `?gtin=${gtin}` : ''}`),
  catalog: () => get<CatalogBatch[]>('/api/catalog'),
  languages: () => get<Record<string, string>>('/api/passport-languages'),
  limits: () => get<Limits>('/api/limits'),
  results: () => get<Record<string, Record<string, Record<string, unknown>>>>('/api/results'),
  submitSample: async (k: CaseKey, note: string) => {
    const body = new FormData()
    body.set('signal', 'T1'); body.set('sample', 'true'); body.set('note', note)
    const r = await fetch(`/api/cases/${k}/evidence`, { method: 'POST', body })
    if (!r.ok) throw new Error('submission failed')
    return r.json()
  },
  clearSubmission: (k: CaseKey) => fetch(`/api/cases/${k}/evidence`, { method: 'DELETE' }),
  transcribeVoice: async (audio: Blob, signal: AbortSignal) => {
    const body = new FormData()
    body.set('audio', audio, 'reply.wav')
    const fallback = 'Voice transcription failed. Try again or type your reply.'
    let r: Response
    try { r = await fetch('/api/voice/transcribe', { method: 'POST', body, signal }) }
    catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new Error(fallback) }
    const result = await r.json().catch(() => null)
    if (!r.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : fallback)
    if (typeof result?.transcript !== 'string' || !result.transcript.trim()) throw new Error(fallback)
    return result as { transcript: string; model: string; seconds: number }
  },
  reply: async (k: CaseKey, note: string) => {
    const r = await fetch(`/api/cases/${k}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) })
    if (!r.ok) throw new Error((await r.json()).detail ?? 'reply failed')
    return r.json() as Promise<Reply>
  },
  clearReplies: (k: CaseKey) => fetch(`/api/cases/${k}/reply`, { method: 'DELETE' }),
  review: async (k: CaseKey, r: { action: string; status?: Status; reason: string }) => {
    const res = await fetch(`/api/cases/${k}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'review failed')
    return res.json() as Promise<Review>
  },
}

export const STATUS_LABEL: Record<Status, string> = {
  supports: 'Evidence supports the treatment claim',
  contradicts: 'Evidence contradicts the claim',
  review_required: 'Review required',
  insufficient: 'Insufficient evidence',
}
