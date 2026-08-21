# Accounting UAT — Case 8 · Pack-out / Assembly Direct Service

**PASS**, 2026-08-21. Terminal witness: **SO2722** (internal id `362841`).

Quote `08a76c99-729f-4028-8700-c9b8b1be59f4` — `CERT-304 packout assembly`,
`DPS-1059`, project `350456fc` on HubSpot deal `64175307673`
(*ZZ-VALIDATION — Nexus Certification Lineage V*).

## Provider evidence — read FROM NetSuite, compared against the frozen statement

```
FROZEN (Nexus)     dest=otc_packout   qty=1000  rate=7.0000  amount=7000.00
PROVIDER header    SO2722  entity=388800  foreigntotal=7000  deal=64175307673

item OTC-0049 / 76154 posted                      ok
posted qty     = frozen 1000                      ok
posted rate    = frozen 7.0000                    ok
posted amount  = frozen 7000                      ok
tax code -8                                       ok    tax total 0        ok
price level -1                                    ok
CUSTOM cost basis                                 ok    CUSTOM cost 5000   ok
REG-4 exact (header total vs frozen tier total)   ok    7000 vs 7000.00
```

**Provenance, exact at every hop:**
`packout_assembly` → `otc_packout` → `OTC-0049 / 76154` → posted `item=76154`.
Intent, destination, resolved item and posted item are the same identity, and
after #318 they are the same `ResolvedAccountingLine` object — readiness and
emission cannot disagree because there is one pass and one answer.

## REG-4 is independent BY CONSTRUCTION

REG-4 compares the provider **header total** against the frozen **tier
commercial total**. It is deliberately NOT recomputed from `qty × rate` — that
would restate the line-shape proof rather than corroborate it.

**SO2717 is why.** It is the standing negative witness: REG-4 exact while the
quantity/rate representation was wrong. A total that reconciles proves the money
is right; it proves nothing about how the line is shaped. The two claims are
carried separately here and must stay that way.

## NetSuite sign convention — recorded, not hidden

SuiteQL returns `transactionline` magnitudes **negative** for this transaction
while the header is **positive**:

```
line   quantity -1000   netamount -7000   costestimate -5000
header foreigntotal +7000
```

Comparisons are on magnitude, and the **uniformity of the sign is asserted as
its own claim**. An `abs()` with no accompanying assertion would absorb a
genuine sign error in the same call that absorbs the convention — the check
would stop being able to express the failure it exists to catch.

A second line (`item = -8`, amount 0) is the tax line.

## The certification lineage held

`64175307673` was `New (Acquiring Info)` at push time and **HubSpot was never
mutated** — the acceptance audit records `suppressed: true`, `stage_written:
false`, `amount_written: false`, with `from_stage_id == to_stage_id`. The Sales
Order carries the deal id without the deal having moved.

Lineage V was provisioned because deal `64142757296` already owned **SO2716**;
the one-deal/one-SO constraint was verified before the push with a positive
control (the same query returns SO2716 for the spent deal, and zero for this
one).

## What this case surfaced

Case 8 did not fail on its own subject. It failed on **#317** — the SO writer
still resolved Direct Services through the superseded `netsuite_service_item_map`
while governance and readiness had moved to `netsuite_destination_item_map`. A
correct, audited destination mapping was invisible to the writer, and the push
refused a fully mapped quote.

`CERT-304` was preserved in its failed state as the reproduction, then **resumed
from `accepted` without rebuilding** once #318 merged. The one-deal/one-SO
constraint was still unspent, so no fresh certification deal was needed.

Also opened, both deliberately out of scope here:

- **#316** — certification suppression defaults toward production sync when the
  env is absent. Pre-release governance.
- **#319** — destination-item liveness parity. Follow-up hardening: the removed
  legacy gate did a live NetSuite existence check the destination path does not.
  Characterized as non-blocking because the provider failure is clean — no
  partial SO, quote stays `accepted` with `netsuite_so_id` null, retry safe.

## Accounting UAT — GREEN

All eight cases covered. Case 8 was the last blocker.
