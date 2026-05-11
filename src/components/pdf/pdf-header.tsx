import type {
  CustomerViewVendor,
  CustomerViewQuote,
  CustomerViewCustomer,
} from "@/types/customer-view";
import { QUOTE_STUBS } from "@/lib/customer-view-fixtures";

function isStub(v: string | null) {
  return (
    v === QUOTE_STUBS.quoteNumber ||
    v === QUOTE_STUBS.paymentTerms ||
    v === QUOTE_STUBS.leadTime ||
    v === QUOTE_STUBS.incoterms
  );
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

export function PdfHeader({
  vendor,
  quote,
  customer,
}: {
  vendor: CustomerViewVendor;
  quote: CustomerViewQuote;
  customer: CustomerViewCustomer;
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
            <strong>Quotation</strong> ·{" "}
            {isStub(quote.quoteNumber) ? (
              <span className="pdf-stub">{quote.quoteNumber}</span>
            ) : (
              quote.quoteNumber
            )}
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
          <div className="sub">
            <span className="pdf-stub">{QUOTE_STUBS.preparedBy}</span>
          </div>
          <div className="sub">{vendor.address}</div>
        </div>
      </div>
    </div>
  );
}
