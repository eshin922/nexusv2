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
  const numberLabel =
    quote.quoteNumber === QUOTE_STUBS.quoteNumber
      ? `${vendor.name} · ${quote.quoteNumber}`
      : `${vendor.name} · ${quote.quoteNumber}`;
  return (
    <div className="pdf-footer">
      <span>{numberLabel}</span>
      <span>
        Page {page} of {pages}
      </span>
    </div>
  );
}
