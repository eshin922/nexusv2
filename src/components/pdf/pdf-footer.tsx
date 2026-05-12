import type {
  CustomerViewVendor,
  CustomerViewQuote,
} from "@/types/customer-view";
import { QUOTE_STUBS } from "@/lib/customer-view-fixtures";

export function PdfFooter({
  vendor,
  quote,
  page,
  pages,
}: {
  vendor: CustomerViewVendor;
  quote: CustomerViewQuote;
  page: number;
  pages: number;
}) {
  return (
    <div className="pdf-footer">
      <span>
        {vendor.name} ·{" "}
        {quote.quoteNumber ? (
          quote.quoteNumber
        ) : (
          <span className="pdf-stub">{QUOTE_STUBS.quoteNumber}</span>
        )}
      </span>
      <span>
        Page {page} of {pages}
      </span>
    </div>
  );
}
