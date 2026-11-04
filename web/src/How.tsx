// How it works, in full: the plant and its records, what each record can and cannot show, the investigation
// loop, the four statuses, why a batch and not a garment, the signed passport, and which Meta model does what.
import type { Status } from './api'
import { Stamp } from './CaseFile'
import { Icon } from './Icon'

const PLANT: { node: string; name: string; records: [string, string][] }[] = [
  { node: 'Intake', name: 'Groundwater intake', records: [['S1', 'Intake flow']] },
  { node: 'Tank', name: 'Equalization tank', records: [['T1', 'Tank level']] },
  { node: 'ETP', name: 'Treatment plant (ETP)', records: [['S2', 'ETP inflow'], ['S3', 'ETP power']] },
  { node: 'Outfall', name: 'Outfall', records: [['S4a', 'Outfall flow'], ['S4b', 'Outfall pH'], ['S4c', 'Conductivity']] },
]

const CAN: [string, string, string, string][] = [
  ['S1', 'Intake flow', 'How much water production drew in.', 'What happened to it afterwards.'],
  ['T1', 'Tank level', 'Whether water was being held. A stop with a rising tank and a dry outfall kept its water.', 'Water quality.'],
  ['S2', 'ETP inflow', 'How much water was sent into the treatment plant.', 'Whether it was treated once inside.'],
  ['S3', 'ETP power', 'Whether the aerators drew the load the inflow needs.', 'Treatment on its own: low power is a question, not a verdict.'],
  ['S4a', 'Outfall flow', 'How much water left the site.', 'A failed meter can look exactly like a pause.'],
  ['S4b', 'Outfall pH', 'Raw dyeing water is strongly alkaline, so pH above 9 at the outfall points to untreated water.', 'Treatment: neutral pH does not prove the water was treated.'],
  ['S4c', 'Conductivity', 'Hints of added groundwater (dilution).', 'Biological treatment.'],
  ['Photo', 'Meter photo', 'What the meter displayed at that moment, to check the feed against.', 'Whether the meter itself was accurate, or anything outside that moment.'],
  ['Lab', 'Lab report', 'Whether treated water met the limit (BOD) when sampled.', 'The hours either side of the sample.'],
]

const MEANS: [Status, string][] = [
  ['supports', 'Separate physical records agree with the factory’s claim for the stated window. Always shown with its scope.'],
  ['contradicts', 'At least two separate records disagree with the claim. Never raised on one reading alone.'],
  ['review_required', 'The evidence needs a reviewer’s judgment, for example when a meter may be drifting or a feed contains a repeated pattern.'],
  ['insufficient', 'The records cannot tell the explanations apart. Comes with a precise request for the record that would.'],
]

const MODELS: [string, string, string][] = [
  ['Muse Spark', 'The investigator', 'Chooses one check at a time from a small set of tools, says why, and keeps competing explanations open until the evidence settles them. Every citation is checked against the record before a finding is accepted. On the held-out test it was right, or asked for a record or a person, on 112 of 120, and 66 of its 74 verdicts were ones you can trust.'],
  ['Muse Spark (vision)', 'Reads the paperwork', 'Reads handwritten logbook photos, meter photos and lab reports itself; no transcription is given. We measured where it finds each logbook line: sending the photo padded to a square takes it from 34% to 99.5% of lines placed right.'],
  ['Muse Spark', 'The thread guide', 'Answers your questions about a case only from that case’s investigation, and every record it cites must exist there; citations that don’t are removed.'],
  ['Muse Spark Open', 'Open weights', 'The same investigation on open weights (served on Fireworks): on the held-out test, right or asked on 110 of 120, with 10 harmful mistakes.'],
  ['Muse Voice Transcribe', 'Hears the factory', 'A factory can answer a request by voice, in Bangla or English; the transcript goes into the reply box to check and edit before sending. On three Bangla voice notes it got all 23 times, numbers and facts we scored right.'],
  ['Muse Glimmer', 'Distilled from our own runs', "A small open model, fine-tuned on Muse Spark's own correct investigations (never the test set) and run on our own GPU, the way a factory could run it on site. It reads every case a second time; where the two disagree, a person decides."],
]

