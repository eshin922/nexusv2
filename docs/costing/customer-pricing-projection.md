# Customer pricing projection

`src/lib/costing.ts` owns unit math.
`src/lib/customer-view-resolver.ts` owns customer-safe projection. PDF
components render the projection and do not calculate prices.

Production COGS, packaging costs, margins, and markups are internal. Allocated
one-time fees appear only through unit prices. Non-allocated setup,
tooling/artwork, R&D, and other-service fees are excluded from unit math and
projected exactly once. Preview and PDF share this projection.

Send captures immutable customer view, snapshot, and PDF artifact. Later draft
or operational data never mutates historical customer-facing results.
