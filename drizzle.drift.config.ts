import { defineConfig } from "drizzle-kit";

// OD-012 Repair 2 — drift detection ONLY.
//
// `db:generate` writes here, never into the governed `drizzle/` directory.
// The generator is not a migration author in this repository: it numbers from
// _journal.json's ENTRY COUNT, which is permanently 2 behind the true index
// because 0049/0050 are intentionally unjournaled drafts. Letting it write into
// drizzle/ would produce duplicate migration indices.
//
// Governed migrations are hand-authored at (highest occupied index + 1).
//
// Expected output: ZERO statements. Anything emitted is real schema.ts-vs-
// database drift — classify it, never apply it blindly.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./.drizzle-drift",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgres://unused" },
});
