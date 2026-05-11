/* global React */

function NotesView() {
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Round 2 · designer notes</p>
          <h1 className="page-title">Pushbacks, <em>questions answered</em>, what I almost did</h1>
          <p className="page-sub">The stuff that doesn't belong in the production UI but does belong in the response.</p>
        </div>
      </div>

      <Section title="The third pushback you owed" eyebrow="Round 1 debt">
        <p>
          I held it back because I wasn't sure it would land before you saw the build. Here it is:
        </p>
        <Quote>
          <strong>The "Mark Accepted" gate is the wrong place to enforce margin discipline.</strong> The brief
          frames BELOW FLOOR as a hard block at acceptance, requiring admin override. By the time a PM is
          clicking Mark Accepted, the customer has already verbally agreed and the deal is in motion — gating
          there forces a politically expensive override conversation when the gate has actually been visible
          for days. Move the hard-block enforcement <em>upstream</em>: when the costing sheet shows BELOW FLOOR,
          surface "this quote can't be sent at this margin" before the customer-facing PDF is generated.
          The acceptance step should ratify a decision, not arbitrate it.
        </Quote>
        <p>
          You'll see this idea in the costing sheet's BELOW FLOOR state — Mark Accepted is visibly locked
          and the path forward (fix the lines or request override) is laid out before the PM has to ask.
        </p>
      </Section>

      <Section title="New pushbacks this round" eyebrow="Round 2">
        <Quote>
          <strong>#1 — "Quick edit" should not be a separate surface.</strong> You hinted at "a different
          surface optimized for I just got a supplier quote, drop it in, leave." I considered building one,
          then talked myself out of it. The cost build screen needs to <em>be</em> that surface. If the
          page-load is a second and the SKU/tier/field combinatorics are reachable in 2 clicks (sidebar SKU →
          row click → type), a separate quick-edit drawer adds a parallel mental model. The right move is
          aggressive deep-linking: a notification email's "edit Aluminum collar cost" link should land
          directly in the cell, focused, with no chrome to dismiss.
        </Quote>
        <Quote>
          <strong>#2 — Role-anchored editing is over-specified.</strong> The brief asks how Purchasing sees
          the page differently from PM. My honest answer: not very. Same screen, same layout. Purchasing just
          sees write-affordances on packaging lines and read-only-with-dim on the rest. A separate "Purchasing
          view" would be a maintenance liability for marginal benefit. Five-to-seven users total — they can
          see each other's work without separate IAs.
        </Quote>
        <Quote>
          <strong>#3 — The four tiers shouldn't be defaulted.</strong> Most quotes don't need 4 tiers. The
          Excel pattern of "always 4 columns because the template has 4" is a habit, not a requirement.
          Quote setup should default to 2 tiers (the customer's likely target + one alternative) with an
          explicit "+ Add tier" affordance. Forcing 4 makes the comparison rail noisier than it needs to be.
        </Quote>
      </Section>

      <Section title="Three exploratory questions" eyebrow="Answers">
        <h4>1 · How does the left rail evolve at scale?</h4>
        <p>
          The 8-item rail breaks at ~12 active deals. My direction:
        </p>
        <ul>
          <li><strong>Pin the project you're inside.</strong> "This project" only exists when you're in one,
          and it sits above everything else. Outside a project it disappears entirely.</li>
          <li><strong>"My deals" becomes a filterable list, not a nav.</strong> Click it once → a column
          opens with search, sort by stage, filter by client. The rail stops being the IA at ~10 items;
          search is.</li>
          <li><strong>Admin collapses behind a single "Settings" entry.</strong> Margin policy, user
          management, templates all live in tabs inside Settings, not as siblings in the main nav.</li>
          <li><strong>⌘K is the long-term answer.</strong> By Slice 16 the rail is for orientation; ⌘K is
          for action. Searches across deals, SKUs, suppliers, costing-sheet line items.</li>
        </ul>

        <h4>2 · What's the empty state of the workspace?</h4>
        <p>
          A first-time PM logs in and sees:
        </p>
        <ul>
          <li>A two-pane layout: <em>"Import a deal from HubSpot"</em> on the left (the primary path —
          90% of quotes start as a HubSpot deal), <em>"Or start a blank quote"</em> on the right.</li>
          <li>Below that: a single "How quoting works at DPS" card — three sentences, not a tour. PMs come
          from Excel; they don't need an explainer. They need the import button.</li>
          <li>A "What other PMs are working on" strip showing 3-4 active project headers from the team —
          social proof that the tool is in use.</li>
          <li>No mascot. No empty illustration. The point of the empty state is to disappear in two clicks.</li>
        </ul>

        <h4>3 · How does the customer-facing quote view differ from the costing sheet?</h4>
        <p>
          Same data, different rhetoric. Side-by-side:
        </p>
        <Compare
          left={{
            title: "Costing sheet · internal",
            items: [
              "Required sell · price variance · margin %",
              "GOOD/WARN/BAD verdict throughout",
              "Lines requiring review pinned at top",
              "Markup, contribution cost, allocated fees visible",
              "Customs / duty / CBM internal-zone visible",
              "Global adjustment slider live",
            ],
          }}
          right={{
            title: "Customer quote · external",
            items: [
              "Per-tier sell prices · totals · valid-until",
              "No verdict, no internal status",
              "Line items shown only when freight is pass-through",
              "Bundled-freight quotes show one unit price; pass-through shows freight as its own line",
              "Customs section absent entirely (load-bearing constraint)",
              "PDF falls out of this view via print stylesheet",
            ],
          }}
        />
        <p style={{ marginTop: 14 }}>
          The PM toggles between them with a single button on the costing sheet ("Preview customer quote").
          Same underlying data — the customer view is a reduction, not a re-author.
        </p>
      </Section>

      <Section title="What I considered and rejected" eyebrow="Almost-decisions">
        <Quote>
          <strong>A spreadsheet-style cost-build grid.</strong> Tempting because it matches the Excel mental
          model. Rejected because it makes "show only what matters now" impossible — every cell competes for
          attention equally. The grouped-cards-with-completion-dots gives the same density without the
          flatness.
        </Quote>
        <Quote>
          <strong>A radial gauge for margin.</strong> Looks great on a dashboard, reads poorly when you
          actually need to know "am I above 35%?" The horizontal range with floor/target marks reads in one
          glance. Big numeric + colored range beats every gauge I sketched.
        </Quote>
        <Quote>
          <strong>Persistent right-side margin rail across every screen.</strong> Looks intentional, costs
          200px of horizontal space everywhere. Verdict-at-the-top of each surface plus the tier sidecar
          on cost build is enough — the costing sheet is where the verdict <em>is</em> the page, not a sidebar.
        </Quote>
        <Quote>
          <strong>An animated "what changed since you were last here" overlay.</strong> Considered briefly.
          Felt like AI-tool theater. The diff dot on changed values + the collapsed "since you were here"
          summary on the project page is the same information without the production.
        </Quote>
      </Section>
    </div>
  );
}

function Section({ title, eyebrow, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <p className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</p>
      <h2 style={{
        fontFamily: "var(--display)", fontSize: 26, fontWeight: 400,
        letterSpacing: "-0.02em", margin: "0 0 14px", color: "var(--ink)"
      }}>{title}</h2>
      <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
        {children}
      </div>
    </section>
  );
}

function Quote({ children }) {
  return (
    <blockquote style={{
      margin: "10px 0",
      padding: "12px 18px",
      borderLeft: "2px solid var(--accent)",
      background: "var(--paper)",
      borderRadius: "0 8px 8px 0",
      fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6,
    }}>{children}</blockquote>
  );
}

function Compare({ left, right }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
      {[left, right].map((col, i) => (
        <div key={i} className="card" style={{ padding: "16px 18px" }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>{col.title}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {col.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{it}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

window.NotesView = NotesView;
