import type {
  CustomerViewVendor,
  CustomerViewQuote,
  CustomerViewCustomer,
  CustomerViewPreparedBy,
} from "@/types/quote";
import { QUOTE_STUBS } from "@/lib/quote-fixtures";

function formatLongDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Stub({ text }: { text: string }) {
  return <span className="pdf-stub">{text}</span>;
}

export function PdfHeader({
  vendor,
  quote,
  customer,
  preparedBy,
}: {
  vendor: CustomerViewVendor;
  quote: CustomerViewQuote;
  customer: CustomerViewCustomer;
  preparedBy: CustomerViewPreparedBy | null;
}) {
  return (
    <div>
      <div className="pdf-header">
        <div>
          <div className="vendor">{vendor.name}</div>
          <div className="vendor-sub">{vendor.sub}</div>
        </div>
        <div className="doc-meta">
          <div>
            <strong>Quotation</strong>
            {/* impl-6 patch round (Bug #Q) — conditional render of
                the quote number. Pre-fix shipped <Stub text="
                {quote-number-pending}"> as a visible placeholder on
                drafts; CA lean (b) disposition: suppress entirely
                when quoteNumber is null. The PM context (draft
                surface chrome + status indicators elsewhere) already
                signals draft state; client-shared screenshots no
                longer carry a placeholder-token visual leak. */}
            {quote.quoteNumber ? <> · {quote.quoteNumber}</> : null}
          </div>
          <div>Issued · {formatLongDate(quote.sentDate)}</div>
          <div>Valid until · {formatLongDate(quote.validUntil)}</div>
        </div>
      </div>
      <div className="pdf-customer">
        <div>
          <div className="label">Prepared for</div>
          <div className="name">{customer.name}</div>
          {customer.contact && (
            <div className="sub">
              {customer.contact}
              {customer.role ? ` · ${customer.role}` : ""}
            </div>
          )}
          {customer.address && <div className="sub">{customer.address}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="label">Prepared by</div>
          <div className="name">{vendor.name}</div>
          {preparedBy ? (
            <>
              <div className="sub">{preparedBy.name}</div>
              <div className="sub">{preparedBy.email}</div>
              {/* Phone line OMITTED entirely when null/empty — graceful
                  degradation per Edward review of RI.7 (HubSpot Owners
                  API has no phone; manual users.phone is the sole
                  source). Email is the canonical CDM contact. */}
              {preparedBy.phone && <div className="sub">{preparedBy.phone}</div>}
            </>
          ) : (
            <div className="sub">
              <Stub text={QUOTE_STUBS.preparedBy} />
            </div>
          )}
          <div className="sub">{vendor.address}</div>
        </div>
      </div>
    </div>
  );
}
