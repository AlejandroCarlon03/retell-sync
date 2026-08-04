/**
 * Dashboard shell — assembles the header, KPI tiles, funnel, after-hours split,
 * and calls table over the conversion payload. All data flows from a single
 * `useConversion()` hook, so loading / error / empty live in one place.
 */
import { CallsTable } from './components/CallsTable';
import { ClientMatch } from './components/ClientMatch';
import { FunnelChart } from './components/FunnelChart';
import { KpiTiles } from './components/KpiTiles';
import { useConversion } from './hooks/useConversion';
import { useTheme, type ThemeChoice } from './hooks/useTheme';
import { formatDateTime } from './lib/format';

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
};

function App() {
  const { data, loading, error, reload } = useConversion();
  const { choice, cycle } = useTheme();

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Retell → After-Hours Conversion</h1>
          {data && (
            <p className="meta">
              generated {formatDateTime(data.generated_at)} · window since{' '}
              {formatDateTime(data.window.since)}
            </p>
          )}
        </div>
        <div className="header-actions">
          <button type="button" className="btn" onClick={cycle}>
            {THEME_LABEL[choice]}
          </button>
          <button type="button" className="btn" onClick={reload} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {loading && <p className="state">Loading conversion data…</p>}

      {!loading && error && (
        <section className="card state-error">
          <p>
            <strong>Couldn&apos;t load conversion data.</strong> {error.message}
          </p>
          {error.status === 404 && error.resolvedPath && (
            <p>
              No conversion.json at <code>{error.resolvedPath}</code>. Run{' '}
              <code>python -m retell_sync run</code> to generate it, or point the host at a
              file via <code>RETELL_SYNC_CONVERSION_JSON</code>.
            </p>
          )}
        </section>
      )}

      {!loading && !error && data && data.kpis.total_calls === 0 && (
        <section className="card state">
          <p>No calls in this window. Once a run captures calls, the funnel and KPIs appear here.</p>
        </section>
      )}

      {!loading && !error && data && data.kpis.total_calls > 0 && (
        <>
          <KpiTiles kpis={data.kpis} />
          <div className="grid-2">
            <FunnelChart funnel={data.funnel} />
            <ClientMatch kpis={data.kpis} />
          </div>
          <CallsTable calls={data.by_call} links={data.links} />
        </>
      )}
    </div>
  );
}

export default App;
