// Preview-only marker between PDF pages. NOT rendered into PDF render path.

export function PageBreakMarker({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div className="page-break-marker">
      page break · {current} of {total}
    </div>
  );
}
