# Slice 13 cutover strategy

This is a planning framework. Names, dates, credentials, maintenance window,
and final authority are **Requires manual discovery**.

## Pre-cutover checklist

- Go/No-Go dashboard complete; parity, shadow mode, UAT, training, security,
  backup, monitoring, support, and rollback approvals recorded.
- Active integration inventory revalidated immediately before cutover.
- Production NetSuite account, role, permissions, forms, scripts, workflows,
  mappings, tax, terms, segments, and item configuration verified.
- Production credentials staged through the approved secret manager but not
  activated early; access is least privilege and rotation is rehearsed.
- Nexus idempotency, first-transaction cohort, reconciliation, and duplicate
  writer controls verified.
- Legacy workflow disable/restore steps and owners confirmed.
- `$0.00` catalog values proven unable to become transaction prices.

## HubSpot workflow retirement

Export and version the active workflow definitions and dependencies. At
cutover, disable only the verified legacy Sales Order writer after Nexus
readiness is confirmed. Preserve a reversible restoration path during the
rollback window. Custom Code Actions, webhooks, and downstream consumers must
be dispositioned individually; repository evidence cannot identify them.

## Production credential activation

Use a two-person check of account identity, role, endpoints, and write scope.
Activate only during the approved window. Run a read-only identity check before
the first write and record the credential version—not secret values—in the
execution log.

## Go / No-Go process

The decision chair reviews
[GO_LIVE_READINESS_CHECKLIST.md](GO_LIVE_READINESS_CHECKLIST.md). Any blocker,
unknown authoritative writer, failed rollback drill, incomplete sign-off, or
unexplained parity difference is No-Go. Exceptions require documented owner,
risk acceptance, expiry, and rollback trigger.

## Execution and monitoring

1. Announce change window and support channel.
2. Quiesce/disable the verified legacy writer.
3. Confirm no in-flight duplicate transaction.
4. Activate Nexus production configuration.
5. Process the approved first cohort.
6. Reconcile customer, lines, quantities, rates, totals, classifications,
   dates, tax/default behavior, Item Groups, and HubSpot effects.
7. Monitor API errors, latency/rate limits, idempotency records, failed pushes,
   unmatched mappings, amount/stage divergence, and support reports.

## Rollback

Stop new Nexus production completions, preserve evidence, restore the exported
legacy workflow, verify its identity/state, reconcile in-flight transactions,
and rotate/restrict Nexus production credentials if required. Do not delete or
edit already-created Sales Orders as an automatic rollback step; Accounting
and NetSuite administrators decide transaction disposition.

Rollback triggers include duplicate/misrouted orders, material price/quantity/
tax/customer differences, production isolation breach, widespread mapping
failure, or loss of observability.

## Communication

Provide pre-window notice, start/no-go/go/rollback announcements, transaction
reconciliation updates, known-issue guidance, daily hypercare summaries, and a
formal close. Audience and senders for Sales, Operations, Accounting, PM, IT,
executives, and customer-facing teams require assignment.

## Legacy retirement

After hypercare and rollback-window approval, archive definitions/evidence,
remove credentials and schedules through controlled change, verify no triggers
remain, update inventories/runbooks, and retain restore/audit material per the
  approved retention policy. Never retire an unknown integration by inference.
