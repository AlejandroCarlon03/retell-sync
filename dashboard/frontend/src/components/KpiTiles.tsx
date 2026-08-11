/**
 * The headline KPI row — stat tiles, not a chart (per the data-viz form
 * heuristic: a single number's job is the number). The after-hours story leads.
 * The volume tile carries a sparkline + a "last 7d vs prior 7d" delta, computed
 * client-side from the by_call rows.
 */
import type { CallRow, ConversionKpis } from '../types/conversion';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { buildDailySeries, periodDelta, type PeriodDelta } from '../lib/series';
import {
  evaluateStatus,
  statusLabel,
  type KpiMetricKey,
  type ThresholdConfig,
} from '../lib/thresholds';
import { useThresholds } from '../hooks/useThresholds';
import { DeltaChip } from './DeltaChip';
import { DialGauge } from './DialGauge';
import { InfoTip } from './InfoTip';
import { Sparkline } from './Sparkline';
import { StatusBadge } from './StatusBadge';

interface Tile {
  label: string;
  value: string;
  sub?: string;
  info: string;
  trend?: number[];
  delta?: PeriodDelta;
  /** The lead metric — rendered larger, with an accent rule, to anchor the row. */
  hero?: boolean;
  /** When set, the tile carries a health badge driven by this metric's rule. */
  metric?: KpiMetricKey;
  /** The raw numeric value the metric's threshold rule is evaluated against. */
  rawValue?: number;
}

function tilesFor(kpis: ConversionKpis, calls: CallRow[]): Tile[] {
  const series = buildDailySeries(calls);
  const callTrend = series.map((p) => p.calls);
  const callDelta = periodDelta(series, (p) => p.calls, 7);
  return [
    {
      label: '$ / after-hours call',
      value: formatCurrency(kpis.dollars_per_after_hours_call),
      sub: `${formatCurrency(kpis.after_hours_won_revenue)} won ÷ ${formatCount(
        kpis.after_hours_calls,
      )} calls`,
      info: 'What an after-hours call is worth on average: the revenue we won from after-hours callers, spread across every after-hours call we took.',
      hero: true,
      metric: 'dollars_per_after_hours_call',
      rawValue: kpis.dollars_per_after_hours_call,
    },
    {
      label: 'After-hours conversion',
      value: formatPercent(kpis.after_hours_conversion_rate),
      sub: `${formatCount(kpis.after_hours_won_calls)} won of ${formatCount(
        kpis.after_hours_calls,
      )}`,
      info: 'The share of after-hours calls that turned into a won sale in our Odoo CRM.',
      metric: 'after_hours_conversion_rate',
      rawValue: kpis.after_hours_conversion_rate,
    },
    {
      label: 'After-hours calls',
      value: formatCount(kpis.after_hours_calls),
      sub: `${formatCount(kpis.after_hours_unique_callers)} unique callers`,
      info: 'Every call the after-hours line received in the window. "Unique callers" counts people, so someone who called several times counts once.',
      trend: callTrend,
      delta: callDelta,
    },
    {
      label: 'Known clients',
      value: formatCount(kpis.after_hours_known_callers),
      sub: `of ${formatCount(kpis.after_hours_unique_callers)} callers in CRM`,
      info: 'How many of our after-hours callers were already in our Odoo CRM before they called, matched by phone number.',
    },
    {
      label: 'New clients from after-hours',
      value: formatCount(kpis.after_hours_new_clients),
      sub: `${formatCount(kpis.after_hours_new_client_won_deals)} won · ${formatCurrency(
        kpis.after_hours_new_client_won_revenue,
      )}`,
      info: 'Brand-new customers won by the after-hours agent: callers who had no lead in our Odoo CRM before they rang the after-hours line, and were created as a lead because of that call. Counts people, not calls. The sub-line is how many of them we have already won and the revenue from those wins.',
      metric: 'after_hours_new_clients',
      rawValue: kpis.after_hours_new_clients,
    },
    {
      label: 'After-hours won revenue',
      value: formatCurrency(kpis.after_hours_won_revenue),
      sub: `${formatCount(kpis.after_hours_won_calls)} won`,
      info: 'The total dollar value of deals we won from callers who reached us after hours.',
    },
    {
      label: 'After-hours pipeline',
      value: formatCurrency(kpis.after_hours_weighted_pipeline),
      sub: 'weighted by probability',
      info: 'The combined value of still-open deals from after-hours callers, scaled down by how likely Odoo thinks each one is to close.',
    },
  ];
}

/** The health badge for a tile, plus the tooltip explaining where it landed. */
function TileBadge({ tile, config }: { tile: Tile; config: ThresholdConfig }) {
  if (!tile.metric || tile.rawValue == null) return null;
  const rule = config[tile.metric];
  const status = evaluateStatus(tile.rawValue, rule);
  if (!status) return null;
  const dir = rule.direction === 'higher-better' ? 'higher is better' : 'lower is better';
  const title = `${statusLabel(status)} — ${tile.label} (${dir}); healthy at ${
    rule.direction === 'higher-better' ? '≥' : '≤'
  } the healthy line, warning past it, otherwise critical.`;
  return <StatusBadge status={status} title={title} />;
}

/** The readout body shared by the hero face and every bench cell. */
function TileReadout({ tile, config }: { tile: Tile; config: ThresholdConfig }) {
  return (
    <>
      <InfoTip text={tile.info} />
      <div className="kpi-label">{tile.label}</div>
      <div className="kpi-value">{tile.value}</div>
      {tile.sub && <div className="kpi-sub">{tile.sub}</div>}
      <TileBadge tile={tile} config={config} />
      {tile.delta && <DeltaChip delta={tile.delta} />}
      {tile.trend && tile.trend.length > 1 && (
        <div className="kpi-spark">
          <Sparkline values={tile.trend} />
        </div>
      )}
    </>
  );
}

export function KpiTiles({ kpis, calls }: { kpis: ConversionKpis; calls: CallRow[] }) {
  // Health thresholds colour the badges + dial here; they're now edited on the
  // Settings page (Display section) rather than via an inline toggle.
  const { config } = useThresholds();

  const tiles = tilesFor(kpis, calls);
  const hero = tiles.find((t) => t.hero);
  const bench = tiles.filter((t) => !t.hero);

  return (
    <section aria-label="Headline metrics">
      {hero && (
        <div className="kpi-hero">
          <div className="kpi-hero-dial">
            <DialGauge
              value={hero.rawValue}
              rule={hero.metric ? config[hero.metric] : undefined}
              formatTick={formatCurrency}
            />
          </div>
          <div className="kpi-hero-face">
            <TileReadout tile={hero} config={config} />
          </div>
        </div>
      )}

      <div className="kpi-bench">
        {bench.map((t) => (
          <div className="kpi-cell" key={t.label}>
            <TileReadout tile={t} config={config} />
          </div>
        ))}
      </div>
    </section>
  );
}
