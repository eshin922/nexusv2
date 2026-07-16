# Gate 0 Send-hang · CC diagnosis

**To:** CA + Edward
**From:** CC
**Re:** Root cause of the Send hang. Report before fix (standing discipline).
**Status:** Diagnosis LOCKED. Awaiting fix disposition.

---

## TL;DR

**Root cause: the native `confirm()` dialog at `preview-toolbar.tsx:33`
blocks CB's browser-automation input dispatch.** The Send handler is
paused at the modal; a human user would see the dialog and dismiss
it, but CB can't. The 30s `Input.dispatchMouseEvent` timeout matches
Chrome's automation-can't-interact-with-native-modals signature
exactly.

**This is not** a client-side render hang, a main-thread CPU pin, a
server action bug, or a Step 6 regression. `sendQuote` genuinely
never dispatches because the handler execution is suspended at the
confirm dialog, waiting for a click on OK/Cancel that automation
can't provide.

CA §10 rollback (revert Step 6) is unwarranted — server code is fine.
Fix lives in the client Send handler.

---

## §1 · §2 DB checks — CONFIRMED

Ran against quote `9cff9b26-0506-4fbf-a925-185e82424f5b` via
`DIRECT_URL` (session-mode pooler):

**§2a — quotes row:**
```
pdf_url:         null
sent_at:         null
quote_number:    null
status:          draft
scenario_label:  smoke-step-8
version_number:  1
```

**§2g — audit_log `quote_sent` rows:** **0**

**§2 — all audit rows for this quote (any action):** 1 row,
`action=created` at 2026-07-15 11:31:37 PDT (scenario creation, not
send). No `quote_sent`, no `pdf_snapshot_written`, no send-path
artifacts of any kind.

**§2b — Storage `quote-pdfs/`:** inferred empty (pdf_url is null →
`getSupabaseServer().storage.from().upload()` was never called →
no object could exist for this quote).

**Confirmation: the action never ran. The hang is entirely
client-side, pre-dispatch.** Matches CA's initial diagnosis.

---

## §2 · §3 client-handler suspects — walked

Re-read the Send handler + toolbar wiring end-to-end:

### 2.1 · The `SendButton.onClick` handler

```ts
function onClick() {
  if (
    !confirm(
      "Send this quote?\n\n" +
        "This will:\n" +
        "  • Transition the quote to status='sent' ...\n" +
        "  ...\n" +
        "The PDF becomes the immutable sent artifact. Continue?",
    )
  ) {
    return;
  }
  const fd = new FormData();
  fd.set("quoteId", quoteId);
  startTransition(async () => {
    const r = await sendQuote(fd);
    ...
  });
}
```

(`src/components/quote/preview-toolbar.tsx:32-57`)

The handler does no heavy work before `startTransition`. No
`buildQuoteDocument`, no `renderToBuffer`, no serialization, no
loop over cells/leaves. Just `confirm()` → `FormData` → dispatch.

### 2.2 · Suspect ranking after code walk

| # | Suspect | Verdict |
|---|---|---|
| 1 | react-pdf running on main thread in Send handler | **NOT this.** Zero react-pdf imports in preview-toolbar.tsx. Zero client-side render calls anywhere in the Send path. `buildQuoteDocument`/`renderToBuffer` are inside `sendQuote` server action; the `"use server"` directive at `quotes.ts:1` prevents client bundling of the module body. The verify:react-pdf-containment gate confirms containment (5 allowlisted callers only). |
| 2 | Blocking serialization / sync prep before action call | **NOT this.** Handler builds a 1-field FormData, nothing else. Trivial. |
| 3 | PR #120 / Step-6 toolbar batch introduced a shared blocking handler | **NOT this.** The other toolbar buttons use `window.open(...)` (Download PDF, Download+mail) — synchronous, non-blocking. No shared handler with Send. |
| 4 | **Native `confirm()` blocks browser automation** (new suspect from walk) | **THIS IS IT.** Details below. |

### 2.3 · Why `confirm()` fits every observation

CA memo's observed signature:
- **30s `Input.dispatchMouseEvent` timeout** — Chrome DevTools Protocol's Input dispatch WAITS for the target event to be processed. A native modal (`confirm`) is synchronous and suspends the event loop until dismissed. Automation's dispatch call blocks until timeout (30s default) because the click is technically still being "processed" by the pending modal.
- **Screenshots/JS-eval fail "page is busy" for 30s+** — Chrome DevTools Protocol treats the page as busy while a native dialog is open; runtime evaluation and screenshot commands are blocked or queued.
- **Network log shows ONLY Clerk auth session-refresh calls** — Clerk's session-refresh polls run on their own JS timer, which is independent of the modal; timers fire in the background even while confirm() is showing. But the Send POST is dispatched *inside* the handler, AFTER confirm() returns — that code path is never reached because confirm() blocks the caller.
- **Reproducible twice** — every Send click opens the confirm dialog; automation never dismisses it.
- **Independent second tab shows the quote stays draft** — server truly never received a send request. Consistent with automation-stuck-at-modal.
- **No recovery in-session** — confirm dialog stays open across the entire session until manually dismissed (or the tab is closed).

The signature is **automation-modal-collision**, not
CPU-pin-on-main-thread. The distinction matters because the fix is
completely different.

### 2.4 · Corroborating banked knowledge

From my own system prompt (Chrome browser automation section):
> "IMPORTANT: Do not trigger JavaScript alerts, confirms, prompts,
> or browser modal dialogs through your actions. These browser
> dialogs block all further browser events and will prevent the
> extension from receiving any subsequent commands."

