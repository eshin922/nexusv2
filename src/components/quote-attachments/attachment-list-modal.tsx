"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QuoteAttachmentRow } from "@/lib/quote-attachments-loader";
import {
  addQuoteAttachment,
  removeQuoteAttachment,
  getQuoteAttachmentSignedUrl,
} from "@/app/actions/quote-attachments";

// canonical-scenario-create-flow Step 7 — attachment list modal.
// PM-internal surface (NOT in src/components/pdf/; Pattern 45
// boundary preserved).
//
// Renders the list of quote_attachments rows for a quote: filename,
// size, uploaded_by name, uploaded_at, notes, download link, remove
// button. Includes "Add attachment" affordance at the bottom for
// post-creation uploads.

const MAX_FILE_SIZE = 25 * 1024 * 1024;
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

export function AttachmentListModal({
  open,
  onClose,
  quoteId,
  attachments,
}: {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  attachments: QuoteAttachmentRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setRemovingId(null);
      setUploadFile(null);
      setUploadError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, pending, onClose]);

  function handleDownload(attachmentId: string) {
    const fd = new FormData();
    fd.set("attachmentId", attachmentId);
    startTransition(async () => {
      setError(null);
      const result = await getQuoteAttachmentSignedUrl(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // Open signed URL in a new tab; browser handles content-type
      // based download/preview.
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleRemove(attachmentId: string) {
    setRemovingId(attachmentId);
  }

  function confirmRemove() {
    if (!removingId) return;
    const fd = new FormData();
    fd.set("attachmentId", removingId);
    startTransition(async () => {
      setError(null);
      const result = await removeQuoteAttachment(fd);
      setRemovingId(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setUploadFile(null);
      setUploadError(null);
      return;
    }
    if (picked.size > MAX_FILE_SIZE) {
      setUploadError("File exceeds 25 MB limit.");
      setUploadFile(null);
      e.target.value = "";
      return;
    }
    if (!ALLOWED_MIME.has(picked.type)) {
      setUploadError(
        "Allowed: PDF, Word, Excel, images (PNG/JPG/WebP), plain text.",
      );
      setUploadFile(null);
      e.target.value = "";
      return;
    }
    setUploadFile(picked);
    setUploadError(null);
  }

  function handleAddAttachment() {
    if (!uploadFile) return;
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("file", uploadFile);
    startTransition(async () => {
      setError(null);
      const result = await addQuoteAttachment(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setUploadFile(null);
      router.refresh();
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
        aria-labelledby="attachment-list-title"
        style={{ maxWidth: 720 }}
      >
        <div className="a1v2-modal-head">
          <h2 id="attachment-list-title">
            Attachments
            <span
              style={{
                marginLeft: 10,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-4)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {attachments.length}
            </span>
          </h2>
        </div>

        <div className="a1v2-modal-body">
          {attachments.length === 0 ? (
            <p
              style={{
                color: "var(--ink-3)",
                fontStyle: "italic",
                fontSize: 13,
              }}
            >
              No attachments yet. Use &ldquo;Add attachment&rdquo; below to
              upload the customer&rsquo;s brief / RFQ / supporting docs.
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {attachments.map((a) => (
                <li
                  key={a.id}
                  style={{
                    padding: "10px 12px",
                    background: "var(--paper-2)",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--ink)" }}>
                      📎 {a.filename}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleDownload(a.id)}
                        disabled={pending}
                        className="a1v2-btn ghost sm"
                      >
                        Download
                      </button>
                      {removingId === a.id ? (
                        <button
                          type="button"
                          onClick={confirmRemove}
                          disabled={pending}
                          className="a1v2-btn sm"
                          style={{ color: "var(--bad)" }}
                        >
                          Confirm remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRemove(a.id)}
                          disabled={pending}
                          className="a1v2-btn ghost sm"
                          style={{ color: "var(--bad)" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-4)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {a.fileSizeBytes
                      ? `${Math.round(a.fileSizeBytes / 1024)} KB`
                      : "—"}
                    {" · "}
                    Uploaded by {a.uploadedByName ?? a.uploadedByEmail}
                    {" · "}
                    {new Date(a.uploadedAt).toLocaleString()}
                  </div>
                  {a.notes ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        fontStyle: "italic",
                      }}
                    >
                      {a.notes}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/* Add attachment affordance */}
          <div
            style={{
              marginTop: 16,
              padding: "10px 12px",
              background: "var(--paper)",
              border: "1px dashed var(--rule)",
              borderRadius: 6,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <label
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-3)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Add attachment
            </label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
              onChange={handleFileChange}
            />
            {uploadError ? (
              <span
                role="alert"
                style={{
                  color: "var(--bad)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                }}
              >
                {uploadError}
              </span>
            ) : null}
            {uploadFile ? (
              <button
                type="button"
                onClick={handleAddAttachment}
                disabled={pending}
                className="a1v2-btn primary sm"
                style={{ alignSelf: "flex-start" }}
              >
                {pending ? "Uploading…" : `Upload ${uploadFile.name}`}
              </button>
            ) : null}
          </div>

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
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
