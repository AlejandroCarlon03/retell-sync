/**
 * The headline KPI row — stat tiles, not a chart (per the data-viz form
 * heuristic: a single number's job is the number). The after-hours story leads.
 */
import type { ConversionKpis } from '../types/conversion';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { InfoTip } from './InfoTip';

interface Tile {
  label: string;
  value: string;
  sub?: string;
  info: string;
}

function tilesFor(kpis: ConversionKpis): Tile[] {
  return [
    {
      label: '$ / after-hours call',
      value: formatCurrency(kpis.dollars_per_after_hours_call),
      sub: `${formatCurrency(kpis.after_hours_won_revenue)} won ÷ ${formatCount(
        kpis.after_hours_calls,
      )} calls`,
      info: 'What an after-hours call is worth on average: the revenue we won from after-hours callers, spread across every after-hours call we took.',
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
      info: 'How many calls came in outside business hours (nights and weekends, Arizona time). "Unique callers" counts people, so someone who called several times counts once.',
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

export function KpiTiles({ kpis }: { kpis: ConversionKpis }) {
  return (
    <section className="kpi-row" aria-label="Headline metrics">
      {tilesFor(kpis).map((t) => (
        <div className="kpi-tile" key={t.label}>
          <InfoTip text={t.info} />
          <div className="kpi-label">{t.label}</div>
          <div className="kpi-value">{t.value}</div>
          {t.sub && <div className="kpi-sub">{t.sub}</div>}
        </div>
      ))}
    </section>
  );
}
