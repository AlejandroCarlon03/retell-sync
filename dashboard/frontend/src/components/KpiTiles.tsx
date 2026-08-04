/**
 * The headline KPI row — stat tiles, not a chart (per the data-viz form
 * heuristic: a single number's job is the number). The after-hours story leads.
 */
import type { ConversionKpis } from '../types/conversion';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';

interface Tile {
  label: string;
  value: string;
  sub?: string;
}

function tilesFor(kpis: ConversionKpis): Tile[] {
  return [
    {
      label: '$ / after-hours call',
      value: formatCurrency(kpis.dollars_per_after_hours_call),
      sub: `${formatCurrency(kpis.after_hours_won_revenue)} won ÷ ${formatCount(
        kpis.after_hours_calls,
      )} calls`,
    },
    {
      label: 'After-hours conversion',
      value: formatPercent(kpis.after_hours_conversion_rate),
      sub: `${formatCount(kpis.after_hours_won_calls)} won of ${formatCount(
        kpis.after_hours_calls,
      )}`,
    },
    {
      label: 'After-hours calls',
      value: formatCount(kpis.after_hours_calls),
      sub: `${formatCount(kpis.after_hours_unique_callers)} unique callers`,
    },
    {
      label: 'Known clients',
      value: formatCount(kpis.after_hours_known_callers),
      sub: `of ${formatCount(kpis.after_hours_unique_callers)} callers in CRM`,
    },
    {
      label: 'After-hours won revenue',
      value: formatCurrency(kpis.after_hours_won_revenue),
      sub: `${formatCount(kpis.after_hours_won_calls)} won`,
    },
    {
      label: 'After-hours pipeline',
      value: formatCurrency(kpis.after_hours_weighted_pipeline),
      sub: 'weighted by probability',
    },
  ];
}

export function KpiTiles({ kpis }: { kpis: ConversionKpis }) {
  return (
    <section className="kpi-row" aria-label="Headline metrics">
      {tilesFor(kpis).map((t) => (
        <div className="kpi-tile" key={t.label}>
          <div className="kpi-label">{t.label}</div>
          <div className="kpi-value">{t.value}</div>
          {t.sub && <div className="kpi-sub">{t.sub}</div>}
        </div>
      ))}
    </section>
  );
}
