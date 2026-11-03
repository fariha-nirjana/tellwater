// The factory's own page (#/factory): the requests its buyers sent, what the buyers' checks found run by run, and which of
// its records reach Tellwater. The factory answers here, with the record asked for or a reply to a finding; it can't see
// the buyer's review notes, change an answer or sign a passport. English by default, Bangla on request.
import { useCallback, useEffect, useState } from 'react'
import { api, STATUS_LABEL, type CaseFile as CF, type CatalogBatch, type Passport, type Status, type Trace } from './api'
import { LETTER_LANGS, type LetterLang } from './Dialogs'
import { dayHm, hm, wall } from './evidence'
import { SHADE } from './Garments'
import { ORDER } from './Timeline'
import { VoiceReply } from './VoiceReply'

type Lang = 'en' | 'bn'
const EN = {
  label: 'FACTORY VIEW', lede: 'Requests from your buyers, the dye runs they’ve checked, and the records that answer them.',
  requests: 'Requests from buyers', open: (n: number) => (n === 1 ? 'One open request' : n ? `${n} open requests` : 'No open requests'),
  waiting: 'Waiting for your record', checking: 'Record sent, checked again', from: 'From the buyer’s reviewer',
  forRun: 'For dye run', timeNeeded: 'Time needed', why: 'Why', next: 'What happens next', byMuse: 'written by Muse Spark',
  nextText: 'Your record is checked against the plant’s other records. If it agrees with them, the answer can change.',
  file: 'tank-level-13-oct.csv', fileNote: 'Demo file · time and level, one reading every 15 minutes',
  note: 'Note to the buyer', noteDefault: 'Tank level log from the ETP control room.', send: 'Send the record', sending: 'Sending…',
  letter: 'Read the request as a letter', letterIn: 'Read it in',
  sent: (f: string, at: string) => `You sent ${f} on ${at}. The investigation ran again with it.`,
  nowAnswer: 'The answer now', seeBuyer: 'See it as the buyer', takeBack: 'Take the record back (resets the demo)',
  runs: 'Our dye runs', runsSub: 'What your buyers’ checks found, run by run', run: 'RUN', answer: 'ANSWER', can: 'WHAT YOU CAN DO',
  oneMissing: 'One record missing', shared: 'Shared with you by the buyer', sendIt: (x: string) => `Send the ${x}`,
  passport: 'See the passport', reply: 'Reply to the buyer', nothing: 'Nothing needed', sentNote: 'Your record arrived',
  replyLabel: 'Your reply', replyHint: 'The buyer sees it beside the case. It doesn’t change the answer.', replySend: 'Send the reply',
  replies: 'Your replies', clearReplies: 'Clear replies (resets the demo)', cancel: 'Cancel',
  records: 'Our records', recordsSub: 'Each meter’s record over each run’s treatment window',
  live: 'sending', partly: 'partly', missing: 'missing', onFile: 'on file', none: 'none',
  lab: 'Lab report', logbook: 'Logbook',
  cant: 'The factory can’t see the buyer’s review notes, can’t change an answer, and can’t sign a passport. A record it sends still counts as the factory’s word until it agrees with the plant’s other records.',
  loading: 'Opening the factory’s page…', shade: 'shade', signedIn: 'Showing:',
}
// The factory page in Bangla, drafted alongside the English
const BN: typeof EN = {
  label: 'কারখানার ভিউ', lede: 'ক্রেতাদের অনুরোধ, তাদের যাচাই করা ডাই রান, আর যে রেকর্ড দিয়ে এর উত্তর দেওয়া যায়।',
  requests: 'ক্রেতাদের অনুরোধ', open: (n: number) => (n ? `${n}টি খোলা অনুরোধ` : 'কোনো খোলা অনুরোধ নেই'),
  waiting: 'আপনার রেকর্ডের অপেক্ষায়', checking: 'রেকর্ড পাঠানো হয়েছে, আবার যাচাই হয়েছে', from: 'ক্রেতার রিভিউয়ারের কাছ থেকে',
  forRun: 'ডাই রান', timeNeeded: 'যে সময়ের রেকর্ড দরকার', why: 'কেন', next: 'এরপর কী হবে', byMuse: 'Muse Spark-এর লেখা',
  nextText: 'আপনার রেকর্ড প্ল্যান্টের অন্য রেকর্ডগুলোর সাথে মিলিয়ে দেখা হবে। মিললে উত্তর বদলাতে পারে।',
  file: 'tank-level-13-oct.csv', fileNote: 'ডেমো ফাইল · সময় আর লেভেল, প্রতি ১৫ মিনিটে একটি রিডিং',
  note: 'ক্রেতার জন্য নোট', noteDefault: 'ETP কন্ট্রোল রুমের ট্যাংক লেভেল লগ।', send: 'রেকর্ড পাঠান', sending: 'পাঠানো হচ্ছে…',
  letter: 'অনুরোধটি চিঠি হিসেবে পড়ুন', letterIn: 'যে ভাষায় পড়বেন',
  sent: (f: string, at: string) => `আপনি ${at}-এ ${f} পাঠিয়েছেন। এটি নিয়ে তদন্ত আবার চালানো হয়েছে।`,
  nowAnswer: 'এখনকার উত্তর', seeBuyer: 'ক্রেতার চোখে দেখুন', takeBack: 'রেকর্ড ফিরিয়ে নিন (ডেমো রিসেট)',
  runs: 'আমাদের ডাই রান', runsSub: 'প্রতিটি রানে ক্রেতার যাচাইয়ে কী পাওয়া গেছে', run: 'রান', answer: 'উত্তর', can: 'আপনি যা করতে পারেন',
  oneMissing: 'একটি রেকর্ড পাওয়া যাচ্ছে না', shared: 'ক্রেতা আপনার সাথে শেয়ার করেছেন', sendIt: (x: string) => `${x} পাঠান`,
  passport: 'পাসপোর্ট দেখুন', reply: 'ক্রেতাকে উত্তর দিন', nothing: 'কিছু করার নেই', sentNote: 'আপনার রেকর্ড পৌঁছেছে',
  replyLabel: 'আপনার উত্তর', replyHint: 'ক্রেতা এটি কেসের পাশে দেখবেন। এতে উত্তর বদলায় না।', replySend: 'উত্তর পাঠান',
  replies: 'আপনার উত্তর', clearReplies: 'উত্তর মুছে দিন (ডেমো রিসেট)', cancel: 'বাতিল',
  records: 'আমাদের রেকর্ড', recordsSub: 'প্রতিটি রানের শোধনের সময়ে প্রতিটি মিটারের রেকর্ড',
  live: 'আসছে', partly: 'আংশিক', missing: 'নেই', onFile: 'আছে', none: 'নেই',
  lab: 'ল্যাব রিপোর্ট', logbook: 'লগবুক',
  cant: 'কারখানা ক্রেতার রিভিউ নোট দেখতে পারে না, উত্তর বদলাতে পারে না, পাসপোর্টে সই করতে পারে না। কারখানার পাঠানো রেকর্ড প্ল্যান্টের অন্য রেকর্ডের সাথে না মেলা পর্যন্ত কারখানার কথা হিসেবেই গণ্য হয়।',
  loading: 'কারখানার পাতা খোলা হচ্ছে…', shade: 'শেড', signedIn: 'যে কারখানা হিসেবে',
}
const STATUS_BN: Record<Status, string> = {
  supports: 'প্রমাণ শোধনের দাবি সমর্থন করে', contradicts: 'প্রমাণ দাবির বিরোধিতা করে', review_required: 'রিভিউ দরকার', insufficient: 'প্রমাণ যথেষ্ট নয়',
}
const SHADE_BN: Record<string, string> = { light: 'হালকা', medium: 'মাঝারি', dark: 'গাঢ়' }
const SIGNAL_BN: Record<string, string> = {
  S1: 'ইনটেক ফ্লো', T1: 'ট্যাংক লেভেল', S2: 'ETP ইনফ্লো', S3: 'ETP বিদ্যুৎ', S4a: 'আউটফল ফ্লো', S4b: 'আউটফল pH', S4c: 'কন্ডাক্টিভিটি',
}

