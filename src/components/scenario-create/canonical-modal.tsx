"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createScenario } from "@/app/actions/quotes";
import { addQuoteAttachment } from "@/app/actions/quote-attachments";

// canonical-scenario-create-flow Step 5 — canonical New Scenario
// modal client component.
//
// Path 3 bifurcation per CA Q1: scratch path functional; copy paths
// visible-disabled with "next slice" inline messaging.
//
// Modal CSS reuses impl-4 .a1v2-modal-* canonical primitives (Pattern
// 30); content (start-path radios + drop choice + attachment upload)
// is nexus-authored extension since the modal has no CD source
// (Pattern 28 N/A per CA disposition).
//
// Pattern 47 invariants: controlled inputs / textareas / selects;
// no `disabled={pending}` on any input element. Submit buttons may
// carry disabled={pending} for double-click protection.

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
]);

type StartPath = "scratch" | "copy_scenario" | "copy_quote";
type DropChoice = "keep" | "drop";

export type CanonicalScenarioModalProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  // Auto-name hint — "Alt N" placeholder where N = next-available
  // integer in the project (client-side display only; server
  // recomputes authoritatively at create time).
  nextAltLabel: string;
  // Current recommended scenario, used in the "Currently
  // recommended" interpolation when PM checks "Mark as
  // recommended". Null if no scenario is currently recommended
  // (rare after the impl-1 backfill).
  recommendedScenarioName: string | null;
  // The active scenario PM is creating-an-alternative-to. Drives
  // the "Drop the current scenario — '{name}'" interpolation +
  // the createScenario action's currentScenarioId param.
  currentActiveScenarioId: string | null;
  currentActiveScenarioName: string | null;
  // The current active scenario's tier labels feed the customer-
  // target-tier dropdown. Empty array = no tiers yet (rare).
  currentScenarioTierLabels: string[];
};

