/* global React, NXFREIGHT */
// Nexus — Freight section · three approaches to the same brief.
// SCOPE: the Freight section on the Costs page and its creation surface. Nothing
// else on the Costs page; nothing on any other page.
// docs/freight-section-options.md is the design source; this is its render.

const { useState } = React;
const F = () => window.NXFREIGHT;

const m4 = v => "$" + v.toFixed(4);
const usd = v => "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = v => Math.round(v * 100) + "%";
// Dates are stored ISO and displayed formatted. The operator never types a
// format, so no date can be ambiguous between surfaces.
const fmtDate = iso => {
  if (!iso) return "not set";
  const [y, m, d] = iso.split("-");
  const mm = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d + " " + mm[Number(m) - 1] + " " + y;
};
const REC = () => F().tiers.findIndex(t => t.recommended);

// ── shared: shape wiring ─────────────────────────────────
function useShape(shape, seed) {
  const D = F();
  const base = seed || (shape === "simple" ? D.simple : shape === "stress" ? D.stress : D.turnkey);
  const [subs, setSubs] = useState(base);
  const key = seed ? "seed:" + shape : shape;
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); setSubs(base); }

  const select = (scId, dId) => setSubs(s => s.map(x => x.id === scId ? { ...x, selected: dId } : x));
  const edit = (scId, dId, key, val) => setSubs(s => s.map(x => x.id !== scId ? x : {
    ...x, destinations: x.destinations.map(d => d.id === dId ? { ...d, [key]: val } : d),
  }));
  const toggleSku = (scId, sku) => setSubs(s => s.map(x => {
    if (x.id !== scId) return x;
    const on = x.assigned.includes(sku);
    return { ...x, assigned: on ? x.assigned.filter(a => a !== sku) : x.assigned.concat([sku]) };
  }));
  const setSource = (scId, src) => setSubs(s => s.map(x =>
    x.id === scId && x.customs ? { ...x, customs: { ...x.customs, source: src } } : x));
  const setTrack = (scId, key, val) => setSubs(s => s.map(x =>
    x.id === scId ? { ...x, tracking: { ...x.tracking, [key]: val } } : x));
  const setGroup = (scId, gId, key, val) => setSubs(s => s.map(x => {
    if (x.id !== scId || !x.customs) return x;
    return { ...x, customs: { ...x.customs,
      groups: x.customs.groups.map(g => g.id === gId ? { ...g, [key]: val } : g) } };
  }));

  // A new destination arrives INLINE, expanded, at the foot of its subcategory.
  // It inherits freight type and markup from the destination above — candidates
  // for one shipment nearly always share those, and that shared basis is what
  // makes them comparable. Totals arrive EMPTY: pre-filling a cost with a
  // neighbour's cost is exactly the disagreement the design exists to prevent.
  const addDest = scId => setSubs(s => s.map(x => {
    if (x.id !== scId) return x;
    const prev = x.destinations[x.destinations.length - 1];
    return { ...x, destinations: x.destinations.concat([{
      id: x.id + "-draft-" + (x.destinations.length + 1),
      to: "", consignee: null, transit: "", quote: null, cbm: null,
      modes: prev ? prev.modes.slice() : ["", "", ""],
      notes: ["", "", ""],
      totals: [0, 0, 0], markup: prev ? prev.markup.slice() : [0.2, 0.2, 0.2],
      flat: false, draft: true, inherited: !!prev,
    }]) };
  }));

  // Removing the SELECTED destination leaves the subcategory unselected. It
  // does not fall through to the next cheapest: that would author a decision
  // she didn't make. The total drops and says so.
  const [lost, setLost] = useState(null);
  const removeDest = (scId, dId) => setSubs(s => s.map(x => {
    if (x.id !== scId || x.destinations.length < 2) return x;
    const gone = x.destinations.find(d => d.id === dId);
    const wasSel = x.selected === dId;
    if (wasSel) setLost({ scId, to: gone.to || "a draft" });
    return { ...x, selected: wasSel ? null : x.selected, destinations: x.destinations.filter(d => d.id !== dId) };
  }));

  return { subs, select, edit, toggleSku, setSource, setGroup, setTrack, addDest, removeDest, lost, setLost };
}

function ShapeSwitch({ shape, onShape }) {
  const b = (k, label) => (
    <button className={shape === k ? "on" : ""} onClick={() => onShape(k)}>{label}</button>
  );
  return (
    <div className="fr-shape">
      <span className="k">quote shape</span>
      {b("simple", "1 subcategory · 1 destination · 3 totals")}
      {b("turnkey", "3 · 6 destinations · 18 totals")}
      {b("stress", "3 × 3 × 3 · 27 totals")}
    </div>
  );
}

