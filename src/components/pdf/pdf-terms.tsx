import type { CustomerViewQuote } from "@/types/quote";
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

// Slice RI.8 step 6 — T&Cs bullet rendering. Edward's first canonical
// T&Cs paste hit the prose-only limitation on the logistics-rates
// section (three bullets reformatted as semicolon-joined prose as a
// workaround). Per brief amendment §3: markers-only path for v1.
//
// Rules:
// - Paragraph = block separated by 2+ newlines (existing).
// - Within a paragraph, consecutive lines starting with a bullet
//   marker (`-`, `*`, `•`, with optional leading whitespace) group
//   into a `<ul>`.
// - Lines without a bullet marker render as a `<p>` (lines joined by
//   spaces — line breaks inside a paragraph are typographic
//   continuation, not separation).
// - Empty paragraphs skipped.
//
// Not supported in v1 (intentionally narrow scope per brief):
// - Bold / italic / links / headings (full Markdown). Add if a
//   second use case lands; until then prose-with-bullets covers
//   Edward's actual case without parser dependency.
// - Nested bullets. Indented bullet lines become a separate top-level
//   `<ul>` if they happen to land — readers will adapt.

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;

type Block = { type: "p" | "ul"; items: string[] };

function parseParagraph(paragraph: string): Block[] {
  const lines = paragraph.split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const m = BULLET_RE.exec(line);
    if (m) {
      const item = m[1].trim();
      if (current && current.type === "ul") {
        current.items.push(item);
      } else {
        current = { type: "ul", items: [item] };
        blocks.push(current);
      }
    } else {
      const trimmed = line.trim();
      if (current && current.type === "p") {
        // Join wrapped lines inside a single paragraph with a space
        current.items[0] = `${current.items[0]} ${trimmed}`;
      } else {
        current = { type: "p", items: [trimmed] };
        blocks.push(current);
      }
    }
  }
  return blocks;
}

function renderTcsBody(tcs: string): React.ReactNode {
  const paragraphs = tcs.split(/\n\n+/);
  const out: React.ReactNode[] = [];
  let blockIdx = 0;
  for (const para of paragraphs) {
    if (para.trim() === "") continue;
    for (const block of parseParagraph(para)) {
      if (block.type === "p") {
        out.push(<p key={blockIdx++}>{block.items[0]}</p>);
      } else {
        out.push(
          <ul key={blockIdx++}>
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>,
        );
      }
    }
  }
  return out;
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
          blank-line separators). Bullet markers (`-`, `*`, `•`) at
          line start render as <ul> per RI.8 §3 brief amendment. */}
      <div className="pdf-tcs">
        <div className="label">Terms &amp; conditions</div>
        <div className="tcs-body">
          {quote.tcs !== null && quote.tcs !== "" ? (
            renderTcsBody(quote.tcs)
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
