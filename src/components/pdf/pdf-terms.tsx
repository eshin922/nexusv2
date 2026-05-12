import type { CustomerViewQuote } from "@/types/customer-view";
import { QUOTE_STUBS } from "@/lib/customer-view-fixtures";

function formatLongDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function NullableValue({
  value,
  stub,
}: {
  value: string | null;
  stub: string;
}) {
  if (value === null || value === "") {
    return <span className="pdf-stub">{stub}</span>;
  }
  return <>{value}</>;
}

export function PdfTerms({
  quote,
  includeIncoterms,
}: {
  quote: CustomerViewQuote;
  includeIncoterms: boolean;
}) {
  return (
    <>
      <div className="pdf-terms">
        <div className="row">
          <div className="label">Valid until</div>
          <div className="value mono">{formatLongDate(quote.validUntil)}</div>
        </div>
        <div className="row">
          <div className="label">Payment terms</div>
          <div className="value">
            <NullableValue
              value={quote.paymentTerms}
              stub={QUOTE_STUBS.paymentTerms}
            />
          </div>
        </div>
        <div className="row">
          <div className="label">Lead time</div>
          <div className="value">
            <NullableValue value={quote.leadTime} stub={QUOTE_STUBS.leadTime} />
          </div>
        </div>
        {includeIncoterms && (
          <div className="row">
            <div className="label">Incoterms</div>
            <div className="value">
              <NullableValue
                value={quote.incoterms}
                stub={QUOTE_STUBS.incoterms}
              />
            </div>
          </div>
        )}
      </div>

      {/* T&Cs body — RI.7 brief amendment §3.10.c. Verbatim legal text;
          drafts read firm_settings.tcs_default, sent quotes read the
          per-quote snapshot. Multi-paragraph supported (split on
          blank-line separators). */}
      <div className="pdf-tcs">
        <div className="label">Terms &amp; conditions</div>
        <div className="tcs-body">
          {quote.tcs !== null && quote.tcs !== "" ? (
            quote.tcs.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)
          ) : (
            <p>
              <span className="pdf-stub">{QUOTE_STUBS.tcs}</span>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