function TierHead({ label }) {
  const { tiers } = F();
  return (
    <div className="fr-grid fr-tierhead">
      <div className="lab">{label}</div>
      {tiers.map(t => (
        <div className="fr-cell" key={t.id}>
          <span className="v">{t.label}{t.recommended && <span className="rec"> ★</span>}</span>
          <span className="s">{t.qty.toLocaleString()} units</span>
        </div>
      ))}
    </div>
  );
}

// Assignment says WHICH SKUs the freight is for. It does not divide the cost.
function SkuChips({ sc, onToggle }) {
  const { skus } = F();
  const all = sc.assigned.length === skus.length;
  return (
    <div className="fr-skus">
      <span className="k">for</span>
      {all && <span className="fr-chip all">all {skus.length} SKUs</span>}
      {!all && skus.map(s => (
        <button
          key={s.id}
          className={"fr-chip" + (sc.assigned.includes(s.id) ? " on" : "")}
          title={s.name}
          onClick={() => onToggle(s.id)}
        >{s.id}</button>
      ))}
      {all && skus.map(s => (
        <button key={s.id} className="fr-chip on" title={s.name} onClick={() => onToggle(s.id)}>{s.id}</button>
      ))}
    </div>
  );
}

// Stated once, at the subcategory. Mode and the shipment note are NOT here —
// the documents put them on the break row (LTL at 25K, FTL at 100K).
function StatedOnce({ sc }) {
  const f = (k, v) => <div className="f" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>;
  return (
    <div className="fr-fields">
      {f("carrier", sc.forwarder)}
      {f("incoterm", sc.incoterm)}
      {f("journey", sc.journey)}
      {f("cargo ready", fmtDate(sc.cargoReady))}
      {f("treatment", sc.treatment)}
    </div>
  );
}

// THE SECTION'S SECOND PURPOSE. She plans and tracks shipments here, not only
// costs them — so the dates are half of what the section does, not leftovers.
// One strip per subcategory, tied to the chosen destination, because only the
// chosen one ever moves. Dates entered for one endpoint are not valid for
// another, so a changed selection is flagged rather than silently carried.
function Tracking({ sc, onTrack }) {
  const { chosen } = F();
  const win = chosen(sc);
  if (!win) {
    return (
      <div className="fr-track pending">
        <span className="k">shipment</span>
        <span className="none">no destination chosen — nothing ships yet, so there is nothing to track</span>
      </div>
    );
  }
  const stale = sc.tracking.forDest && sc.tracking.forDest !== win.id
    && (sc.tracking.etd || sc.tracking.eta || sc.tracking.actual);
  const field = (k, key) => (
    <div className="f" key={key}>
      <span className="k">{k}</span>
      <input
        type="date" className="fr-tin sm date" value={sc.tracking[key]}
        onChange={e => onTrack(key, e.target.value)}
      />
      {!sc.tracking[key] && <span className="unset">not set</span>}
    </div>
  );
  return (
    <div className={"fr-track" + (stale ? " stale" : "")}>
      <span className="k">shipment · {win.to}</span>
      <div className="fr-tfields">
        {field("vessel etd", "etd")}
        {field("vessel eta", "eta")}
        {field("actual delivery", "actual")}
      </div>
      {stale && (
        <span className="warn">
          these dates were entered for a different endpoint — an ETA for one destination is not an ETA for another
        </span>
      )}
    </div>
  );
}

