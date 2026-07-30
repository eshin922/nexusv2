# Numeric input contracts

Shared strict parsers run before persistence, audit, revalidation, providers,
or artifacts.

- Totals: nullable, nonnegative `numeric(12,2)`.
- Unit money and overrides: schema scale, normally four decimals.
- Divisors: strictly positive safe integers.
- Markup: nonnegative within `numeric(5,4)`.
- Adjustments/discounts: negative only for explicitly controlled adjustment fields.
- Margin target/floor: 0–99.99%; owning action enforces their relationship.
- Price overrides: nullable to revert, otherwise strictly positive.

Exponent notation, partial numbers, NaN, infinity, excess precision, and
schema overflow are rejected. The result is `VALIDATION_ERROR` with a `field`;
the previous value remains and no success audit is emitted.

Production-cell autosave is a field patch, not a full-row replacement.
Persisted sibling values remain authoritative when client props are stale after
lazy row creation or server revalidation.