This constraint applies to CB's browser automation too (Chrome-in-
Chrome MCP, Playwright, Puppeteer, Selenium — all have the same
issue with native modals). CB's earlier observations match this
banked failure mode exactly.

### 2.5 · Sanity check — human path

A HUMAN user clicking Send would:
1. See the confirm dialog
2. Read the copy ("Send this quote? … Continue?")
3. Click OK (or Cancel)
4. Handler resumes, dispatches `sendQuote`, awaits result
5. Success → alert("Sent · <quoteNumber>")

**The Send path IS working end-to-end for a human user.** Edward
can drive Gate 0 manually on the current #122 preview and it should
succeed (assuming §2 side bugs don't block the setup).

---

## §3 · Fix options (for CA disposition)

### Option A · Remove `confirm()` entirely

**Change:** delete lines 33-45 of preview-toolbar.tsx; go directly
to FormData + startTransition.

**Pros:** immediate automation-friendly; smallest diff.
**Cons:** removes the only guardrail against accidental Send. An
immutable-state-transition button with zero friction is a foot-gun
(one misclick and the quote is frozen forever until admin override
reverts it). PR #78's decision (Slice 11 Step 6) explicitly kept the
confirm as "the only guardrail against accidental sends now that the
button is un-gated — do NOT remove the confirm step." Reversing that
disposition should be explicit.

### Option B · Replace `confirm()` with a React modal

**Change:** build a `<ConfirmSendModal>` component (portal + focus
trap), triggered by Send button click. Handler dispatches when the
modal's Confirm button is clicked.

**Pros:** keeps the guardrail; automation-friendly (CB clicks a real
DOM button, not a native modal); more control over copy + styling.
**Cons:** more work — ~30-60 minutes. Adds a component + focus-trap
logic. Adds a modal to an already-modal-heavy area (customer notes
drawer already opens a modal).

**Note:** the codebase has a Slice 8 dialog pattern already
(`src/components/pricing/reverse-solve-dialog.tsx` from HIGH-1 audit
fix) — could crib the portal + scope-class pattern.

### Option C · Leave `confirm()`; document CB workaround

**Change:** none in code. CB smokes §2-§7 matrix; Edward does Gate 0
manually.

**Pros:** zero change. Guardrail preserved.
**Cons:** future automated smokes always require Edward for Gate 0.
Slice 12+ smokes would inherit the limitation. Not scalable.

### Option D · Add a query-param bypass

**Change:** if `?skip_send_confirm=1` in URL, skip the confirm.
CB drives the preview with the flag.

**Pros:** cheapest guardrail preservation for production; small
diff.
**Cons:** test-only escape hatch smells; someone could discover +
share the URL and bypass in prod. Also — a `?skip_send_confirm=1`
query param that both Send and something like a shared audit
history can distinguish would need care.

### CC recommendation

**Option B (React modal).** Best balance:
- Automation works (CB can click the modal button)
- Guardrail intact (deliberate two-click send)
- Follows existing modal pattern (reverse-solve dialog)
- Small enough to fold into Slice 11 as a Step 6 hotfix

Estimated: 30-45 min for the modal + wire-up.

If Edward wants the fastest possible unblock: **Option A + explicit
disposition** to remove the guardrail. But I'd want that
disposition on the record — reversing PR #78's decision is a real
call, not a mechanical shortcut.

---

## §4 · Side bugs from CB — banked, not blocking

Per CA memo §4, these are separate tickets:

1. **Production cost-line inputs don't persist after Save+reload.**
   Real data-loss bug on Costs → Production; same `cm_assembly_total`
   / `filling_blending_cost` area the #78 carve touched. CB
   couldn't get PROD nonzero. Own ticket; not investigated here.
2. **No discoverable "create ASY" affordance.** Search-for-a-
   nonexistent-product → "+ Create new product" → "Add product ·
   ASY" is the only path. UX gap. Bank for post-Slice-11.

---

## §5 · Sequencing (per CA §5)

- [x] §2 DB/Storage checks → diagnosis locked (this doc)
- [x] §3 client-handler diagnosis → root cause identified (this doc)
- [ ] **CA dispositions fix option A/B/C/D**
- [ ] Ship fix on a new branch (does NOT touch PR #122)
- [ ] Fresh preview builds → CB restarts from Gate 0
- [ ] If Gate 0 clears → CB continues §2 matrix
- [ ] PR #122 merges after full smoke clean
- [ ] Slice 11 closes

Side bugs (§4) proceed on their own track.

---

## §6 · §0.5 catch (bank on close)

When resolved, bank as a §0.5 catch. Shape:

> **Native `confirm()` blocks browser-automation smoke.** Any
> `confirm()`/`alert()`/`prompt()` in a user-facing handler is a
> hard block for browser-driven smoke agents (Chrome DevTools
> Protocol, Playwright, Puppeteer, etc.) — the modal opens, but
> the agent can't dismiss it, and every subsequent command times
> out. Discovered when Slice 11 Step 8 Gate 0 failed on CB's
> Send-button click; the `sendQuote` server action was never
> reached because the handler was suspended at the confirm dialog.
> Class B (process discipline — automation-friendliness is a
> testability property that needs explicit consideration during
> UI design). Fix pattern: prefer React modals over native dialogs
> for any handler in the smoke matrix.

Cumulative: 81 across 16 slices (when banked).

---

## §7 · Awaiting

- CA disposition on §3 (Option A/B/C/D)
- Once dispositioned, CC ships the fix on `hotfix/gate-0-send-modal`
  (or equivalent) branch → PR → CB re-smoke

PR #122 stays open, unmerged. Slice 11 stays open.
