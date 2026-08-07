/**
 * App shell — a persistent sidebar plus a routed main area. Data is loaded once
 * by ConversionProvider and shared with every page; the global date-range
 * selection lives in DateRangeProvider (inside it, so ranges anchor to the loaded
 * report). Loading / error / empty states are handled here, in one place, so
 * pages only render with real data. Routing is hash-based (useHashRoute) — no
 * dependency, deep-link-safe under the Photino host's file origin.
 */
import { DateRangeFilter } from './components/DateRangeFilter';
import { Sidebar } from './components/Sidebar';
import { ConversionProvider, useConversionData } from './context/conversionContext';
import { DateRangeProvider } from './context/dateRangeContext';
import { useFilteredData } from './hooks/useFilteredData';
import { useHashRoute } from './hooks/useHashRoute';
import { navItemFor } from './nav';
import { AfterHoursPage } from './pages/AfterHoursPage';
import { AllCallsPage } from './pages/AllCallsPage';
import { ClientsPage } from './pages/ClientsPage';
import { CostVolumePage } from './pages/CostVolumePage';
import { PRESET_LABELS, isUnbounded } from './lib/dateRange';
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

/** The header's "generated … · showing …" line, describing the active range. */
function HeaderMeta() {
  const { range } = useFilteredData();
  const { data } = useConversionData();
  if (!data) return null;

  const scope = isUnbounded(range)
    ? `all data since ${formatDateTime(data.window.since)}`
    : `${PRESET_LABELS[range.preset]}${
        range.from != null && range.to != null
          ? ` (${formatDateTime(new Date(range.from).toISOString())} – ${formatDateTime(
              new Date(range.to - 1).toISOString(),
            )})`
          : ''
      }`;

  return (
    <p className="meta">
      generated {formatDateTime(data.generated_at)} · showing {scope}
    </p>
  );
}

function MainArea() {
  const { data: raw, loading, error, reload } = useConversionData();
  const { data: filtered, isEmpty } = useFilteredData();
  const route = useHashRoute();
  const page = navItemFor(route);

  // Two distinct empties: the payload itself has no calls (a fresh run) vs. the
  // payload has calls but the chosen date range excludes them all.
  const payloadEmpty = !!raw && raw.kpis.total_calls === 0;
  const rangeEmpty = !!filtered && isEmpty && !payloadEmpty;

  return (
    <main className="main">
      <header className="app-header">
        <div>
          <h1>{page.title}</h1>
          <HeaderMeta />
        </div>
        <div className="header-actions">
          <DateRangeFilter />
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

      {!loading && !error && payloadEmpty && (
        <section className="card state">
          <p>No calls in this window. Once a run captures calls, the funnel and KPIs appear here.</p>
        </section>
      )}

      {!loading && !error && rangeEmpty && (
        <section className="card state">
          <p>
            No calls in this date range. Widen the range or pick “All time” to see the full window.
          </p>
        </section>
      )}

      {!loading && !error && filtered && !isEmpty && <RoutedPage path={route} />}
    </main>
  );
}

function App() {
  return (
    <ConversionProvider>
      <DateRangeProvider>
        <div className="layout">
          <Sidebar />
          <MainArea />
        </div>
      </DateRangeProvider>
    </ConversionProvider>
  );
}

export default App;
