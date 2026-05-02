import { requireAdminPage } from "@/lib/admin-guard";
import {
  listMarkupDefaultReferenceCounts,
  listMarkupDefaults,
} from "@/app/actions/markup-defaults";
import {
  AddCategoryForm,
  MarkupDefaultsTable,
} from "./markup-defaults-table";

export default async function MarkupDefaultsAdminPage() {
  await requireAdminPage();
  const [rows, refCounts] = await Promise.all([
    listMarkupDefaults(),
    listMarkupDefaultReferenceCounts(),
  ]);
  // Plain object for client-component prop (Maps don't survive RSC
  // serialization — same pattern noted in costing.ts markupDefaults).
  const referenceCounts: Record<string, number> = {};
  for (const [k, v] of refCounts) referenceCounts[k] = v;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Markup defaults
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Per-category default markup percentages applied to packaging,
          production, and freight cost components when the line itself
          doesn't override.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Existing categories
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Edit a percent inline; saves automatically after a 500ms pause.
          Delete shows a warning when the category is referenced by
          existing packaging input rows — those rows keep their saved
          markup either way.
        </p>
        <MarkupDefaultsTable rows={rows} referenceCounts={referenceCounts} />
      </section>

      <section>
        <AddCategoryForm />
      </section>
    </div>
  );
}
