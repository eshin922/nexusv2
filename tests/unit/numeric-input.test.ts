import assert from "node:assert/strict";
import test from "node:test";

import { ActionGuardError } from "../../src/lib/action-result.ts";
import {
  parseIntegerInput,
  parseMarginPercent,
  parseMoneyTotal,
  parsePositivePrice,
} from "../../src/lib/numeric-input.ts";

function validationFailure(fn: () => unknown, field: string): ActionGuardError {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ActionGuardError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.field, field);
    return true;
  });
  try {
    fn();
  } catch (error) {
    return error as ActionGuardError;
  }
  throw new Error("Expected validation failure");
}

test("money totals accept nullable nonnegative numeric(12,2) values", () => {
  assert.equal(parseMoneyTotal("", "setupFeeTotal", "Setup fee"), null);
  assert.equal(
    parseMoneyTotal("1250.50", "setupFeeTotal", "Setup fee"),
    "1250.50",
  );
  assert.equal(
    parseMoneyTotal("9999999999.99", "setupFeeTotal", "Setup fee"),
    "9999999999.99",
  );
});

test("money totals reject negative, malformed, non-finite and excess precision", () => {
  for (const value of ["-0.01", "12abc", "NaN", "Infinity", "1e3", "1.001"]) {
    validationFailure(
      () => parseMoneyTotal(value, "bulkRawCost", "Bulk raw tier total"),
      "bulkRawCost",
    );
  }
});

test("positive prices reject zero and preserve four-place precision", () => {
  assert.equal(parsePositivePrice("12.3456"), "12.3456");
  validationFailure(() => parsePositivePrice("0"), "sellPriceOverride");
  validationFailure(() => parsePositivePrice("-1"), "sellPriceOverride");
  validationFailure(() => parsePositivePrice("1.23456"), "sellPriceOverride");
});

test("strict integer parser rejects fractional and partially parsed quantities", () => {
  assert.equal(
    parseIntegerInput("2500", {
      field: "actualUnitsProduced",
      label: "Actual units produced",
      nullable: true,
      minExclusive: 0,
    }),
    2500,
  );
  for (const value of ["0", "-1", "1.5", "12units", "1e3"]) {
    validationFailure(
      () =>
        parseIntegerInput(value, {
          field: "actualUnitsProduced",
          label: "Actual units produced",
          nullable: true,
          minExclusive: 0,
        }),
      "actualUnitsProduced",
    );
  }
});

test("margin targets accept 0 through 99.99 percent only", () => {
  assert.equal(parseMarginPercent("35", "targetMarginPct", "Target margin"), "0.3500");
  assert.equal(parseMarginPercent("0", "targetMarginPct", "Target margin"), "0.0000");
  validationFailure(
    () => parseMarginPercent("-1", "targetMarginPct", "Target margin"),
    "targetMarginPct",
  );
  validationFailure(
    () => parseMarginPercent("100", "targetMarginPct", "Target margin"),
    "targetMarginPct",
  );
});
