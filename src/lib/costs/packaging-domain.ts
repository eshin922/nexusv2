/**
 * The guarded-slice name for Packaging cost rows.
 *
 * One constant, imported by the reader that emits the witness, the client that
 * arms against it, and the tests that assert both. A domain is a string key
 * matched between two sides that never see each other at compile time — a
 * typo would not fail the build, it would silently arm a requirement no reader
 * can ever settle, and the read would be held until the surface unmounted.
 *
 * Kept in its own module rather than in `costing-store.ts` so that the server
 * reader can import it without pulling the client store's module graph into a
 * server action.
 */
export const PACKAGING_DOMAIN = "packaging";
