/**
 * App shell — a persistent sidebar plus a routed main area. Data is loaded once
 * by ConversionProvider and shared with every page; loading / error / empty
 * states are handled here, in one place, so pages only render with real data.
 * Routing is hash-based (useHashRoute) — no dependency, deep-link-safe under the
 * Photino host's file origin.
 */
import { Sidebar } from './components/Sidebar';
import { ConversionProvider, useConversionData } from './context/conversionContext';
import { useHashRoute } from './hooks/useHashRoute';
import { navItemFor } from './nav';
import { AfterHoursPage } from './pages/AfterHoursPage';
import { AllCallsPage } from './pages/AllCallsPage';
import { ClientsPage } from './pages/ClientsPage';
import { CostVolumePage } from './pages/CostVolumePage';
import { formatDateTime } from './lib/format';

function RoutedPage({ path }: { path: string }) {
  switch (path) {
    case '/all-calls':
      return <AllCallsPage />;
    case '/cost-volume':
      return <CostVolumePage />;
    case '/clients':
      return <ClientsPage />;
    case '/':
    default:
      return <AfterHoursPage />;
  }
}

function MainArea() {
  const { data, loading, error, reload } = useConversionData();
  const route = useHashRoute();
  const page = navItemFor(route);

  return (
    <main className="main">
      <header className="app-header">
        <div>
          <h1>{page.title}</h1>
          {data && (
            <p className="meta">
              generated {formatDateTime(data.generated_at)} · window since{' '}
              {formatDateTime(data.window.since)}
            </p>
          )}
        </div>
        <div className="header-actions">
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
              <code>python -m retell_sync run</code> to generate it, or point the host at a file via{' '}
              <code>RETELL_SYNC_CONVERSION_JSON</code>.
            </p>
          )}
        </section>
      )}

      {!loading && !error && data && data.kpis.total_calls === 0 && (
        <section className="card state">
          <p>No calls in this window. Once a run captures calls, the funnel and KPIs appear here.</p>
        </section>
      )}

      {!loading && !error && data && data.kpis.total_calls > 0 && <RoutedPage path={route} />}
    </main>
  );
}

function App() {
  return (
    <ConversionProvider>
      <div className="layout">
        <Sidebar />
        <MainArea />
      </div>
    </ConversionProvider>
  );
}

export default App;
