import assert from "node:assert/strict";
import test from "node:test";
import { quotePageKey, validQuotePageKey } from "../../src/lib/quote-page-presence.ts";

const project = "42534f11-ca4d-4ad9-8b6b-152164b99e6f";
const quote = "5e4ad1c4-5623-4593-8b8c-8d59e402a8fc";

test("presence is scoped to the exact quote page, not its neighboring quote", () => {
  assert.equal(quotePageKey(`/projects/${project}/quotes/${quote}/costs`, project, quote), "costs");
  assert.equal(quotePageKey(`/projects/${project}/quotes/${quote}/quote`, project, quote), "quote");
  assert.equal(quotePageKey(`/projects/${project}/quotes/${quote}`, project, quote), "overview");
  assert.equal(quotePageKey(`/projects/${project}/quotes/${quote}2/costs`, project, quote), null);
  assert.equal(quotePageKey(`/projects/${project}/quotes/${quote}/admin`, project, quote), null);
});

test("only known quote surfaces become presence keys", () => {
  assert.equal(validQuotePageKey(`leaves/${quote}/specs`), true);
  assert.equal(validQuotePageKey("setup/review"), true);
  assert.equal(validQuotePageKey("../admin/users"), false);
  assert.equal(validQuotePageKey("costs/private"), false);
});
