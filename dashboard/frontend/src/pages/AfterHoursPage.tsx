/**
 * The home surface — the after-hours recap that answers, in one screen, whether
 * the after-hours agent earns its cost. Distilled to its essence: the plain-English
 * verdict, the signature dial-gauge reading of $ / after-hours call (the one number
 * the tool exists to report), a lean supporting bench, and the conversion funnel.
 *
 * The dial carries both a health badge (from the Settings thresholds) and a
 * period-over-period delta, so the verdict reads as an instrument AND says whether
 * it is trending up or down. Everything else the two former front doors piled on
 * here — a redundant intro card, two trend charts, the reps leaderboard, and the
 * best/worst highlights — has been removed: the trends live on Cost & Volume, and
 * the full calls table and client split live on All Calls and Clients. The home
 * stays a verdict, not a data dump.
 *
 * Deltas compare the active window to the equal-length window immediately before it
 * (see `lib/board.priorRange`), computed from the full unfiltered payload; an
 * unbounded range ("All time") has nothing to compare against, so the chip is
 * simply omitted.
 */
import { DeltaChip } from '../components/DeltaChip';
import { DialGauge } from '../components/DialGauge';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import { FunnelChart } from '../components/FunnelChart';
import { InfoTip } from '../components/InfoTip';
import { PageFoot } from '../components/PageFoot';
import { StatusBadge } from '../components/StatusBadge';
import { useConversionData } from '../context/conversionContext';
import { useFilteredData } from '../hooks/useFilteredData';
import { useThresholds } from '../hooks/useThresholds';
import { deltaOf, priorRange } from '../lib/board';
import { filterCalls } from '../lib/dateRange';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { computeKpis } from '../lib/kpis';
import { evaluateStatus, statusLabel } from '../lib/thresholds';
import type { PeriodDelta } from '../lib/series';
import type { ConversionKpis } from '../types/conversion';

/**
 * The verdict — the signature dial-gauge reading of $ / after-hours call, its
 * health badge, and its period-over-period delta, seated on the shared hero frame.
 */
function HeroVerdict({ kpis, delta }: { kpis: ConversionKpis; delta?: PeriodDelta }) {
  const { config } = useThresholds();
  const rule = config.dollars_per_after_hours_call;
  const value = kpis.dollars_per_after_hours_call;
  const status = evaluateStatus(value, rule);
  const dir = rule.direction === 'higher-better' ? 'higher is better' : 'lower is better';
  const badgeTitle = status
    ? `${statusLabel(status)} — $ / after-hours call (${dir}); healthy at ${
        rule.direction === 'higher-better' ? '≥' : '≤'
      } the healthy line, warning past it, otherwise critical.`
    : undefined;

  return (
    <section className="kpi-hero" aria-label="Value per after-hours call">
      <div className="kpi-hero-dial">
        <DialGauge value={value} rule={rule} formatTick={formatCurrency} />
      </div>
      <div className="kpi-hero-face">
        <InfoTip text="What an after-hours call is worth on average: the revenue we won from after-hours callers, spread across every after-hours call we took." />
        <div className="kpi-label">$ / after-hours call</div>
        <div className="kpi-value">{formatCurrency(value)}</div>
        <div className="kpi-sub">
          {formatCurrency(kpis.after_hours_won_revenue)} won ÷{' '}
          {formatCount(kpis.after_hours_calls)} calls
        </div>
        {status && <StatusBadge status={status} title={badgeTitle} />}
        {delta && (
          <DeltaChip
            delta={delta}
            title="This period vs the equal-length period immediately before it"
            note="vs prev period"
            format={formatCurrency}
          />
        )}
      </div>
    </section>
  );
}

/** A supporting stat cell on the "at a glance" bench, with an optional MoM delta. */
function BoardStat({
  label,
  value,
  info,
  delta,
  deltaFormat,
  sub,
}: {
  label: string;
  value: string;
  info?: string;
  delta?: PeriodDelta;
  /** Formats the delta's absolute-change fallback to match the figure (see DeltaChip). */
  deltaFormat?: (n: number) => string;
  sub?: string;
}) {
  return (
    <div className="kpi-cell">
      {info && <InfoTip text={info} />}
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {delta && (
        <DeltaChip
          delta={delta}
          title="This period vs the equal-length period immediately before it"
          note="vs prev period"
          format={deltaFormat}
        />
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function AfterHoursPage() {
  const { data: filtered, range } = useFilteredData();
  const { data: full } = useConversionData();
  if (!filtered || !full) return null;

  const kpis = filtered.kpis;

  // Period-over-period: KPIs over the equal window before this one, from the full
  // (unfiltered) payload. Null for an unbounded range — no prior to compare to.
  const prior = priorRange(range);
  const priorKpis: ConversionKpis | null = prior
    ? computeKpis(filterCalls(full.by_call, prior))
    : null;
  const delta = (pick: (k: ConversionKpis) => number): PeriodDelta | undefined =>
    priorKpis ? deltaOf(pick(kpis), pick(priorKpis)) : undefined;

  return (
    <>
      <ExecutiveSummary kpis={kpis} />

      <HeroVerdict kpis={kpis} delta={delta((k) => k.dollars_per_after_hours_call)} />

      <h2 className="bench-heading">At a glance</h2>
      <section className="kpi-bench" aria-label="Headline metrics at a glance">
        <BoardStat
          label="After-hours calls"
          value={formatCount(kpis.after_hours_calls)}
          delta={delta((k) => k.after_hours_calls)}
          deltaFormat={formatCount}
          info="Calls the after-hours agent handled in this window."
        />
        <BoardStat
          label="Conversion rate"
          value={formatPercent(kpis.after_hours_conversion_rate)}
          sub={`${formatCount(kpis.after_hours_won_calls)} won`}
          info="After-hours won calls ÷ after-hours calls in this window."
        />
        <BoardStat
          label="Won revenue"
          value={formatCurrency(kpis.after_hours_won_revenue)}
          delta={delta((k) => k.after_hours_won_revenue)}
          deltaFormat={formatCurrency}
          info="Won expected revenue from after-hours callers, deduped per lead."
        />
        <BoardStat
          label="New customers"
          value={formatCount(kpis.after_hours_new_clients)}
          delta={delta((k) => k.after_hours_new_clients)}
          deltaFormat={formatCount}
          info="Callers the after-hours agent brought into the CRM for the first time."
        />
      </section>

      <FunnelChart funnel={filtered.funnel} />

      <PageFoot />
    </>
  );
}
