/**
 * PR 6 skeleton — proof that the pipe works end to end: Photino host → /api →
 * typed hook → render. Deliberately unstyled and chart-free; PR 7 turns this into
 * the real dashboard (KPI tiles, funnel, calls table).
 */
import { useConversion } from './hooks/useConversion';

/** Format an ISO-8601 string for display; fall back to the raw value. */
function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatUsd(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function App() {
  const { data, loading, error, reload } = useConversion();

  return (
    <main className="app">
      <header className="app-header">
        <h1>Retell → Conversion</h1>
        <button type="button" onClick={reload} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {loading && <p>Loading conversion data…</p>}

      {!loading && error && (
        <section className="state state-error">
          <p>
            <strong>Couldn&apos;t load conversion data.</strong> {error.message}
          </p>
          {error.status === 404 && error.resolvedPath && (
            <p>
              No conversion.json at <code>{error.resolvedPath}</code>. Run{' '}
              <code>python -m retell_sync run</code> to generate it, or point the
              host at a file via <code>RETELL_SYNC_CONVERSION_JSON</code>.
            </p>
          )}
        </section>
      )}

      {!loading && !error && data && (
        <>
          <p className="meta">
            generated {formatDateTime(data.generated_at)} · window since{' '}
            {formatDateTime(data.window.since)}
          </p>

          <ul className="stats">
            <li>
              total calls: <strong>{data.kpis.total_calls}</strong>
            </li>
            <li>
              after-hours calls: <strong>{data.kpis.after_hours_calls}</strong>
            </li>
            <li>
              $ / after-hours call:{' '}
              <strong>{formatUsd(data.kpis.dollars_per_after_hours_call)}</strong>
            </li>
          </ul>

          <p className="loaded">{data.by_call.length} calls loaded.</p>
        </>
      )}
    </main>
  );
}

export default App;
