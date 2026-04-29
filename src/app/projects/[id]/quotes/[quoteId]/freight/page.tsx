import Link from "next/link";

export default async function FreightInputsPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-2 text-sm">
        <Link
          href={`/projects/${projectId}/quotes/${quoteId}`}
          className="text-gray-500 hover:text-gray-900"
        >
          ← Quote builder
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Freight inputs</h1>
      <p className="mt-2 text-sm text-gray-600">Coming in Slice 7.</p>
    </main>
  );
}
