/**
 * App shell — a persistent sidebar plus a routed main area. Data is loaded once
 * by ConversionProvider and shared with every page; the global date-range
 * selection lives in DateRangeProvider (inside it, so ranges anchor to the loaded
 * report). Loading / error / empty states are handled here, in one place, so
 * pages only render with real data. Routing is hash-based (useHashRoute) — no
 * dependency, deep-link-safe under the Photino host's file origin.
 *
 * The three chart surfaces (Cost & Volume, Heatmaps, Trends) are code-split:
 * Recharts and the heatmap grid are the heaviest thing the bundle carries, and
 * the home verdict — the one screen most sessions ever open — has no chart on
 * it. Splitting them keeps the first paint of the static IIS build lean; each
 * chunk is fetched from the same origin the moment its route is chosen.
 */
import { Suspense, lazy } from 'react';

import { DateRangeFilter } from './components/DateRangeFilter';
import { Sidebar } from './components/Sidebar';
import { ConversionProvider, useConversionData } from './context/conversionContext';
import { DateRangeProvider } from './context/dateRangeContext';
import { useFilteredData } from './hooks/useFilteredData';
import { useHashRoute } from './hooks/useHashRoute';
import { navItemFor } from './nav';
import { AfterHoursPage } from './pages/AfterHoursPage';
import { AllCallsPage } from './pages/AllCallsPage';
import { CallQualityPage } from './pages/CallQualityPage';
import { ClientsPage } from './pages/ClientsPage';
import { EmailLogPage } from './pages/EmailLogPage';
import { FollowUpGapsPage } from './pages/FollowUpGapsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PRESET_LABELS, isUnbounded } from './lib/dateRange';
import { formatDateTime } from './lib/format';

const CostVolumePage = lazy(() =>
  import('./pages/CostVolumePage').then((m) => ({ default: m.CostVolumePage })),
);
const HeatmapsPage = lazy(() =>
  import('./pages/HeatmapsPage').then((m) => ({ default: m.HeatmapsPage })),
);
const TrendsPage = lazy(() =>
  import('./pages/TrendsPage').then((m) => ({ default: m.TrendsPage })),
);

/** Calm graphite "calibrating" sweep — the bench taking a reading. It is
 *  deliberately not scribe-red: the active-nav witness tick keeps the screen's
 *  single red while data loads. Also stands in for a code-split chart route
 *  while its chunk arrives, with copy that says what is actually pending. */
function LoadingState({ message = 'Loading conversion data…' }: { message?: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <span className="cal-bar" aria-hidden>
        <span className="cal-bar-seg" />
      </span>
      <p className="state-msg">{message}</p>
    </div>
  );
}

/** Suspense fallback for the code-split chart routes. */
function ChartChunkState() {
  return <LoadingState message="Loading charts…" />;
}

/** A triangular alert — critical hue always travels with this icon and a word. */
function AlertGlyph() {
  return (
    <svg
      className="state-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4.2 21 19H3z" />
      <line x1="12" y1="10" x2="12" y2="14.2" />
      <line x1="12" y1="16.6" x2="12" y2="16.7" />
    </svg>
  );
}

/** A dial gauge with its needle at rest — "no reading yet" in the bench's grammar. */
function RestGaugeGlyph() {
  return (
    <svg
      className="state-icon state-icon-muted"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 16.5a8 8 0 0 1 16 0" />
      <line x1="4" y1="16.5" x2="20" y2="16.5" />
      <line x1="12" y1="16.5" x2="6.8" y2="15" />
      <circle cx="12" cy="16.5" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RoutedPage({ path }: { path: string }) {
  switch (path) {
    case '/all-calls':
      return <AllCallsPage />;
    case '/call-quality':
      return <CallQualityPage />;
    case '/follow-up':
      return <FollowUpGapsPage />;
    case '/cost-volume':
      return <CostVolumePage />;
    case '/heatmaps':
      return <HeatmapsPage />;
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
    ? data.window.since
      ? `all data since ${formatDateTime(data.window.since)}`
      : 'every call on record'
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

  // Settings and Email Log are host-only admin pages that don't consume the
  // conversion report, so they render independently of the loading / error /
  // empty gates below (and carry their own data fetch + states).
  // Trends reads the cross-run history (its own fetch), not the conversion report,
  // so like Settings/Email Log it renders outside the conversion loading/empty
  // gates — the history can exist even when the current window has no calls.
  const isSettings = route === '/settings';
  const isEmailLog = route === '/email-log';
  const isTrends = route === '/trends';
  const isStandalone = isSettings || isEmailLog || isTrends;

  return (
    <main className="main" id="main-content">
      <header className="app-header">
        <div>
          <h1>{page.title}</h1>
          {!isStandalone && <HeaderMeta />}
        </div>
        {!isStandalone && (
          <div className="header-actions">
            <DateRangeFilter />
            <button type="button" className="btn" onClick={reload} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        )}
      </header>

      {isSettings && <SettingsPage />}
      {isEmailLog && <EmailLogPage />}
      {isTrends && (
        <Suspense fallback={<ChartChunkState />}>
          <TrendsPage />
        </Suspense>
      )}

      {!isStandalone && loading && <LoadingState />}

      {!isStandalone && !loading && error && (
        <section className="card state-msg-card state-error" role="alert">
          <div className="state-head">
            <AlertGlyph />
            <strong>Couldn&apos;t load conversion data.</strong>
          </div>
          <p className="state-body">{error.message}</p>
          {error.status === 404 && error.resolvedPath && (
            <p className="state-body">
              No conversion.json at <code>{error.resolvedPath}</code>. Run{' '}
              <code>python -m retell_sync run</code> to generate it, or point the host at a file via{' '}
              <code>RETELL_SYNC_CONVERSION_JSON</code>.
            </p>
          )}
        </section>
      )}

      {!isStandalone && !loading && !error && payloadEmpty && (
        <section className="card state-msg-card">
          <div className="state-head">
            <RestGaugeGlyph />
            <strong>No calls in this window.</strong>
          </div>
          <p className="state-body">Once a run captures calls, the funnel and KPIs appear here.</p>
        </section>
      )}

      {!isStandalone && !loading && !error && rangeEmpty && (
        <section className="card state-msg-card">
          <div className="state-head">
            <RestGaugeGlyph />
            <strong>No calls in this date range.</strong>
          </div>
          <p className="state-body">Widen the range or pick “All time” to see the full window.</p>
        </section>
      )}

      {!isStandalone && !loading && !error && filtered && !isEmpty && (
        <Suspense fallback={<ChartChunkState />}>
          <RoutedPage path={route} />
        </Suspense>
      )}
    </main>
  );
}

function App() {
  return (
    <ConversionProvider>
      <DateRangeProvider>
        <div className="layout">
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <Sidebar />
          <MainArea />
        </div>
      </DateRangeProvider>
    </ConversionProvider>
  );
}

export default App;
