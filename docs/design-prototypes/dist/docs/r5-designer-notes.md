# Round 5 — Designer notes

> Edward's tools. Firm policy, markup defaults, audit log. Small surface, big
> consequences — these three pages are how the system tells the truth about
> itself.

---

## Anchors carried in

From Round 4 we inherit the two-tier rail and the principle that the outer rail
is for the rare cross-project hop. Admin pages are exactly that: rare hops,
done by one person (Edward), usually in response to a specific event (a bad
quarter, a noisy line item, a forensic question).

Two consequences:

1. **The admin shell reuses the outer rail with a different active state and
   no inner rail.** No second navigation system; just a different surface
   nested in the same chrome.
2. **The page is the form.** Read view and edit view share one URL; the edit
   panel surfaces above the read content rather than replacing it. You don't
   lose your place when you decide to change something.

---

## Three pushbacks

### 1. The portfolio-effect strip is not a chart

I was asked, sketching this round, "shouldn't the firm-settings page have a
margin distribution histogram so Edward can see where his quotes cluster?"

It shouldn't. Edward is not a data analyst — he's a firm owner who already
*knows* roughly where his quotes cluster (he sends most of them himself or
reviews them when Maya does). What he needs at this surface is *consequence
of policy change*: if I move target from 35 to 40, what slips? That's a
re-banding question, not a distribution question.

The strip we shipped — `14 ≥35% · 8 25–35% · 2 <25%` — is the smallest possible
read of that. In edit mode it becomes the re-band preview, with affected
quotes named, not just counted. A histogram would let Edward stare at his
business; the re-band preview makes him *commit* to a specific change with
its costs visible.

If we hear "I want to see the distribution before I change policy," we should
ask which decision they're trying to make. Usually the real ask is: *am I
about to break a deal in flight?* And that's exactly what the affected-quotes
list answers.

### 2. Cascade tagging is non-negotiable; cascade UI is

The audit log will contain cascades — a single supplier-cost paste touches
four SKU rows × four tiers = sixteen derived facts. We've decided in the
data-source map that each derived write carries `caused_by_audit_id` linking
back to the source. That's the schema commitment.

The UI commitment is harder. I'm pushing back on logging sixteen rows into
the human-readable feed:

- Auditors scan; sixteen near-identical rows for one paste-the-quote action
  destroys signal.
- The information is not lost — it's queryable through the link.
- The chip ("cascade · 4 rows × 4 tiers re-derived") plus the cascade
  summary in the diff gives auditors the rope to pull on without making the
  feed unreadable.

But I want to flag the concession: a strict auditor — the kind a Series B
diligence team brings — may want every derived write visible by default. We
should ship a "show derived writes" toggle on the filter bar before any
external audit. **Listed as a commitment below.**

### 3. Inline editing on Markup defaults instead of a modal

A modal would be more "designed." It would also be wrong. Each row is a single
percentage; the form *is* the row. The whole table fits on one screen, and
opening a modal that shows you the same row's name and a number input is
ceremony.

The price is that we have to commit to one row in edit mode at a time
(otherwise it's a bulk-edit form and we lose audit-log granularity). The
"Saving 40% → 42% will recompute 142 line items across 11 draft quotes"
inline disclosure does the work a modal's "are you sure" would have done —
but as ambient information, not interruption.

Re-evaluate when categories pass 25 — at that point grouping by FR-15 family
(Materials / Operations / Services / Other) becomes worth the layer.

---

## Considered and rejected

| Idea | Why we didn't ship |
|---|---|
| Per-client target/floor overrides | Nathaniel raised this on a call. Real ask, but expressing it requires a precedence model (firm < client < project?) and a UI to manage exceptions. Park until we hear the *third* request from a different client. |
| Per-PM markup defaults | Two PMs work at this firm. Adding a layer for two people and one outlier preference is rounding error. |
| "What changed since last visit" digest on audit log | Cute. But the user who wants this is *Edward arriving Monday morning*, not the auditor. Different surface (deal organizer's "What's my move" already does this for projects); not the audit log's job. |
| Real-time activity stream (firehose) | Audit log is forensic. A firehose is a different product — slack notifications, presence dots, deal-level activity. Round 4's deal organizer covers it for the active-work case. |
| Editable category vocabulary | FR-15 categories are locked by accounting integration. The "+ NEW CATEGORY" button is drawn but inert; we'd ship the action when the integration grows or a category is unambiguously missing. |
| Margin-distribution histogram | See pushback #1. |
| Per-quote "frozen-at" markup table on every quote detail page | We say it on the markup-defaults page in prose. Putting it on every quote is repetition; if a PM asks "why did this quote get 38% markup," they can read the line item's `markup_pct` snapshot and the audit log can tell them when. |

---

## Commitments out of this round

1. **Cascade tagging at write-time.** Every derived write carries
   `caused_by_audit_id`. Backend slice — names it explicitly because the audit
   log silently depends on it.
2. **"Show derived writes" toggle on audit log.** Off by default; on for
   external audit / forensic deep-dive. We need this before Series B
   diligence, not after the request.
3. **Effective-dated `firm_settings_history` table.** Real history rows, not
   updated-in-place. The portfolio-effect re-band requires the ability to
   compute "what would have been" against a prior policy.
4. **Markup snapshot on quote send.** Already named in Slice 9; the UI
   commitment in this round is to *say so* on the markup-defaults page so
   PMs trust it.
5. **Dry-run cost-stack engine** for the markup-defaults edit preview
   ("estimated blended-margin shift +0.6 to +1.4 pts"). Approximation is
   acceptable; surface "estimate" wording until the real engine ships.
6. **Search trigram index on audit log `summary` + `entity_label`.** Without
   it, free-text search on audit becomes the user-hostile "filter chips
   only" experience and the search box has to be removed.

---

## Carry-forward to later rounds

- A **"What changed about my book this week"** Edward-Monday-morning surface
  is real. Not built here. Likely lives at the cross-project organizer level
  with policy events surfaced alongside deal events.
- **Permission roles**: this round assumed a single binary (admin sees
  these pages; PM doesn't). Reality is a three-tier model — admin / PM /
  read-only. We need a role editor before adding a fourth person to the firm.
- **Notifications when policy changes affect *my* in-flight quotes.** When
  Edward moves target 35→40, Maya's drafts get re-banded; she should see a
  toast or organizer-level signal, not discover it next time she opens that
  quote. Cross-cutting; deferred.

---

## Sign-off ask

What I want before declaring R5 done:

1. Confirmation that cascade tagging is in scope for the same backend slice
   that ships audit-log writes (otherwise we have a chicken/egg).
2. Edward's read on whether the re-band preview lists the *right* affected
   quotes — names, not just counts. If he wants project + scenario + version
   shown, we have it; if he wants client name only, we trim it.
3. A "yes" or "no, do this instead" on the audit-log cascade chip approach.
   It's defensible but not the only answer.
