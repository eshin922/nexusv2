import type { CustomerViewQuote } from "@/types/customer-view";
import { QUOTE_STUBS } from "@/lib/customer-view-fixtures";

function isStub(value: string) {
  return (
    value === QUOTE_STUBS.quoteNumber ||
    value === QUOTE_STUBS.paymentTerms ||
    value === QUOTE_STUBS.leadTime ||
    value === QUOTE_STUBS.incoterms
  );
}

function StubAware({ value }: { value: string }) {
  return isStub(value) ? <span className="pdf-stub">{value}</span> : <>{value}</>;
}

function formatLongDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PdfTerms({
  quote,
  includeIncoterms,
}: {
  quote: CustomerViewQuote;
  includeIncoterms: boolean;
}) {
  return (
    <div className="pdf-terms">
      <div className="row">
        <div className="label">Valid until</div>
        <div className="value mono">{formatLongDate(quote.validUntil)}</div>
      </div>
      <div className="row">
        <div className="label">Payment terms</div>
        <div className="value">
          <StubAware value={quote.paymentTerms} />
        </div>
      </div>
      <div className="row">
        <div className="label">Lead time</div>
        <div className="value">
          <StubAware value={quote.leadTime} />
        </div>
      </div>
      {includeIncoterms && (
        <div className="row">
          <div className="label">Incoterms</div>
          <div className="value">
            <StubAware value={quote.incoterms} />
          </div>
        </div>
      )}
    </div>
  );
}
