"use client";

import { useRef, useTransition } from "react";
import { updateProjectCategory } from "@/app/actions/projects";

const CATEGORIES = [
  { value: "packaging", label: "Packaging" },
  { value: "turnkey", label: "Turnkey" },
  { value: "soft_goods", label: "Soft Goods" },
  { value: "secondary", label: "Secondary" },
  { value: "other", label: "Other" },
] as const;

export function CategorySelect({
  projectId,
  value,
}: {
  projectId: string;
  value: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form ref={formRef} action={updateProjectCategory} className="inline-flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="category"
        defaultValue={value}
        disabled={pending}
        onChange={() => {
          startTransition(() => formRef.current?.requestSubmit());
        }}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50"
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-gray-400">Saving…</span>}
    </form>
  );
}