type Ask = { items: string[]; interval: string | [string, string] | null; reason: string | null }
// the buyer's request stays in the saved investigation, also after the factory has answered it
type Run = { b: CatalogBatch; p: Passport; c: CF; ask: Ask | null }
const askOf = (t: Trace): Ask | null => {
  const f = t.final
  const r = f?.kind === 'evidence_request' ? f : typeof f?.evidence_request === 'object' ? f?.evidence_request : null
  return r ? { items: r.items ?? [], interval: r.interval ?? null, reason: r.reason ?? null } : null
}

export function Factory({ which }: { which: 'A' | 'B' }) {
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem('tw:factory-lang') === 'bn' ? 'bn' : 'en' } catch { return 'en' } })
  const choose = (l: Lang) => { setLang(l); try { localStorage.setItem('tw:factory-lang', l) } catch { /* private window */ } }
  const t = lang === 'bn' ? BN : EN
  const [runs, setRuns] = useState<Run[] | null>(null)
  const load = useCallback(async () => {
    // a factory sees only its own runs
    const cat = (await api.catalog()).filter((b) => b.factory === `Factory ${which}`)
    setRuns(await Promise.all(cat.map(async (b) => ({ b, p: await api.passport(b.key), c: await api.case(b.key), ask: askOf(await api.trace(b.key)) }))))
  }, [which])
  useEffect(() => { load() }, [load])
  if (!runs) return <section className="fv"><p className="loading">{t.loading}</p></section>

  const status = (s: Passport['status']) => (s === 'pending_review' ? 'Held for review' : s ? (lang === 'bn' ? STATUS_BN[s] : STATUS_LABEL[s]) : '–')
  const shade = (s: string) => lang === 'bn' ? `${SHADE_BN[s] ?? s} ${t.shade}` : SHADE[s]?.name ?? s
  const sigName = (c: CF, sig: string) => (lang === 'bn' ? SIGNAL_BN[sig] : c.signals[sig]?.[0]?.replace('Equalization tank level', 'Tank level').replace('Outfall conductivity', 'Conductivity')) ?? sig
  // a request is open from the buyer's evidence request until the factory sends a record for it
  const asked = runs.filter((r) => r.ask && !r.c.awaiting_person)
  const open = asked.filter((r) => !r.c.submission).length
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <section className="fv" lang={lang}>
      <div className="fv-head">
        <div><span className="micro">{t.label}</span><h1>{runs[0].p.garment.factory}</h1><p>{t.lede}</p></div>
        <div className="fv-tools">
        <div className="fv-who" role="group" aria-label={t.signedIn}>
          <span>{t.signedIn}</span>
          <a href="#/factory" aria-pressed={which === 'A'}>Factory A</a>
          <a href="#/factory/b" aria-pressed={which === 'B'}>Factory B</a>
        </div>
        <div className="fv-lang" role="group" aria-label="Language">
          <button aria-pressed={lang === 'en'} lang="en" onClick={() => choose('en')}>English</button>
          <button aria-pressed={lang === 'bn'} lang="bn" onClick={() => choose('bn')}>বাংলা</button>
        </div>
        </div>
      </div>
      <div className="fv-grid">
        <section className="fv-card" id="fv-requests">
          <h2>{t.requests}</h2><p className="fv-sub">{t.open(open)}</p>
          {asked.map((r) => <Request key={r.b.key} run={r} t={t} status={status} shade={shade} onChange={load} />)}
        </section>
        <div className="fv-side">
          <section className="fv-card" id="fv-runs">
            <h2>{t.runs}</h2><p className="fv-sub">{t.runsSub}</p>
            <table className="fv-table"><thead><tr><th>{t.run}</th><th>{t.answer}</th><th>{t.can}</th></tr></thead>
              <tbody>{runs.map((r) => <RunRow key={r.b.key} run={r} t={t} status={status} shade={shade} onRequest={() => jump('fv-requests')} onChange={load} />)}</tbody></table>
          </section>
          <section className="fv-card" id="fv-records">
            <h2>{t.records}</h2><p className="fv-sub">{t.recordsSub}</p>
            <table className="fv-table fv-coverage">
              <thead><tr><th />{runs.map((r) => <th key={r.b.key}><i className="fv-swatch" style={{ background: SHADE[r.b.batch.shade]?.fill }} />{r.b.products[0].lot.split('-').at(-1)}<small>{shade(r.b.batch.shade)}</small></th>)}</tr></thead>
              <tbody>
                {ORDER.map((sig) => (
                  <tr key={sig}><td><code>{sig}</code> {sigName(runs[0].c, sig)}</td>
                    {runs.map((r) => {
                      const cov = r.c.overview.signals[sig]?.coverage_of_treatment_interval ?? 0
                      const [cls, word] = cov >= 0.9 ? ['ok', t.live] : cov > 0 ? ['part', t.partly] : ['miss', t.missing]
                      return <td key={r.b.key} className={`fv-cov ${cls}`}><i />{word}</td>
                    })}</tr>
                ))}
                {(['lab_report', 'logbook'] as const).map((type) => (
                  <tr key={type}><td>{type === 'lab_report' ? t.lab : t.logbook}</td>
                    {runs.map((r) => {
                      const has = r.c.documents.some((d) => d.type === type)
                      return <td key={r.b.key} className={`fv-cov ${has ? 'ok' : 'none'}`}><i />{has ? t.onFile : t.none}</td>
                    })}</tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
      <p className="fv-cant">{t.cant}</p>
    </section>
  )
}

type RowProps = { run: Run; t: typeof EN; status: (s: Passport['status']) => string; shade: (s: string) => string; onChange: () => void }

function WithBuyer() {
  return <span className="fv-with-buyer" lang="en"><span className="fv-review-pill">With a person at the buyer</span><small>The automatic checks didn't agree on this run, so a person at the buyer is looking before anything is published. Sending your maintenance record or meter photos can help them decide.</small></span>
}

function Request({ run: { b, p, c, ask }, t, status, shade, onChange }: RowProps) {
  const [note, setNote] = useState(t.noteDefault)
  useEffect(() => setNote((old) => old === EN.noteDefault || old === BN.noteDefault ? t.noteDefault : old), [t])
  const [busy, setBusy] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [error, setError] = useState('')
  const [letter, setLetter] = useState<{ bn: string; en: string; note: string } | null>(null)
  const [letterLang, setLetterLang] = useState<LetterLang>('en')
  const req = ask
  const sub = c.submission
  const [from, to] = (Array.isArray(req?.interval) ? req.interval : (req?.interval ?? '').split(' to ')).filter(Boolean).map(wall)
  const send = async () => {
    setBusy(true); setError('')
    try { await api.submitSample(b.key, note); try { sessionStorage.setItem('tw:replay-after', b.key) } catch { /* private window */ } onChange() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const readLetter = async () => {
    const r = await fetch(`/api/cases/${b.key}/letter`, { method: 'POST' })
    const d = await r.json()
    setLetter(r.ok ? d : { bn: '', en: '', note: d.detail ?? String(r.status) })
  }
  return (
    <article className="fv-req">
      <div className="fv-req-top"><span className={`fv-pill ${sub ? 'done' : 'wait'}`}>{sub ? t.checking : t.waiting}</span><span className="fv-from">{t.from}</span></div>
      <h3>{(req?.items ?? []).join(', ')}</h3>
      <dl>
        <dt>{t.forRun}</dt><dd>Lot {b.products[0].lot} · {shade(b.batch.shade)} · {b.fabric.toLowerCase()}</dd>
        {from && to && <><dt>{t.timeNeeded}</dt><dd>{from.toDateString() === to.toDateString() ? `${dayHm(from)}–${hm(to)}` : `${dayHm(from)} – ${dayHm(to)}`}</dd></>}
        {req?.reason && <><dt>{t.why}</dt><dd lang="en">{req.reason} <span className="fv-muse">· {t.byMuse}</span></dd></>}
        {!sub && <><dt>{t.next}</dt><dd>{t.nextText}</dd></>}
      </dl>
      {sub ? (
        <div className="fv-sent">
          <p>{t.sent(sub.file, dayHm(wall(sub.at)))}</p>
          <p className="fv-now">{t.nowAnswer}: <b>{status(p.status)}</b></p>
          <div className="fv-actions">
            <a className="button ink small" href={`#/case/${b.key}`}>{t.seeBuyer} <span>↗</span></a>
            <button className="text-btn" onClick={async () => { await api.clearSubmission(b.key); onChange() }}>{t.takeBack} ↺</button>
          </div>
        </div>
      ) : (
        <>
          <div className="fv-upload"><div><b>{t.file}</b><small>{t.fileNote}</small></div></div>
          <label className="fv-label" htmlFor={`note-${b.key}`}>{t.note}</label>
          <textarea id={`note-${b.key}`} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} aria-describedby={`note-${b.key}-voice-status`} />
          <VoiceReply fieldId={`note-${b.key}`} disabled={busy} onBusyChange={setVoiceBusy} onTranscript={(text) => setNote((old) => old.trim() ? `${old.trimEnd()}\n${text}` : text)} />
          {error && <p className="form-error">{error}</p>}
          <div className="fv-actions">
            <button className="button acid small" disabled={busy || voiceBusy} onClick={send}>{busy ? t.sending : t.send} <span>↗</span></button>
            <button className="text-btn" onClick={readLetter}>{t.letter} ↗</button>
          </div>
          {letter && (letter.bn ? (
            <div className="fv-letter">
              <div className="letter-lang" role="group" aria-label={t.letterIn}>
                <span>{t.letterIn}</span>
                {LETTER_LANGS.map(([code, name]) => <button key={code} lang={code} aria-pressed={letterLang === code} onClick={() => setLetterLang(code)}>{name}</button>)}
              </div>
              <p lang={letterLang}>{letter[letterLang]}</p><small lang="en">{letter.note}</small>
            </div>
          ) : <p className="form-error">{letter.note}</p>)}
        </>
      )}
    </article>
  )
}

function RunRow({ run: { b, p, c, ask }, t, status, shade, onRequest, onChange }: RowProps & { onRequest: () => void }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const s = p.status
  const needsPerson = c.awaiting_person
  const finding = needsPerson || s === 'contradicts' || s === 'review_required'
  const send = async () => {
    if (sending || voiceBusy || !text.trim() || text.length > 1200) return
    setError(''); setSending(true)
    try { await api.reply(b.key, text); setText(''); setWriting(false); onChange() } catch (e) { setError((e as Error).message) }
    finally { setSending(false) }
  }
  return (
    <>
    <tr>
      <td><i className="fv-swatch" style={{ background: SHADE[b.batch.shade]?.fill }} />{b.products[0].lot}<small>{shade(b.batch.shade)}</small></td>
      <td>{needsPerson ? <WithBuyer /> : <>{status(s)}<small>{c.submission ? t.sentNote : s === 'insufficient' ? t.oneMissing : finding ? t.shared : ''}</small></>}</td>
      <td>
        {s === 'insufficient' && !c.submission ? <button className="text-btn" onClick={onRequest}>{t.sendIt((ask?.items ?? [''])[0].replace(/ T1$/, ''))} ↑</button>
          : finding ? (
            <div className="fv-reply">
              <a className="text-btn" href={`#/passport/${b.key}`}>{t.passport} ↗</a>
              {!writing && <button className="text-btn" onClick={() => setWriting(true)}>{t.reply} ↗</button>}
              {c.replies.length > 0 && (
                <div className="fv-replies"><span className="micro">{t.replies}</span>
                  {c.replies.map((r) => <p key={r.at + r.note}>“{r.note}” <small>{dayHm(wall(r.at))}</small></p>)}
                  <button className="text-btn" onClick={async () => { await api.clearReplies(b.key); onChange() }}>{t.clearReplies} ↺</button>
                </div>
              )}
            </div>
          ) : <span className="fv-nothing">{t.nothing}</span>}
      </td>
    </tr>
    {writing && <tr className="fv-reply-row"><td colSpan={3}>
      <div className="fv-reply-form">
        <label className="fv-label" htmlFor={`reply-${b.key}`}>{t.replyLabel}</label>
        <textarea id={`reply-${b.key}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1200} disabled={sending} aria-describedby={`reply-${b.key}-voice-status`} />
        <VoiceReply fieldId={`reply-${b.key}`} disabled={sending} onBusyChange={setVoiceBusy} onTranscript={(value) => setText((old) => old.trim() ? `${old.trimEnd()}\n${value}` : value)} />
        <small>{t.replyHint}</small>
        {text.length > 1200 && <p className="form-error" lang="en" role="alert">Your reply is longer than 1200 characters. Shorten it before sending.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="fv-actions"><button className="button ink small" disabled={sending || voiceBusy || !text.trim() || text.length > 1200} onClick={send}>{sending ? t.sending : t.replySend} <span>↗</span></button>
          <button className="text-btn" disabled={sending} onClick={() => { setWriting(false); setVoiceBusy(false) }}>{t.cancel}</button></div>
      </div>
    </td></tr>}
    </>
  )
}
