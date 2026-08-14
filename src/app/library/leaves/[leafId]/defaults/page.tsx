import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLeafForSpecEntry } from "@/lib/leaf-spec-loader";
import { SpecEntrySurface } from "@/components/spec-entry/spec-entry-surface";
import { ensureUser } from "@/lib/auth/ensure-user";

// B-3 · A — Library master editing.
//
// URL: /library/leaves/:leafId/defaults
//
// The DELIBERATE sibling of /projects/:id/quotes/:qid/leaves/:leafId/specs.
// Same surface, different authority, and the URL says which: this one is not
// nested under a quote because it does not belong to one.
//
// What it edits: the Library default — `quote_id IS NULL`. Changes establish
// the template FUTURE attachments start from. Existing quote-owned rows are
// never repointed or rewritten, and there is no "promote this quote's specs to
// the Library default" path in V1: the only way a quote's values reach the
// Library is an operator editing the Library on purpose, here.

export default async function LibraryDefaultsPage({
  params,
}: {
  params: Promise<{ leafId: string }>;
}) {
  const { leafId } = await params;
  await ensureUser();

  const data = await loadLeafForSpecEntry(leafId, { library: true });
  if (!data) notFound();

  // No NavShell: its rails are per-quote by construction (surfaceKey +
  // projectId + quoteId), and this surface deliberately belongs to no quote.
  // Borrowing quote chrome for a library surface would misstate the scope in
  // exactly the way this whole finding is about.
  return (
    <>
      <main className="a1v2-page">
        <div className="a1v2-head">
          <div className="eyebrow">
            <Link href="/">← All deals</Link>
            <span className="sep">·</span>
            <span>Product Library</span>
          </div>
          <h1>
            Library defaults <em>· {data.leaf.name}</em>
          </h1>
        </div>

        <SpecEntrySurface scope={{ library: true }} data={data} readOnly={false} />
      </main>
    </>
  );
}
