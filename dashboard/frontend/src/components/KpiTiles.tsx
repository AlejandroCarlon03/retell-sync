/**
 * The headline KPI row — stat tiles, not a chart (per the data-viz form
 * heuristic: a single number's job is the number). The after-hours story leads.
 * The volume tile carries a sparkline + a "last 7d vs prior 7d" delta, computed
 * client-side from the by_call rows.
 */
import type { CallRow, ConversionKpis } from '../types/conversion';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { buildDailySeries, periodDelta, type PeriodDelta } from '../lib/series';
import { InfoTip } from './InfoTip';
import { Sparkline } from './Sparkline';

interface Tile {
  label: string;
  value: string;
  sub?: string;
  info: string;
  trend?: number[];
  delta?: PeriodDelta;
  /** The lead metric — rendered larger, with an accent rule, to anchor the row. */
  hero?: boolean;
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
    },
    {
      label: 'After-hours conversion',
      value: formatPercent(kpis.after_hours_conversion_rate),
      sub: `${formatCount(kpis.after_hours_won_calls)} won of ${formatCount(
        kpis.after_hours_calls,
      )}`,
      info: 'The share of after-hours calls that turned into a won sale in our Odoo CRM.',
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

function DeltaChip({ delta }: { delta: PeriodDelta }) {
  if (delta.prior === 0 && delta.recent === 0) return null;
  const up = delta.change > 0;
  const flat = delta.change === 0;
  const dir = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  const pct = delta.pct == null ? null : formatPercent(Math.abs(delta.pct));
  return (
    <span className={`kpi-delta kpi-delta-${dir}`} title="Last 7 days vs the 7 days before">
      {arrow} {pct ?? `${up ? '+' : ''}${delta.change}`} <span className="kpi-delta-note">vs prev 7d</span>
    </span>
  );
}

export function KpiTiles({ kpis, calls }: { kpis: ConversionKpis; calls: CallRow[] }) {
  return (
    <section className="kpi-row" aria-label="Headline metrics">
      {tilesFor(kpis, calls).map((t) => (
        <div className={`kpi-tile${t.hero ? ' kpi-tile-hero' : ''}`} key={t.label}>
          <InfoTip text={t.info} />
          <div className="kpi-label">{t.label}</div>
          <div className="kpi-value">{t.value}</div>
          {t.sub && <div className="kpi-sub">{t.sub}</div>}
          {t.delta && <DeltaChip delta={t.delta} />}
          {t.trend && t.trend.length > 1 && (
            <div className="kpi-spark">
              <Sparkline values={t.trend} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