// COMPUTED, SYSTEM VOICE. Cally read the old "chose … because" line as help
// making a decision, not a record of one — but it mixed computed deltas with
// knowledge only she has. So the arithmetic is stated here, in the system's
// voice, and it appears BEFORE a choice exists; the why is a separate operator
// line below it. One voice per source.                       ← LOAD-BEARING
function Compared({ sc }) {
  const { landed, tiers, chosen } = F();
  if (sc.destinations.length < 2) return null;
  const win = chosen(sc);
  const ti = REC();
  const sgn = v => m4(Math.abs(v)).slice(1);
  const cheapestAt = i => sc.destinations.slice().sort((a, b) => landed(sc, a, i) - landed(sc, b, i))[0];

  if (!win) {
    const b = cheapestAt(ti), rest = sc.destinations.filter(d => d.id !== b.id);
    return (
      <div className="fr-reason sys">
        <span className="k">comparison</span>
        <span className="t">
          Cheapest at {tiers[ti].qty.toLocaleString()} is <strong>{b.to}</strong> — {rest.map((d, i) => (
            <span key={d.id}>{sgn(landed(sc, d, ti) - landed(sc, b, ti))}/unit under {d.to}{i < rest.length - 1 ? ", " : ""}</span>
          ))}. Nothing selected yet.
        </span>
      </div>
    );
  }
  const others = sc.destinations.filter(d => d.id !== win.id);
  const bestT1 = cheapestAt(0);
  return (
    <div className="fr-reason sys">
      <span className="k">comparison</span>
      <span className="t">
        <strong>{win.to}</strong> is {others.map((d, i) => {
          const v = landed(sc, win, ti) - landed(sc, d, ti);
          return (
            <span key={d.id}>
              {sgn(v)}/unit {v < 0 ? "under" : "over"} {d.to}{i < others.length - 1 ? ", and " : ""}
            </span>
          );
        })} at {tiers[ti].qty.toLocaleString()}.
        {sc.customs && <span> Duty and tariff are identical across all {sc.destinations.length}, so the difference is ocean freight only.</span>}
        {bestT1.id !== win.id && (
          <span className="flag"> {bestT1.to} is cheaper at {tiers[0].qty.toLocaleString()}.</span>
        )}
      </span>
    </div>
  );
}

// Compact head strip — the outcome, so a PM never expands anything to read it.
function Decision({ sc }) {
  const { landed, chosen } = F();
  const ti = REC();
  const win = chosen(sc);
  if (sc.destinations.length < 2) {
    return <div className="fr-decision"><span className="sep">single destination — nothing to choose</span></div>;
  }
  if (!win) {
    return <div className="fr-decision"><span className="fr-vs worse">no destination selected</span></div>;
  }
  const others = sc.destinations.filter(d => d.id !== win.id)
    .map(d => ({ d, delta: landed(sc, d, ti) - landed(sc, win, ti) }))
    .sort((a, b) => a.delta - b.delta);
  const near = others[0], far = others[others.length - 1];
  const sgn = v => (v > 0 ? "+" : "−") + m4(Math.abs(v)).slice(1);
  return (
    <div className="fr-decision">
      <span className="chose">{win.to} chosen</span>
      <span className="sep">·</span>
      <span>next best {sgn(near.delta)}/unit ({near.d.to})</span>
      {others.length > 1 && <span className="sep">·</span>}
      {others.length > 1 && <span>widest {sgn(far.delta)}/unit ({far.d.to})</span>}
      <span className="sep">· at {F().tiers[ti].qty.toLocaleString()}</span>
    </div>
  );
}

