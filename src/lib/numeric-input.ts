import { ActionGuardError, ERR } from "./action-result.ts";

type Entry = FormDataEntryValue | string | null | undefined;

export type DecimalContract = {
  field: string;
  label: string;
  nullable?: boolean;
  scale: number;
  precision: number;
  min?: number;
  minExclusive?: number;
  max?: number;
};

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const INTEGER = /^[+-]?\d+$/;

function fail(field: string, message: string): never {
  throw new ActionGuardError(ERR.VALIDATION, message, field);
}

function raw(entry: Entry): string {
  return String(entry ?? "").trim();
}

function schemaMaximum(precision: number, scale: number): number {
  return Number(`${"9".repeat(precision - scale)}${scale ? `.${"9".repeat(scale)}` : ""}`);
}

/**
 * Strictly parses a decimal for a numeric(p,s) column. It rejects malformed,
 * non-finite, over-precision, and out-of-domain input before any write occurs.
 */
export function parseDecimalInput(
  entry: Entry,
  contract: DecimalContract,
): string | null {
  const value = raw(entry);
  if (value === "") {
    if (contract.nullable) return null;
    return fail(contract.field, `${contract.label} is required.`);
  }
  if (!DECIMAL.test(value)) {
    return fail(contract.field, `${contract.label} must be a valid decimal number.`);
  }

  const unsigned = value.replace(/^[+-]/, "");
  const [integerPartRaw, fraction = ""] = unsigned.split(".");
  const integerPart = (integerPartRaw || "0").replace(/^0+(?=\d)/, "");
  if (fraction.length > contract.scale) {
    return fail(
      contract.field,
      `${contract.label} supports at most ${contract.scale} decimal places.`,
    );
  }
  if (integerPart.length + fraction.length > contract.precision) {
    return fail(contract.field, `${contract.label} exceeds the supported size.`);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fail(contract.field, `${contract.label} must be finite.`);
  }
  const schemaMax = schemaMaximum(contract.precision, contract.scale);
  const max = Math.min(contract.max ?? schemaMax, schemaMax);
  if (numeric > max) {
    return fail(contract.field, `${contract.label} must not exceed ${max}.`);
  }
  if (numeric < -schemaMax) {
    return fail(contract.field, `${contract.label} exceeds the supported size.`);
  }
  if (contract.min !== undefined && numeric < contract.min) {
    return fail(contract.field, `${contract.label} must be at least ${contract.min}.`);
  }
  if (
    contract.minExclusive !== undefined &&
    numeric <= contract.minExclusive
  ) {
    return fail(
      contract.field,
      `${contract.label} must be greater than ${contract.minExclusive}.`,
    );
  }

  return value;
}

export function parseMoneyTotal(
  entry: Entry,
  field: string,
  label: string,
): string | null {
  return parseDecimalInput(entry, {
    field,
    label,
    nullable: true,
    precision: 12,
    scale: 2,
    min: 0,
  });
}

export function parseUnitMoney(
  entry: Entry,
  field: string,
  label: string,
): string | null {
  return parseDecimalInput(entry, {
    field,
    label,
    nullable: true,
    precision: 10,
    scale: 4,
    min: 0,
  });
}

export function parsePositivePrice(
  entry: Entry,
  field = "sellPriceOverride",
  label = "Sell price override",
): string | null {
  return parseDecimalInput(entry, {
    field,
    label,
    nullable: true,
    precision: 10,
    scale: 4,
    minExclusive: 0,
  });
}

export function parseIntegerInput(
  entry: Entry,
  contract: {
    field: string;
    label: string;
    nullable?: boolean;
    min?: number;
    minExclusive?: number;
    max?: number;
  },
): number | null {
  const value = raw(entry);
  if (value === "") {
    if (contract.nullable) return null;
    return fail(contract.field, `${contract.label} is required.`);
  }
  if (!INTEGER.test(value)) {
    return fail(contract.field, `${contract.label} must be a whole number.`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    return fail(contract.field, `${contract.label} must be a safe whole number.`);
  }
  if (contract.min !== undefined && numeric < contract.min) {
    return fail(contract.field, `${contract.label} must be at least ${contract.min}.`);
  }
  if (
    contract.minExclusive !== undefined &&
    numeric <= contract.minExclusive
  ) {
    return fail(
      contract.field,
      `${contract.label} must be greater than ${contract.minExclusive}.`,
    );
  }
  if (contract.max !== undefined && numeric > contract.max) {
    return fail(contract.field, `${contract.label} must not exceed ${contract.max}.`);
  }
  return numeric;
}

export function parsePercentDisplay(
  entry: Entry,
  contract: {
    field: string;
    label: string;
    nullable?: boolean;
    minPercent: number;
    maxPercent: number;
  },
): string | null {
  const display = parseDecimalInput(entry, {
    field: contract.field,
    label: contract.label,
    nullable: contract.nullable,
    precision: 6,
    scale: 2,
    min: contract.minPercent,
    max: contract.maxPercent,
  });
  if (display === null) return null;
  return (Number(display) / 100).toFixed(4);
}

export function parseMarkupDecimal(
  entry: Entry,
  field: string,
  label: string,
): string | null {
  return parseDecimalInput(entry, {
    field,
    label,
    nullable: true,
    precision: 5,
    scale: 4,
    min: 0,
    max: 9.99,
  });
}

export function parseMarginPercent(
  entry: Entry,
  field: string,
  label: string,
): string | null {
  return parsePercentDisplay(entry, {
    field,
    label,
    nullable: true,
    minPercent: 0,
    maxPercent: 99.99,
  });
}
