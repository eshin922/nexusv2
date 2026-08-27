// OD-012 — governed migration index uniqueness.
//
// THE CONTRACT THIS ENFORCES:
//   The next governed hand-authored migration index is derived from the HIGHEST
//   OCCUPIED governed index, never from _journal.json's entry count.
//
// Why the distinction is load-bearing: 0049/0050 are intentionally unjournaled
// drafts, so entry count (64) sits permanently below max index (65). Drizzle
// numbers from entry count, so `drizzle-kit generate` writing into drizzle/
// would emit an index that is already occupied. Repair 2 sends it to a scratch
// directory instead; this verifier catches the mistake if it ever lands anyway.
//
// The draft exemption is recorded per-file by its OWN declared contract — it is
// not a general licence for duplicate numbering.
import { readdirSync, readFileSync } from "node:fs";

const DRAFT_EXEMPT = new Set([
  "0049_product_structure_slice1_backfill",
  "0050_product_structure_slice1_contract",
]);

const files = readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: Array<{ tag: string }>;
};
const journalTags = journal.entries.map((e) => e.tag);

const problems: string[] = [];
const idxOf = (tag: string) => Number.parseInt(tag.slice(0, 4), 10);

// 1 · No governed index may be occupied twice on disk.
const byIndex = new Map<number, string[]>();
for (const f of files) {
  const i = idxOf(f);
  if (!byIndex.has(i)) byIndex.set(i, []);
  byIndex.get(i)!.push(f);
}
for (const [i, tags] of byIndex) {
  if (tags.length > 1) {
    problems.push(`index ${String(i).padStart(4, "0")} occupied by ${tags.length} files: ${tags.join(", ")}`);
  }
}

// 2 · No journal index may appear twice.
const seen = new Set<number>();
for (const t of journalTags) {
  const i = idxOf(t);
  if (seen.has(i)) problems.push(`journal has a duplicate entry at index ${i} (${t})`);
  seen.add(i);
}

// 3 · Every unjournaled file must be a RECORDED draft, and must say so itself.
for (const f of files) {
  if (journalTags.includes(f)) continue;
  if (!DRAFT_EXEMPT.has(f)) {
    problems.push(
      `${f}.sql is absent from _journal.json and is not a recorded draft. ` +
        `Either journal it or add it to DRAFT_EXEMPT with its rollout contract.`,
    );
    continue;
  }
  const body = readFileSync(`drizzle/${f}.sql`, "utf8");
  if (!/DRAFT/i.test(body) || !/_journal\.json/.test(body)) {
    problems.push(
      `${f}.sql is exempted as a draft but no longer declares that contract in ` +
        `its own header. The exemption must be self-evidencing.`,
    );
  }
}

// 4 · Report the authority the next migration must use.
const maxIndex = Math.max(...files.map(idxOf));

if (problems.length > 0) {
  console.error("[migration-index] FAILED\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  `[migration-index] OK · ${files.length} files · ${journalTags.length} journaled · ` +
    `${DRAFT_EXEMPT.size} recorded drafts · highest occupied index ${String(maxIndex).padStart(4, "0")} ` +
    `→ next governed migration is ${String(maxIndex + 1).padStart(4, "0")}`,
);
