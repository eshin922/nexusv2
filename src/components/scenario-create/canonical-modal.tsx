"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  copyQuoteFromProject,
  copyScenarioWithinProject,
  createScenario,
  fetchCopySourceProjects,
  fetchScenarioCopyPicker,
} from "@/app/actions/quotes";
import type {
  CopySourceProject,
  ScenarioCopyPickerRow,
} from "@/lib/scenario-copy-loader";
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
  // slice-fr12-copy-operations Step 6 — within-project copy picker
  // state. Loaded on first selection of the copy_scenario radio;
  // re-used across re-selects within the same modal session.
  const [copyScenarios, setCopyScenarios] = useState<
    ScenarioCopyPickerRow[] | null
  >(null);
  const [copyScenariosLoading, setCopyScenariosLoading] = useState(false);
  const [copyScenariosError, setCopyScenariosError] = useState<string | null>(
    null,
  );
  const [selectedCopySourceQuoteId, setSelectedCopySourceQuoteId] =
    useState<string>("");
  // slice-fr12-copy-operations Step 7 — cross-project picker
  // state. Project list loaded on first selection of the
  // copy_quote radio + on every search-term debounce. Selected
  // project + selected scenario tracked separately so PMs see
  // search-→-project-→-scenario as three concrete steps.
  const [crossProjects, setCrossProjects] = useState<CopySourceProject[] | null>(
    null,
  );
  const [crossProjectsLoading, setCrossProjectsLoading] = useState(false);
  const [crossProjectsError, setCrossProjectsError] = useState<string | null>(
    null,
  );
  const [crossSearchTerm, setCrossSearchTerm] = useState<string>("");
  const [selectedCrossProjectId, setSelectedCrossProjectId] =
    useState<string>("");
  const [selectedCrossSourceQuoteId, setSelectedCrossSourceQuoteId] =
    useState<string>("");
  const crossSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    setCopyScenarios(null);
    setCopyScenariosError(null);
    setSelectedCopySourceQuoteId("");
    setCrossProjects(null);
    setCrossProjectsError(null);
    setCrossSearchTerm("");
    setSelectedCrossProjectId("");
    setSelectedCrossSourceQuoteId("");
    if (crossSearchDebounceRef.current) {
      clearTimeout(crossSearchDebounceRef.current);
      crossSearchDebounceRef.current = null;
    }
  }, [open]);

  // slice-fr12-copy-operations Step 6 — lazy-load the within-
  // project picker the first time PM selects the copy_scenario
  // radio. Re-fetches on every modal-open per session so newly-
  // created scenarios surface immediately (no stale-cache risk).
  useEffect(() => {
    if (!open) return;
    if (startPath !== "copy_scenario") return;
    if (copyScenarios !== null) return; // already loaded this session
    if (copyScenariosLoading) return;
    setCopyScenariosLoading(true);
    setCopyScenariosError(null);
    (async () => {
      const result = await fetchScenarioCopyPicker({
        projectId,
        excludeQuoteId: currentActiveScenarioId ?? undefined,
      });
      setCopyScenariosLoading(false);
      if (!result.ok) {
        setCopyScenariosError(result.error.message);
        return;
      }
      setCopyScenarios(result.data.scenarios);
    })();
  }, [
    open,
    startPath,
    copyScenarios,
    copyScenariosLoading,
    projectId,
    currentActiveScenarioId,
  ]);

  // slice-fr12-copy-operations Step 7 — debounced cross-project
  // fetch. Fires on first copy_quote selection (search term
  // empty) and re-fires on every search-term change after 300ms
  // of quiet. Same debounce pattern as the library browse
  // modal's search input (PR #51).
  useEffect(() => {
    if (!open) return;
    if (startPath !== "copy_quote") return;
    if (crossSearchDebounceRef.current) {
      clearTimeout(crossSearchDebounceRef.current);
    }
    crossSearchDebounceRef.current = setTimeout(() => {
      setCrossProjectsLoading(true);
      setCrossProjectsError(null);
      (async () => {
        const result = await fetchCopySourceProjects({
          search: crossSearchTerm.trim() || undefined,
          excludeProjectId: projectId,
        });
        setCrossProjectsLoading(false);
        if (!result.ok) {
          setCrossProjectsError(result.error.message);
          return;
        }
        setCrossProjects(result.data.projects);
        // Clear selection if the prior pick no longer surfaces in
        // the search results (rare; defensive).
        if (
          selectedCrossProjectId &&
          !result.data.projects.find(
            (p) => p.projectId === selectedCrossProjectId,
          )
        ) {
          setSelectedCrossProjectId("");
          setSelectedCrossSourceQuoteId("");
        }
      })();
    }, 300);
    return () => {
      if (crossSearchDebounceRef.current) {
        clearTimeout(crossSearchDebounceRef.current);
      }
    };
  }, [
    open,
    startPath,
    crossSearchTerm,
    projectId,
    selectedCrossProjectId,
  ]);

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

  // slice-fr12-copy-operations Step 7 — both copy paths active.
  // crossProjectPath flips on for copy_quote; the previous
  // "crossProjectPending" gate retires.
  const copyScenarioPath = startPath === "copy_scenario";
  const crossProjectPath = startPath === "copy_quote";
  const anyCopyPath = copyScenarioPath || crossProjectPath;
  // Recommended-checkbox stays disabled on copy paths (the copy
  // actions don't carry scenarioRecommended; PMs set the ★ pin
  // via post-creation affordance per Slice RI.1 precedent).
  const advancedFieldsDisabled = anyCopyPath;
  // Drop-current radio is meaningful on within-project copy (same
  // anchor scenario as scratch). Cross-project copy doesn't drop
  // anything (target may be a fresh project; no scenario to drop).
  const dropChoiceDisabled = crossProjectPath;
  const copyMissingSource = copyScenarioPath && !selectedCopySourceQuoteId;
  const crossMissingSource =
    crossProjectPath && !selectedCrossSourceQuoteId;
  const submitDisabled =
    pending || copyMissingSource || crossMissingSource;

  function handleSubmit() {
    if (crossProjectPath) {
      handleCopyQuoteSubmit();
      return;
    }
    if (copyScenarioPath) {
      handleCopyScenarioSubmit();
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

  // slice-fr12-copy-operations Step 6 — within-project copy submit.
  // Dispatches copyScenarioWithinProject; the dropChoice radio
  // governs the optional dropCurrentScenarioId arg (same UX as
  // scratch — PM picks "Drop the current scenario" → flips the
  // anchor scenario's family to dropped per CSF Bug CSF-3-A
  // family-level pattern with audit_source='fr12_copy_supersede'
  // per Step 2 contract).
  function handleCopyScenarioSubmit() {
    if (!selectedCopySourceQuoteId) {
      setError("Pick a source scenario from the dropdown above.");
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

      const result = await copyScenarioWithinProject({
        sourceQuoteId: selectedCopySourceQuoteId,
        projectId,
        newScenarioLabel: scenarioLabel.trim() || undefined,
        intentNote: intentNote.trim() || undefined,
        customerTargetTierLabel: targetTierLabel.trim() || undefined,
        dropCurrentScenarioId:
          dropChoice === "drop" && currentActiveScenarioId
            ? currentActiveScenarioId
            : undefined,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      const newQuoteId = result.data.newQuoteId;

      if (file) {
        const fd = new FormData();
        fd.set("quoteId", newQuoteId);
        fd.set("file", file);
        const upload = await addQuoteAttachment(fd);
        if (!upload.ok) {
          console.warn(
            `[canonical-modal] attachment upload failed: ${upload.error.message}; scenario created without attachment.`,
          );
        }
      }

      onClose();
      router.push(`/projects/${projectId}/quotes/${newQuoteId}/setup`);
    });
  }

  // slice-fr12-copy-operations Step 7 — cross-project copy submit.
  // Dispatches copyQuoteFromProject. No dropCurrentScenarioId
  // option (cross-project copies don't auto-drop source scenarios
  // per the Step 4 action shape — the target may be a fresh
  // project with no scenarios to drop).
  function handleCopyQuoteSubmit() {
    if (!selectedCrossSourceQuoteId) {
      setError("Pick a source scenario from another project.");
      return;
    }

    startTransition(async () => {
      setError(null);

      const result = await copyQuoteFromProject({
        sourceQuoteId: selectedCrossSourceQuoteId,
        targetProjectId: projectId,
        newScenarioLabel: scenarioLabel.trim() || undefined,
        intentNote: intentNote.trim() || undefined,
        customerTargetTierLabel: targetTierLabel.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      const newQuoteId = result.data.newQuoteId;

      if (file) {
        const fd = new FormData();
        fd.set("quoteId", newQuoteId);
        fd.set("file", file);
        const upload = await addQuoteAttachment(fd);
        if (!upload.ok) {
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

            {/* slice-fr12-copy-operations Step 6 — within-project
                picker UI replaces the prior warning banner for the
                copy_scenario radio. Cross-project (copy_quote) keeps
                a slimmer pending banner until Step 7 wires it. */}
            {copyScenarioPath ? (
              <div
                style={{
                  marginTop: 6,
                  padding: "10px 12px",
                  background: "var(--paper-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                  }}
                >
                  Source scenario
                </span>
                {copyScenariosLoading ? (
                  <span
                    style={{ fontSize: 12, color: "var(--ink-3)" }}
                  >
                    Loading scenarios…
                  </span>
                ) : copyScenariosError ? (
                  <span
                    role="alert"
                    style={{
                      fontSize: 11.5,
                      color: "var(--bad)",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {copyScenariosError}
                  </span>
                ) : copyScenarios && copyScenarios.length === 0 ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-3)",
                      fontStyle: "italic",
                    }}
                  >
                    No other scenarios in this project have a setup
                    tree to copy from. Use Scratch instead.
                  </span>
                ) : (
                  <select
                    value={selectedCopySourceQuoteId}
                    onChange={(e) =>
                      setSelectedCopySourceQuoteId(e.target.value)
                    }
                    style={{ fontSize: 13 }}
                  >
                    <option value="">— Pick a source scenario —</option>
                    {(copyScenarios ?? []).map((s) => {
                      const star = s.isRecommended ? "★ " : "";
                      const statusLabel =
                        s.scenarioStatus === "active"
                          ? ""
                          : ` · ${s.scenarioStatus}`;
                      return (
                        <option key={s.quoteId} value={s.quoteId}>
                          {star}
                          {s.scenarioLabel} · v{s.versionNumber}
                          {statusLabel} · {s.asyCount} ASY
                          {s.asyCount === 1 ? "" : "s"} · {s.leafCount}{" "}
                          leaf{s.leafCount === 1 ? "" : "s"}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            ) : null}
            {/* slice-fr12-copy-operations Step 7 — cross-project
                picker. Search + project dropdown + scenario
                dropdown (three concrete steps; per Q1/Q8
                simpler-search disposition). Project list filters
                to ASY/LEAF-tree-having quotes only (Pattern 32 per
                Q7); scenarios within a project share the same
                filter. */}
            {crossProjectPath ? (
              <div
                style={{
                  marginTop: 6,
                  padding: "10px 12px",
                  background: "var(--paper-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                  }}
                >
                  Source project + scenario
                </span>
                <input
                  type="text"
                  value={crossSearchTerm}
                  onChange={(e) => {
                    setCrossSearchTerm(e.target.value);
                    // Clear selection on new search; reloads on
                    // debounced fetch.
                    setSelectedCrossProjectId("");
                    setSelectedCrossSourceQuoteId("");
                  }}
                  placeholder="Search by client name or deal name"
                  style={{ fontSize: 13 }}
                  aria-label="Search projects"
                />
                {crossProjectsLoading ? (
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    Searching projects…
                  </span>
                ) : crossProjectsError ? (
                  <span
                    role="alert"
                    style={{
                      fontSize: 11.5,
                      color: "var(--bad)",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {crossProjectsError}
                  </span>
                ) : crossProjects && crossProjects.length === 0 ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-3)",
                      fontStyle: "italic",
                    }}
                  >
                    {crossSearchTerm.trim()
                      ? `No projects match "${crossSearchTerm.trim()}." Try a different search.`
                      : "No projects with setup-tree scenarios available."}
                  </span>
                ) : (
                  <>
                    <select
                      value={selectedCrossProjectId}
                      onChange={(e) => {
                        setSelectedCrossProjectId(e.target.value);
                        setSelectedCrossSourceQuoteId("");
                      }}
                      style={{ fontSize: 13 }}
                      aria-label="Source project"
                    >
                      <option value="">— Pick a source project —</option>
                      {(crossProjects ?? []).map((p) => (
                        <option key={p.projectId} value={p.projectId}>
                          {p.clientName ?? "(no client name)"} ·{" "}
                          {p.dealName}
                        </option>
                      ))}
                    </select>
                    {selectedCrossProjectId ? (
                      <select
                        value={selectedCrossSourceQuoteId}
                        onChange={(e) =>
                          setSelectedCrossSourceQuoteId(e.target.value)
                        }
                        style={{ fontSize: 13 }}
                        aria-label="Source scenario"
                      >
                        <option value="">— Pick a source scenario —</option>
                        {((crossProjects ?? []).find(
                          (p) => p.projectId === selectedCrossProjectId,
                        )?.quotes ?? []).map((s) => {
                          const star = s.isRecommended ? "★ " : "";
                          const statusLabel =
                            s.scenarioStatus === "active"
                              ? ""
                              : ` · ${s.scenarioStatus}`;
                          return (
                            <option key={s.quoteId} value={s.quoteId}>
                              {star}
                              {s.scenarioLabel} · v{s.versionNumber}
                              {statusLabel} · {s.asyCount} ASY
                              {s.asyCount === 1 ? "" : "s"} ·{" "}
                              {s.leafCount} leaf
                              {s.leafCount === 1 ? "" : "s"}
                            </option>
                          );
                        })}
                      </select>
                    ) : null}
                  </>
                )}
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
            />
          </div>

          {/* Intent note */}
          <div className="field">
            <span className="lbl">Why this scenario? (optional)</span>
            <textarea
              value={intentNote}
              onChange={(e) => setIntentNote(e.target.value)}
              placeholder="Why does this scenario exist?"
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

          {/* Recommended checkbox — disabled on copy paths since
              the copy actions don't carry scenarioRecommended; PMs
              set the ★ pin via post-creation affordance per Slice
              RI.1 precedent. */}
          <label style={{ ...radioLabelStyle, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={recommended}
              onChange={(e) => setRecommended(e.target.checked)}
              disabled={advancedFieldsDisabled}
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
                disabled={dropChoiceDisabled}
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
                disabled={dropChoiceDisabled || !currentActiveScenarioId}
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
            {pending
              ? anyCopyPath
                ? "Copying…"
                : "Creating…"
              : copyScenarioPath
                ? "Copy scenario"
                : crossProjectPath
                  ? "Copy quote"
                  : "Create scenario"}
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