// ── shared: the disclosed detail rows ────────────────────
// The disclosed rows are the DESCRIPTIVE per-break facts — freight type and the
// shipment note. Costs are NOT here: they live on the destination row itself, in
// the same grammar as the entry charges. One mechanism per task.
function EntryRows({ d, onEdit }) {
  const { tiers } = F();
  const setArr = (key, ti, val) => {
    const next = d[key].slice(); next[ti] = val; onEdit(key, next);
  };
  return (
    <div className="fr-entry">
      <div className="fr-grid">
        <div className="fr-elab">freight type · per break</div>
        {tiers.map((t, ti) => (
          <div className="fr-cell" key={t.id}>
            <input className="fr-in txt" value={d.modes[ti]} placeholder="Domestic LTL"
              onChange={e => setArr("modes", ti, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="fr-grid">
        <div className="fr-elab">item / description</div>
        {tiers.map((t, ti) => (
          <div className="fr-cell" key={t.id}>
            <input className="fr-in txt" value={d.notes[ti]} placeholder="4 pallets"
              onChange={e => setArr("notes", ti, e.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── shared: total + assertions ───────────────────────────
function TotalStrip({ subs }) {
  const { tiers, landed, chosen } = F();
  const total = ti => subs.reduce((a, sc) => { const d = chosen(sc); return a + (d ? landed(sc, d, ti) : 0); }, 0);
  const undecided = subs.filter(sc => sc.destinations.length > 1 && !sc.selected).length;
  return (
    <React.Fragment>
      <div className="fr-grid fr-total">
        <div className="lab">
          <span className="n">Freight sell per unit</span>
          <span className="m">
            {undecided
              ? undecided + " subcategor" + (undecided > 1 ? "ies have" : "y has") + " no selection"
              : "sum of the selected destination in each of " + subs.length + " subcategor" + (subs.length > 1 ? "ies" : "y")}
          </span>
        </div>
        {tiers.map((t, ti) => (
          <div className="fr-cell" key={t.id}>
            <span className="v">{m4(total(ti))}</span>
            <span className="s">freight + duty/tariff</span>
          </div>
        ))}
      </div>
      <div className="fr-assert">
        <span className="mk">✓</span>
        <span>
          candidate destinations are internal — they reach neither the quote nor the PDF. Freight, duty and
          tariff stay separate rows into Pricing's cost stack.
        </span>
      </div>
    </React.Fragment>
  );
}

// ENTRY-LEVEL COSTS — duty, tariff and entry fees, entered ONCE and carried
// onto every destination. Separate rows, per Edward: "I still want duties and
// tariffs to be entered separately — we need to track it." Amounts, per Cally,
// so there is no base to disagree about; the rate path is preserved for legs
// Nexus estimates rather than receives. Markup is visible and editable per
// break, because she asked for it and because it is a commercial decision.
function EntryCosts({ sc, onSource, onGroup }) {
  const D = F();
  const c = sc.customs;
  if (!c) return null;
  const inv = c.source === "invoice";
  const total = ti => D.entryAmount(sc, ti);

  return (
    <div className="fr-customs">
      <div className="fr-chead">
        <span className="h">Customs entry</span>
        <span className="fr-entryref">{c.entry}</span>
        <span className="fr-srcpick">
          <button className={"fr-src" + (inv ? " on" : "")} onClick={() => onSource("invoice")}>amounts from invoice</button>
          <button className={"fr-src" + (!inv ? " on" : "")} onClick={() => onSource("rate")}>rate × base</button>
        </span>
      </div>

      <div className="fr-cgrid fr-chd">
        <div>charge · entered once, carried to all {sc.destinations.length}</div>
        <div>markup</div>
        {D.tiers.map(t => <div key={t.id} className="n">{t.label} · {(t.qty / 1000)}K</div>)}
      </div>

      {c.groups.map(g => (
        <div className="fr-cgrid fr-crow" key={g.id}>
          <div className="lb">
            <span className="n">{g.label}</span>
            <span className="d">{g.detail}</span>
          </div>
          <div className="mk">
            {D.tiers.map((t, ti) => (
              <input
                className="fr-in pct" key={t.id} value={Math.round(g.markup[ti] * 100)}
                onChange={e => {
                  const n = g.markup.slice(); n[ti] = (Number(e.target.value) || 0) / 100;
                  onGroup(g.id, "markup", n);
                }}
              />
            ))}
          </div>
          {D.tiers.map((t, ti) => (
            <div className="n" key={t.id}>
              {inv ? (
                <input
                  className="fr-in" value={g.amount[ti]}
                  onChange={e => {
                    const n = g.amount.slice(); n[ti] = Number(e.target.value) || 0;
                    onGroup(g.id, "amount", n);
                  }}
                />
              ) : (
                <span className="v">{usd(g.rateBase[ti] * g.rate)}</span>
              )}
              <span className="s">
                {inv
                  ? "sell " + usd(D.gSell(g, ti, c.source)).slice(1)
                  : pct(g.rate) + " on " + usd(g.rateBase[ti]).slice(1)}
              </span>
            </div>
          ))}
        </div>
      ))}

      <div className="fr-cgrid fr-crow tot">
        <div className="lb"><span className="n">Carried to every destination</span></div>
        <div className="mk" />
        {D.tiers.map((t, ti) => (
          <div className="n" key={t.id}>
            <span className="v">{usd(total(ti))}</span>
            <span className="s">{m4(D.entrySell(sc, ti))}/unit sell</span>
          </div>
        ))}
      </div>

    </div>
  );
}

// SUPPORTING DETAIL, one fold per subcategory. The core is what she enters and
// what the price reads: destination rows, charges, totals. Everything that
// explains or annotates them folds — comparison, why, shipment dates, workings.
//
// THE RULE IS THE COSTS PAGE'S: collapsing may hide COMPLETED work, never
// PENDING work. So an unrecorded reason and a stale-date conflict force the fold
// open and are named in the summary rather than tucked away.  ← LOAD-BEARING
function Support({ sc, open, onToggle, onTrack }) {
  const D = F();
  const c = sc.customs;
  const multi = sc.destinations.length > 1;
  const win = D.chosen(sc);
  const missingWhy = multi && !!win && !sc.reason;
  const stale = sc.tracking && sc.tracking.forDest && win && sc.tracking.forDest !== win.id
    && (sc.tracking.etd || sc.tracking.eta || sc.tracking.actual);
  const forced = missingWhy || stale;
  const shown = open || forced;

  const chips = [];
  if (multi) chips.push({ t: "comparison" });
  if (multi) chips.push(sc.reason ? { t: "why recorded" } : { t: "why not recorded", warn: true });
  if (sc.tracking) {
    chips.push(stale
      ? { t: "dates entered for another endpoint", warn: true }
      : { t: sc.tracking.eta ? "eta " + fmtDate(sc.tracking.eta) : "no eta set" });
  }
  if (c) chips.push({ t: "duty workings" });

  return (
    <React.Fragment>
      <div className="fr-fold">
        <button className={"fr-foldbtn" + (shown ? " on" : "")} onClick={onToggle} disabled={forced}>
          <span className="cv">{shown ? "▾" : "▸"}</span>
          {shown ? "Hide supporting detail" : "Supporting detail"}
        </button>
        <span className="fr-chips">
          {chips.map(ch => <span className={"fr-fchip" + (ch.warn ? " warn" : "")} key={ch.t}>{ch.t}</span>)}
        </span>
        {forced && <span className="fr-forced">kept open — needs attention</span>}
      </div>

      {shown && (
        <React.Fragment>
          {multi && <Compared sc={sc} />}
          {multi && (
            <div className="fr-reason">
              <span className="k">why · {sc.reason ? "Cally Hou" : "unrecorded"}</span>
              <span className={"t" + (sc.reason ? "" : " empty")}>
                {sc.reason || "the deltas above are the system's; the reason is yours — add what the numbers don't say"}
              </span>
            </div>
          )}
          {sc.tracking && <Tracking sc={sc} onTrack={onTrack} />}
          {c && (
            <div className="fr-math">
              <span className="kw">MATH:</span> DUTY_BILLABLE = FACTORY_COST × (DUTY_RATE + TARIFF_RATE)
              {c.source === "invoice"
                ? <span className="ok"> — not applied. Amounts are asserted from the invoice she has in hand, so
                  there is no base to disagree about. The rate path is preserved for legs Nexus estimates.</span>
                : <span className="bad"> — wrong operand. The base is the declared value of the assigned SKUs
                  ({usd(c.declared[0])} at 25K), not the whole unit: packaging, production and cartons never
                  crossed the border.</span>}
            </div>
          )}
        </React.Fragment>
      )}
    </React.Fragment>
  );
}

/* ═══ 1a · NESTED COMPARISON TABLE ═══════════════════════════════════════════
   At rest the section IS the comparison table: one line per destination, three
   tier figures, the delta against the winner. Entry is the disclosed state, and
   what it discloses is exactly option 1b's tier rows.                       */
function OptionA({ shape, onAdd, seed }) {
  const D = F();
  const { subs, select, edit, toggleSku, setSource, setGroup, setTrack, addDest, removeDest, lost, setLost } = useShape(shape, seed);
  const totalDests = subs.reduce((a, s) => a + s.destinations.length, 0);
  const allIds = subs.flatMap(s => s.destinations.map(d => d.id));
  const [openIds, setOpenIds] = useState(null);
  const open = openIds || (totalDests <= 2 ? allIds : []);
  const toggle = id => setOpenIds(open.includes(id) ? open.filter(x => x !== id) : open.concat([id]));
  // Section-level expand-all: turns 1a into 1b for one sitting, which answers
  // 1a's own failure (nine disclosures to type 27 totals) without a second
  // design and without a second entry surface.
  const allOpen = open.length === allIds.length;
  const [support, setSupport] = useState([]);
  const undecidedCount = subs.filter(s => s.destinations.length > 1 && !s.selected).length;
  const importCount = subs.filter(s => s.customs).length;

  return (
    <div className="cw-section">
      <div className="cw-shead">
        <span className="t">Freight</span>
        <span className="owner">owner · Logistics — Cally Hou</span>
        {/* The header counts the new units. Treatment is dropped from here — a
            count of bundled-vs-passthrough tells nobody anything actionable and
            it is already stated on every subcategory head. */}
        <span className="fam">
          {subs.length === 0 ? "nothing ships yet" : (
            subs.length + " shipment" + (subs.length > 1 ? "s" : "")
            + " · " + allIds.length + " destination" + (allIds.length > 1 ? "s" : "") + " priced"
            + (undecidedCount ? " · " + undecidedCount + " undecided" : "")
            + " · " + importCount + " clears customs"
          )}
        </span>
        {allIds.length > 0 && (
          <button className={"fr-edit" + (allOpen ? " on" : "")} onClick={() => setOpenIds(allOpen ? [] : allIds)}>
            {allOpen ? "hide all detail" : "show type + description · all " + allIds.length}
          </button>
        )}
      </div>
      <TierHead label={"Freight · sell per unit"} />

      {subs.length === 0 && (
        <div className="fr-empty">
          <div className="t">Nothing ships yet</div>
          <div className="s">
            Start with one thing and where it leaves from — packaging from the factory, bulk raw from the
            supplier, shippers from the warehouse. Turnkey quotes usually have three. Destinations, rates and
            markup come after.
          </div>
          <button className="btn primary" onClick={onAdd}>+ What ships</button>
        </div>
      )}

      {subs.map((sc, sci) => {
        const multi = sc.destinations.length > 1;
        const win = D.chosen(sc);
        return (
          <div className={"fr-sc" + (multi ? "" : " solo") + (sc.customs ? " import" : "")} key={sc.id}>
            <div className="fr-schead">
              <div className="fr-eyebrow">
                <span className="num">{sci + 1} of {subs.length}</span>
                <span>what ships</span>
                {sc.customs
                  ? <span className="kind">· import · clears customs</span>
                  : <span>· domestic · no border</span>}
              </div>
              <div className="fr-scname">
                <span className="ships">{sc.ships}</span>
                <span className="from">from {sc.origin}</span>
                {multi && (
                  <span className={"count" + (sc.selected ? "" : " undecided")}>
                    {sc.destinations.length} destinations priced
                  </span>
                )}
              </div>
              <SkuChips sc={sc} onToggle={sku => toggleSku(sc.id, sku)} />
              <StatedOnce sc={sc} />
              {multi && <Decision sc={sc} />}
            </div>

            {sc.destinations.map(d => {
              const isSel = sc.selected === d.id;
              const ti = REC();
              const delta = win && !isSel ? D.sell(d, ti) - D.sell(win, ti) : null;
              const varies = d.modes[0] !== d.modes[1] || d.modes[1] !== d.modes[2];
              const priced = d.totals.some(v => v > 0);
              const isOpen = open.includes(d.id) || d.draft;
              return (
                <div className={"fr-dest" + (isSel && multi ? " sel" : "") + (d.draft ? " draft" : "")} key={d.id}>
                  <div className="fr-grid">
                    <div className="fr-dlab">
                      {multi && (
                        <button
                          className={"fr-pick" + (isSel ? " on" : "")}
                          onClick={() => priced && select(sc.id, d.id)}
                          disabled={!priced}
                          title={priced ? "Select " + d.to : "a candidate with no total can't be chosen"}
                          aria-label={"Select " + d.to}
                        />
                      )}
                      <span className="fr-dname">
                        {d.draft ? (
                          <input
                            className="fr-din" autoFocus placeholder="destination — e.g. Aurora, OH"
                            value={d.to} onChange={e => edit(sc.id, d.id, "to", e.target.value)}
                          />
                        ) : (
                          <span className="n">{multi ? "to " : ""}{d.to}{d.consignee ? " · " + d.consignee : ""}</span>
                        )}
                        <span className="m">
                          {d.draft ? (
                            <input
                              className="fr-din" style={{ width: 120 }} placeholder="transit days"
                              value={d.transit} onChange={e => edit(sc.id, d.id, "transit", e.target.value)}
                            />
                          ) : <span>{d.transit} door to door</span>}
                          {/* A resting row showing one mode when three apply is
                              the blended story 1a was charged with. Say all three. */}
                          {!d.draft && (
                            <span className={varies ? "varies" : ""}>
                              {varies ? d.modes.map(x => x.replace("Domestic ", "").replace("Ocean ", "")).join(" / ") : d.modes[0]}
                            </span>
                          )}
                          {d.inherited && <span className="fr-inherit">type + markup inherited</span>}
                          {d.synthetic && <span>lane estimate</span>}
                        </span>
                        {/* No quote reference and no attachment: she has the
                            document open while typing and nobody else reads it.
                            A free-text note instead — presumes no document. */}
                        {!d.draft && (
                          <input
                            className="fr-note" value={d.note} placeholder="note — optional"
                            onChange={e => edit(sc.id, d.id, "note", e.target.value)}
                          />
                        )}
                      </span>
                      {multi && isSel && <span className="fr-vs win">in the price</span>}
                      {multi && !isSel && priced && (
                        <span className={"fr-vs " + (delta > 0 ? "worse" : "better")}>
                          {(delta > 0 ? "+" : "−") + m4(Math.abs(delta)).slice(1)}/unit
                        </span>
                      )}
                      {multi && !priced && <span className="fr-vs">no total yet</span>}
                      <button className="fr-tog" onClick={() => edit(sc.id, d.id, "flat", !d.flat)}>
                        {d.flat ? "differs by break" : "one value, all breaks"}
                      </button>
                      <button className={"fr-edit" + (isOpen ? " on" : "")} onClick={() => toggle(d.id)}>
                        {isOpen ? "hide detail" : "type + description"}
                      </button>
                      {multi && (
                        <button className="fr-del" onClick={() => removeDest(sc.id, d.id)}
                          title="Remove this destination">remove</button>
                      )}
                    </div>
                    {D.tiers.map((t, i) => (
                      <div className="fr-cell fr-entrycell" key={t.id}>
                        {d.flat && i > 0 ? (
                          <span className="cbm">one value, all breaks</span>
                        ) : (
                          <React.Fragment>
                            <input
                              className="fr-in"
                              value={d.totals[i] || ""}
                              placeholder="total cost"
                              onChange={e => {
                                const v = Number(e.target.value) || 0;
                                const n = d.flat ? [v, v, v] : Object.assign(d.totals.slice(), { [i]: v });
                                edit(sc.id, d.id, "totals", n);
                              }}
                            />
                            <span className="mrow">
                              <span className="x">×</span>
                              <input
                                className="fr-in pct"
                                value={Math.round(d.markup[i] * 100)}
                                onChange={e => {
                                  const n = d.markup.slice(); n[i] = (Number(e.target.value) || 0) / 100;
                                  edit(sc.id, d.id, "markup", n);
                                }}
                              />
                              <span className="arr">→</span>
                              <span className="sell">{priced ? m4(D.landed(sc, d, i)) : "—"}</span>
                            </span>
                            {sc.customs && priced && (
                              <span className="cbm">incl. d/t {m4(D.entrySell(sc, i)).slice(1)}</span>
                            )}
                          </React.Fragment>
                        )}
                      </div>
                    ))}
                  </div>
                  {isOpen && <EntryRows d={d} onEdit={(k, v) => edit(sc.id, d.id, k, v)} />}
                </div>
              );
            })}

            {lost && lost.scId === sc.id && (
              <div className="fr-lost">
                <span className="mk">!</span>
                <span>
                  {lost.to} was the destination in the price. Nothing was promoted in its place — choose one.
                  This subcategory contributes nothing to the total until you do.
                </span>
                <button className="btn sm" onClick={() => setLost(null)}>Got it</button>
              </div>
            )}
            <div className="fr-add">
              <button className="fr-addbtn" onClick={() => addDest(sc.id)}>
                <span className="pl">+</span> Another destination
              </button>
              {!multi && (
                <span className="fr-addnote">
                  A second destination makes this a choice: one goes in the price, the rest stay as the
                  comparison that justified it.
                </span>
              )}
            </div>
            <EntryCosts
              sc={sc}
              onSource={src => setSource(sc.id, src)}
              onGroup={(gId, k, v) => setGroup(sc.id, gId, k, v)}
            />
            <Support
              sc={sc}
              open={support.includes(sc.id)}
              onToggle={() => setSupport(support.includes(sc.id)
                ? support.filter(x => x !== sc.id) : support.concat([sc.id]))}
              onTrack={(k, v) => setTrack(sc.id, k, v)}
            />
          </div>
        );
      })}

      <div className="fr-add sec">
        <button className="fr-addbtn big" onClick={onAdd}>
          <span className="pl">+</span> What else ships
        </button>
      </div>
      {subs.length > 0 && <TotalStrip subs={subs} />}
    </div>
  );
}

// ── The entry sequence, empty → complete ───────────────────
function Walkthrough() {
  const { sequence } = F();
  const [i, setI] = useState(0);
  const s = sequence[i];
  return (
    <React.Fragment>
      <div className="fr-seq">
        <div className="fr-steps">
          {sequence.map((st, n) => (
            <button key={st.n} className={"fr-step" + (n === i ? " on" : "")} onClick={() => setI(n)}>
              <span className="n">{st.n}</span>
              <span className="l">{st.label}</span>
            </button>
          ))}
        </div>
        <div className="fr-caption">
          <span className="k">what happens</span>
          <span className="t">{s.note}</span>
          {s.types && (
            <span className="types">
              <span className="lbl">she types · </span>
              {s.types.split("\n").map((l, n) => <span key={n}>{l}<br /></span>)}
            </span>
          )}
          {s.cost && <span className="cost">! {s.cost}</span>}
        </div>
      </div>
      <OptionA shape={"seq" + i} seed={s.subs} onAdd={() => setI(1)} />
      {s.modal && <AddModal onClose={() => setI(2)} />}
    </React.Fragment>
  );
}

// ── Creation surface — replaces "Add freight leg" in all three options ──
function AddModal({ onClose }) {
  const { skus } = F();
  return (
    <div className="fr-scrim" onClick={onClose}>
      <div className="fr-modal" onClick={e => e.stopPropagation()}>
        <div className="fr-mhead">
          <div className="t">What else ships?</div>
          <div className="s">
            Name the thing, where it leaves from, and which SKUs it's for. Destinations, rates and markup go on
            the section — that is where you can see one candidate against another.
          </div>
        </div>
        <div className="fr-mbody">
          <div className="full">
            <label className="fr-lbl">what ships</label>
            <input className="fr-tin" placeholder="Hypochlorous Acid Bulk · inner + master cartons · bottles + sprayers" />
          </div>
          <div>
            <label className="fr-lbl">from</label>
            <input className="fr-tin" placeholder="Whitsett, NC 27377" />
          </div>
          <div>
            <label className="fr-lbl">forwarder or carrier</label>
            <input className="fr-tin" placeholder="Straight Forwarding, Inc." />
          </div>
          <div>
            <label className="fr-lbl">incoterm</label>
            <input className="fr-tin" placeholder="FOB Ningbo" />
          </div>
          <div>
            <label className="fr-lbl">cargo ready</label>
            <input type="date" className="fr-tin date" />
          </div>
          {/* The question that determines whether a customs entry table exists.
              It has to be asked here: it is a property of the shipment she knows
              at creation, and it decides the shape of the section below. */}
          <div className="full">
            <label className="fr-lbl">does this shipment cross a border?</label>
            <div className="fr-srcpick" style={{ marginLeft: 0 }}>
              <button className="fr-src on">yes — it clears customs</button>
              <button className="fr-src">no — domestic</button>
            </div>
            <div className="fr-hint">
              Yes adds a customs entry table to this subcategory for duty, tariff and entry fees. Domestic
              subcategories get none.
            </div>
          </div>
          <div className="full">
            <label className="fr-lbl">this freight is for</label>
            <div className="fr-skus" style={{ marginTop: 2 }}>
              <span className="fr-chip all">all {skus.length} SKUs</span>
              {skus.map(s => <span className="fr-chip on" key={s.id} title={s.name}>{s.id}</span>)}
            </div>
            <div className="fr-hint">Assignment says which SKUs the freight is for. It does not divide the cost.</div>
          </div>
          <div className="full">
            <label className="fr-lbl">first destination</label>
            <input className="fr-tin" placeholder="Edina, MN 55439" />
            <div className="fr-hint">
              One destination is the whole thing for most subcategories. Add alternatives only when you priced them.
            </div>
          </div>
        </div>
        <div className="fr-mfoot">
          <span className="sp">freight type, description and rates are entered per break, on the section</span>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onClose}>Add</button>
        </div>
      </div>
    </div>
  );
}

// ── Review page ──────────────────────────────────────────
function FreightBuild() {
  const [modal, setModal] = useState(false);
  const [shape, setShape] = useState("turnkey");
  const [mode, setMode] = useState("sequence");

  return (
    <div className="cw-shell">
      <div className="cw-topbar">
        <span className="cw-crumb">
          <span className="dim">Quote · Get W HOCI Spray · Meridian</span> / <strong>Costs</strong>
          <span className="dim"> / Freight</span>
        </span>
        <span className="cw-crumb dim">1a · the chosen build · this section and its creation surface only</span>
      </div>

      <div className="fr-page">
        <h1 className="cw-h1">Freight — <em>subcategory, destination, break</em></h1>
        <p className="cw-sub">
          Transcribed from the two workbooks. Freight is entered <strong>net of duty</strong> per destination; duty,
          tariff and entry fees are entered <strong>once at the entry</strong> and carried, because all three
          candidates clear one entry — so the delta between candidates is structurally ocean freight only. Every cost
          in the section reads the same way: <strong>amount × markup → sell</strong>, typeable where the fact lives.
          The section is also a shipment record: tracking belongs to the chosen destination, since only the chosen
          one ever moves.
        </p>

        <div className="fr-shape">
          <span className="k">view</span>
          <button className={mode === "sequence" ? "on" : ""} onClick={() => setMode("sequence")}>
            Entry sequence · empty → complete
          </button>
          <button className={mode === "resting" ? "on" : ""} onClick={() => setMode("resting")}>
            Resting state
          </button>
        </div>

        {mode === "sequence"
          ? <Walkthrough />
          : (
            <React.Fragment>
              <ShapeSwitch shape={shape} onShape={setShape} />
              <OptionA shape={shape} onAdd={() => setModal(true)} />
            </React.Fragment>
          )}
      </div>

      {modal && <AddModal onClose={() => setModal(false)} />}
    </div>
  );
}

window.FreightBuild = FreightBuild;
