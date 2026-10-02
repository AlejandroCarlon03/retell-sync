/**
 * The reading behind a chart, as real text.
 *
 * The bench's own instruments — the dial gauge, the story-pole funnel, the
 * two-needle split — mark their graphic `aria-hidden` and carry every figure as
 * text, so the measurement survives without the drawing. The three Recharts
 * surfaces could not do that on their own: their data lives only in the SVG and
 * a pointer-only tooltip, which leaves it unreachable by keyboard or screen
 * reader. This renders the same series as a plain table, kept out of the visual
 * bench but present in the accessibility tree, so those charts read the same way
 * the hand-drawn instruments already do.
 */
export interface ChartDataColumn<T> {
  /** Column caption, as spoken. */
  header: string;
  /** The cell's text for one row — already formatted, exactly as the chart labels it. */
  cell: (row: T) => string;
}

export function ChartDataTable<T>({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: ChartDataColumn<T>[];
  rows: T[];
}) {
  if (rows.length === 0) return null;

  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.header} scope="col">
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((c, j) =>
              j === 0 ? (
                <th key={c.header} scope="row">
                  {c.cell(row)}
                </th>
              ) : (
                <td key={c.header}>{c.cell(row)}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