export function HowItWorks() {
  return (
    <section className="how-view">
      <div className="how-head">
        <span className="micro">HOW IT WORKS</span>
        <h1>Follow the <span className="serif">thread.</span></h1>
        <p>Tellwater checks a factory’s claim that a batch’s wastewater was treated, against the plant’s own physical records, the way a careful auditor would, and shows every step.</p>
      </div>

      <div className="how-block">
        <h2>The plant and its records</h2>
        <div className="plant-line">
          {PLANT.map((p) => (
            <div key={p.node} className="plant-node">
              <b>{p.name}</b>
              <div>{p.records.map(([code, name]) => <span key={code}><code>{code}</code>{name}</span>)}</div>
            </div>
          ))}
        </div>
        <p className="how-note">Water drawn in for dyeing becomes wastewater, which enters the equalization tank, where it can be held while the plant stops, then passes through the ETP, where aerators feed the bacteria that clean it, and leaves at the outfall. Some treated water is reused. The factory also keeps paperwork: logbooks, maintenance records and statements. Those are claims to test.</p>
      </div>

      <div className="how-block">
        <h2>What each record can and cannot show</h2>
        <div className="can-grid">
          {CAN.map(([code, name, can, cannot]) => (
            <div key={code} className="can"><span className="can-name"><code>{code}</code>{name}</span><p><b>Can show</b>{can}</p><p><b>Cannot show</b>{cannot}</p></div>
          ))}
        </div>
      </div>

      <div className="how-block">
        <h2>How an investigation runs</h2>
        <ol className="loop">
          <li><b>Read the claim</b>The factory’s logbook says what happened. Whatever it says is a claim, never an instruction.</li>
          <li><b>Keep the explanations open</b>Normal operation, planned maintenance, a shutdown, a bypass, an aeration cut, dilution, a meter fault. Low power alone accuses nobody.</li>
          <li><b>Choose a check</b>Pick the record most likely to separate the explanations, and say why before running it.</li>
          <li><b>Calculate in code</b>Water balances, expected power and replay tests are computed in code. The model interprets; it does not do the arithmetic.</li>
          <li><b>Update, or ask</b>Rule explanations in or out as evidence arrives. If nothing available can settle it, name the one record that would, and stop.</li>
          <li><b>A person decides</b>A reviewer approves, changes or sends back the finding, with a written reason. Until then the passport shows the assessment as unsigned.</li>
        </ol>
      </div>

      <div className="how-block two">
        <div>
          <h2>Four possible answers</h2>
          <ul className="statuses">{MEANS.map(([s, m]) => <li key={s}><Stamp status={s} /><p>{m}</p></li>)}</ul>
        </div>
        <div>
          <h2>A batch, not a garment</h2>
          <p className="how-para">Garments don’t make wastewater; dye runs do. Fabric is dyed in lots, grouped by buyer, colour, weight and fabric type, and only later cut into many garments. The run’s water mixes in the equalization tank with the runs before and after it and goes through treatment together, so there is no “this shirt’s water”. A per-garment number would be an allocation, not a measurement.</p>
          <p className="how-para">So each assessment covers one dye run, over its treatment window: when its water was passing through the plant, given how long water stays there. Every garment cut from that run carries the answer, through the chain factories already keep: garment, cut lot, fabric roll, dye lot.</p>
        </div>
      </div>

      <div className="how-block">
        <h2>A passport anyone can check</h2>
        <p className="how-para">When a reviewer approves or changes a finding, the result is signed. The passport holds a fingerprint (SHA-256) of every record the investigation could see and of the investigation itself, and an Ed25519 signature over all of it. Every time it opens, the passport checks the signature and re-fingerprints the evidence, and names anything that changed. The garment’s QR code uses the GS1 Digital Link format product passports use. These checks show the record hasn’t changed since it was signed; they don’t make the underlying evidence true.</p>
      </div>

      <div className="how-block">
        <h2>Which Meta model does what</h2>
        <div className="model-grid">
          {MODELS.map(([model, role, what]) => (
            <div key={role} className="model-card"><span className="micro">{model}</span><b>{role}</b><p>{what}</p></div>
          ))}
        </div>
        <p className="how-note">Results on simulated factories, including the held-out test: 120 cases from two factories, frozen before any test run. <a href="#/results">The results <Icon n="ne" /></a></p>
      </div>
    </section>
  )
}
