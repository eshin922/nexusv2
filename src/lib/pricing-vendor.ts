export class PricingDateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingDateValidationError";
  }
}

/**
 * Parses the date shown on the vendor quote or other pricing source.
 * The value is deliberately date-only: timezone conversion would corrupt
 * historical pricing provenance.
 */
export function parsePricingDateOnly(value: string | null): string | null {
  const raw = value?.trim() || null;
  if (raw === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    throw new PricingDateValidationError(
      "Pricing Date must be a valid YYYY-MM-DD date.",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new PricingDateValidationError(
      "Pricing Date must be a valid calendar date.",
    );
  }
  return raw;
}
