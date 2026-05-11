export function PdfNotes({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <div className="pdf-notes">
      <div className="label">Notes</div>
      <p>{notes}</p>
    </div>
  );
}