export function CanonicalScenarioModal({
  open,
  onClose,
  projectId,
  projectName,
  nextAltLabel,
  recommendedScenarioName,
  currentActiveScenarioId,
  currentActiveScenarioName,
  currentScenarioTierLabels,
}: CanonicalScenarioModalProps) {
  const router = useRouter();

  const [startPath, setStartPath] = useState<StartPath>("scratch");
  const [scenarioLabel, setScenarioLabel] = useState("");
  const [intentNote, setIntentNote] = useState("");
  const [targetTierLabel, setTargetTierLabel] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [dropChoice, setDropChoice] = useState<DropChoice>("keep");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset on close.
  useEffect(() => {
    if (open) return;
    setStartPath("scratch");
    setScenarioLabel("");
    setIntentNote("");
    setTargetTierLabel("");
    setRecommended(false);
    setDropChoice("keep");
    setFile(null);
    setFileError(null);
    setError(null);
  }, [open]);

  // Escape + outside-click dismiss.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, pending, onClose]);

  function validateFile(f: File): string | null {
    if (f.size > MAX_FILE_SIZE) return "File exceeds 25 MB limit.";
    if (!ALLOWED_MIME.has(f.type)) {
      return "Allowed: PDF, Word, Excel, images (PNG/JPG/WebP), plain text.";
    }
    return null;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setFile(null);
      setFileError(null);
      return;
    }
    const err = validateFile(picked);
    if (err) {
      setFile(null);
      setFileError(err);
      // Reset the file input so the same file can be re-selected if
      // PM corrects + retries (browsers cache the last selection).
      e.target.value = "";
      return;
    }
    setFile(picked);
    setFileError(null);
  }

  const copyPathSelected =
    startPath === "copy_scenario" || startPath === "copy_quote";
  const submitDisabled = pending || copyPathSelected;

  function handleSubmit() {
    if (copyPathSelected) {
      setError(
        "Copy operations ship in the next slice. For now, create from scratch.",
      );
      return;
    }
    if (dropChoice === "drop" && !currentActiveScenarioId) {
      setError(
        "No active scenario to drop. Choose 'Keep both' or surface this — drop choice requires an active scenario in the project.",
      );
      return;
    }

    startTransition(async () => {
      setError(null);

      const result = await createScenario({
        projectId,
        scenarioLabel: scenarioLabel.trim() || undefined,
        intentNote: intentNote.trim() || undefined,
        customerTargetTierLabel: targetTierLabel.trim() || undefined,
        scenarioRecommended: recommended,
        dropCurrentScenario:
          dropChoice === "drop" && currentActiveScenarioId !== null,
        currentScenarioId: currentActiveScenarioId ?? undefined,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      const newQuoteId = result.data.newQuoteId;

      // Optional attachment upload — fire after create so we have a
      // quoteId to bind. Failure here does NOT roll back the
      // create — the scenario lands; PM retries the upload via the
      // post-creation list (Step 7) if it fails.
      if (file) {
        const fd = new FormData();
        fd.set("quoteId", newQuoteId);
        fd.set("file", file);
        const upload = await addQuoteAttachment(fd);
        if (!upload.ok) {
          // Surface but don't block navigation — the scenario is
          // created; PM can retry attachment on the Setup surface.
          console.warn(
            `[canonical-modal] attachment upload failed: ${upload.error.message}; scenario created without attachment.`,
          );
        }
      }

      onClose();
      router.push(`/projects/${projectId}/quotes/${newQuoteId}/setup`);
    });
  }

  if (!open) return null;

  return (
    <div
      className="a1v2-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="a1v2-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canonical-scenario-modal-title"
        style={{ maxWidth: 600 }}
      >
        <div className="a1v2-modal-head">
          <h2 id="canonical-scenario-modal-title">
            + New scenario · {projectName}
          </h2>
        </div>

        <div className="a1v2-modal-body">
          {/* Start path */}
          <fieldset
            style={{
              border: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <legend
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                marginBottom: 6,
              }}
            >
              Start from
            </legend>

            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="start-path"
                value="scratch"
                checked={startPath === "scratch"}
                onChange={() => setStartPath("scratch")}
              />
              <span>Scratch</span>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="start-path"
                value="copy_scenario"
                checked={startPath === "copy_scenario"}
                onChange={() => setStartPath("copy_scenario")}
              />
              <span>Copy a scenario from this project</span>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="start-path"
                value="copy_quote"
                checked={startPath === "copy_quote"}
                onChange={() => setStartPath("copy_quote")}
              />
              <span>Copy a quote from another project</span>
            </label>

            {copyPathSelected ? (
              <div
                style={{
                  marginTop: 6,
                  padding: "10px 12px",
                  background: "var(--warn-soft)",
                  border: "1px solid oklch(from var(--warn) l c h / 0.30)",
                  borderRadius: 6,
                  fontSize: 12.5,
                  color: "var(--warn)",
                  lineHeight: 1.5,
                }}
              >
                ⏳ Copy operations ship in the next slice. For now, create
                from scratch and re-enter data manually.
              </div>
            ) : null}
          </fieldset>

          {/* Scenario name */}
          <div className="field">
            <span className="lbl">Scenario name</span>
            <input
              type="text"
              value={scenarioLabel}
              onChange={(e) => setScenarioLabel(e.target.value)}
              placeholder={nextAltLabel}
              disabled={copyPathSelected}
            />
          </div>

          {/* Intent note */}
          <div className="field">
            <span className="lbl">Why this scenario? (optional)</span>
            <textarea
              value={intentNote}
              onChange={(e) => setIntentNote(e.target.value)}
              placeholder="Why does this scenario exist?"
              disabled={copyPathSelected}
              rows={3}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </div>

          {/* Target tier */}
          <div className="field">
            <span className="lbl">Customer&rsquo;s target tier (optional)</span>
            <select
              value={targetTierLabel}
              onChange={(e) => setTargetTierLabel(e.target.value)}
              disabled={copyPathSelected}
            >
              <option value="">(unspecified)</option>
              {currentScenarioTierLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Attachment */}
          <div className="field">
            <span className="lbl">Brief or RFQ (optional)</span>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
              onChange={handleFileChange}
              disabled={copyPathSelected}
            />
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-4)",
                letterSpacing: "0.04em",
                marginTop: 2,
              }}
            >
              PDF / Word / Excel / Image · up to 25MB
            </span>
            {fileError ? (
              <span
                role="alert"
                style={{
                  color: "var(--bad)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                {fileError}
              </span>
            ) : null}
            {file ? (
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  marginTop: 4,
                }}
              >
                Selected: {file.name} ({Math.round(file.size / 1024)} KB)
              </span>
            ) : null}
          </div>

          {/* Recommended checkbox */}
          <label style={{ ...radioLabelStyle, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={recommended}
              onChange={(e) => setRecommended(e.target.checked)}
              disabled={copyPathSelected}
            />
            <span>
              Mark as recommended (★ Primary)
              {recommendedScenarioName ? (
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--ink-4)",
                    marginTop: 2,
                  }}
                >
                  Currently recommended: &ldquo;{recommendedScenarioName}&rdquo;
                </span>
              ) : null}
            </span>
          </label>

          {/* Drop choice */}
          <fieldset
            style={{
              border: "none",
              padding: 0,
              margin: "12px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <legend
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                marginBottom: 6,
              }}
            >
              What about the current scenario?
            </legend>

            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="drop-choice"
                value="keep"
                checked={dropChoice === "keep"}
                onChange={() => setDropChoice("keep")}
                disabled={copyPathSelected}
              />
              <span>Keep both scenarios active for negotiation</span>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="drop-choice"
                value="drop"
                checked={dropChoice === "drop"}
                onChange={() => setDropChoice("drop")}
                disabled={copyPathSelected || !currentActiveScenarioId}
              />
              <span>
                Drop the current scenario
                {currentActiveScenarioName ? (
                  <>
                    {" — "}
                    <q>{currentActiveScenarioName}</q> stays in record as &lsquo;dropped&rsquo;
                  </>
                ) : (
                  <>
                    {" "}
                    <em style={{ color: "var(--ink-4)" }}>
                      (no active scenario to drop)
                    </em>
                  </>
                )}
              </span>
            </label>
          </fieldset>

          {error ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                color: "var(--bad)",
                fontFamily: "var(--mono)",
                fontSize: 11,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <div className="a1v2-modal-foot">
          <button
            type="button"
            className="a1v2-btn ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="a1v2-btn primary"
            onClick={handleSubmit}
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
          >
            {pending ? "Creating…" : "Create scenario"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Radio + checkbox label style — vertical centering + clickable
// label area + sane spacing. Reused across the three radio groups
// in this modal.
const radioLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  cursor: "pointer",
  fontSize: 13,
  color: "var(--ink-2)",
  lineHeight: 1.5,
};
