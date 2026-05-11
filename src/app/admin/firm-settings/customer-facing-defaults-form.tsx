"use client";

import { useState, useTransition } from "react";
import { updateFirmSettingsCustomerFacingDefaults } from "@/app/actions/firm-settings";

// Slice RI.7 — second card on /admin/firm-settings. Vendor identity
// (firm name / tagline / address — rendered live on every customer
// view PdfHeader) + customer-facing commercial defaults (T&Cs,
// payment terms, lead time, incoterms, days_valid — snapshotted at
// sendQuote per CR-SM DEC-7) + quote_number_prefix (consumed by
// sendQuote when assigning customer-facing identifiers per DEC-4).
//
// Same versioning pattern as the margin policy form above. Save
// commits a new firm_settings row (carry-forward all unchanged
// columns); audit-logged via firm_settings_updated.

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CustomerFacingDefaults = {
  vendorName: string | null;
  vendorTagline: string | null;
  vendorAddress: string | null;
  quoteNumberPrefix: string | null;
  tcsDefault: string | null;
  paymentTermsDefault: string | null;
  leadTimeDefault: string | null;
  incotermsDefault: string | null;
  daysValidDefault: number | null;
};

export function CustomerFacingDefaultsForm({
  current,
}: {
  current: CustomerFacingDefaults | null;
}) {
  const [vendorName, setVendorName] = useState(current?.vendorName ?? "");
  const [vendorTagline, setVendorTagline] = useState(current?.vendorTagline ?? "");
  const [vendorAddress, setVendorAddress] = useState(current?.vendorAddress ?? "");
  const [quoteNumberPrefix, setQuoteNumberPrefix] = useState(
    current?.quoteNumberPrefix ?? "",
  );
  const [tcsDefault, setTcsDefault] = useState(current?.tcsDefault ?? "");
  const [paymentTermsDefault, setPaymentTermsDefault] = useState(
    current?.paymentTermsDefault ?? "",
  );
  const [leadTimeDefault, setLeadTimeDefault] = useState(
    current?.leadTimeDefault ?? "",
  );
  const [incotermsDefault, setIncotermsDefault] = useState(
    current?.incotermsDefault ?? "",
  );
  const [daysValidDefault, setDaysValidDefault] = useState(
    current?.daysValidDefault?.toString() ?? "",
  );
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (daysValidDefault.trim() !== "") {
      const n = Number(daysValidDefault);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        setError("Days valid must be a positive integer.");
        return;
      }
    }

    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateFirmSettingsCustomerFacingDefaults(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        setSuccess(
          `Saved. New current row effective from ${r.data.effectiveFrom}.`,
        );
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Vendor identity (firm-level, renders live on customer views) */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-700">
          Vendor identity — live across all customer views
        </legend>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Firm name</span>
          <input
            type="text"
            name="vendorName"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="The DPS"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Tagline</span>
          <input
            type="text"
            name="vendorTagline"
            value={vendorTagline}
            onChange={(e) => setVendorTagline(e.target.value)}
            placeholder="Turnkey product development & manufacturing for beauty, health & wellness brands"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Address</span>
          <input
            type="text"
            name="vendorAddress"
            value={vendorAddress}
            onChange={(e) => setVendorAddress(e.target.value)}
            placeholder="3943 Irvine Blvd, #1129 Irvine, CA 92602"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>
      </fieldset>

      {/* Quote-number prefix */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-700">
          Quote-number prefix — consumed at send time
        </legend>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Prefix</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              name="quoteNumberPrefix"
              value={quoteNumberPrefix}
              onChange={(e) => setQuoteNumberPrefix(e.target.value)}
              placeholder="DPS"
              className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">
              Format: <code className="rounded bg-slate-100 px-1">{quoteNumberPrefix || "DPS"}-1042</code>.
              Counter increments globally across all firms (single-tenant v1).
            </span>
          </div>
        </label>
      </fieldset>

      {/* Customer-facing commercial defaults */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-700">
          Customer-facing commercial defaults — snapshotted onto each quote at send
        </legend>
        <p className="text-xs text-slate-500">
          These values appear on the customer-facing PDF. Past sent
          quotes keep their snapshot — changes here only affect drafts
          and future sends.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Payment terms</span>
          <input
            type="text"
            name="paymentTermsDefault"
            value={paymentTermsDefault}
            onChange={(e) => setPaymentTermsDefault(e.target.value)}
            placeholder="50% deposit, 50% on shipment"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Lead time</span>
          <input
            type="text"
            name="leadTimeDefault"
            value={leadTimeDefault}
            onChange={(e) => setLeadTimeDefault(e.target.value)}
            placeholder="8–12 weeks from confirmed PO"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Incoterms</span>
            <input
              type="text"
              name="incotermsDefault"
              value={incotermsDefault}
              onChange={(e) => setIncotermsDefault(e.target.value)}
              placeholder="FOB Long Beach"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">
              Renders on customer view only when freight_treatment = pass_through.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Days valid</span>
            <input
              type="number"
              name="daysValidDefault"
              inputMode="numeric"
              min={1}
              step={1}
              value={daysValidDefault}
              onChange={(e) => setDaysValidDefault(e.target.value)}
              placeholder="30"
              className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm focus:border-slate-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">
              valid_until = sent_at + this many days.
            </span>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            Terms &amp; conditions (T&amp;Cs)
          </span>
          <textarea
            name="tcsDefault"
            value={tcsDefault}
            onChange={(e) => setTcsDefault(e.target.value)}
            rows={6}
            placeholder="Multi-paragraph legal block; renders verbatim on customer view PdfTerms section."
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">
            Until canonical text is provided, customer views render
            <code className="mx-1 rounded bg-slate-100 px-1">{"{tcs-pending}"}</code>
            stub for sent quotes (hold gate before RI.7 PR-to-main).
          </span>
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Effective from</span>
        <input
          type="date"
          name="effectiveFrom"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          required
          className="w-44 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </label>

      {error && (
        <p
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="r2-btn primary"
          style={{ opacity: pending ? 0.5 : 1 }}
        >
          {pending ? "Saving…" : "Save new version"}
        </button>
        <span className="text-xs text-slate-500">
          Versioned save. Sent quotes&rsquo; snapshots are unaffected.
        </span>
      </div>
    </form>
  );
}
