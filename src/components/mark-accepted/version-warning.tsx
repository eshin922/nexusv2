"use client";

import { useState } from "react";

// Slice RI.6 — sent-vs-draft mismatch banner (visual shell).
// Real version-pinning + snapshot logic lands Slice 11. The banner
// content + dismiss-state here are component-local; not persisted.

export function VersionWarning({
  sentVersion,
  draftVersion,
}: {
  sentVersion: string;
  draftVersion: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="version-warning">
      <div className="icon">!</div>
      <div className="text">
        <h4>
          You sent <strong>{sentVersion}</strong> · current draft is{" "}
          <strong>{draftVersion}</strong>
        </h4>
        <p style={{ margin: 0 }}>
          The customer is responding to <strong>{sentVersion}</strong>. The tier
          prices below reflect <strong>{sentVersion} (the sent version)</strong>
          , not the {draftVersion} edits in your draft. Mark-accepted will lock
          against {sentVersion} and discard {draftVersion} (or save {draftVersion}{" "}
          as a sibling scenario — your pick).
        </p>
        <div className="actions">
          <button
            className="btn sm"
            onClick={() =>
              alert("Stub — Slice 11 wires snapshot preview render.")
            }
          >
            View {sentVersion} (sent) preview
          </button>
          <button
            className="btn sm"
            onClick={() =>
              alert(
                "Stub — Slice 11/audit-log slice ships the diff surface.",
              )
            }
          >
            Compare {sentVersion} ↔ {draftVersion} changes
          </button>
          <button className="btn sm ghost" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
