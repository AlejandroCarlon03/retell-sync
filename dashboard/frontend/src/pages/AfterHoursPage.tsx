/**
 * The home surface — the after-hours recap that answers, in one screen, whether
 * the after-hours agent earns its cost. It merges what used to be two near-identical
 * front doors (the old "After-Hours" overview and "Monthly Summary" board) into a
 * single executive recap for the window selected in the header: the plain-English
 * lede, a headline "at a glance" bench with period-over-period deltas, the volume +
 * revenue trends beside the conversion funnel, a top-salespeople leaderboard, and the
 * best/worst highlights. Everything is composed from the same components and
 * `by_call` rows the detail pages use, drawn in the bench's grammar, so the home can
 * never disagree with them.
 *
 * The full after-hours calls table and the matched/unmatched client split are not
 * repeated here — they live on the All Calls and Clients surfaces respectively, so
 * the home stays a recap rather than a data dump.
 *
 * Deltas compare the active window to the equal-length window immediately before it
 * (see `lib/board.priorRange`), computed from the full unfiltered payload; an
 * unbounded range ("All time") has nothing to compare against, so the chips are
 * simply omitted and the intro says so.
 */
import { DeltaChip } from '../components/DeltaChip';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import { FunnelChart } from '../components/FunnelChart';
import { Highlights } from '../components/Highlights';
import { InfoTip } from '../components/InfoTip';
import { PageFoot } from '../components/PageFoot';
import { RevenueTrendChart } from '../components/RevenueTrendChart';
import { TopReps } from '../components/TopReps';
import { TrendChart } from '../components/TrendChart';
import { useConversionData } from '../context/conversionContext';
import { useFilteredData } from '../hooks/useFilteredData';
import { deltaOf, priorRange } from '../lib/board';
import { PRESET_LABELS, filterCalls } from '../lib/dateRange';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { computeKpis } from '../lib/kpis';
import { buildDailySeries, type PeriodDelta } from '../lib/series';
import type { ConversionKpis } from '../types/conversion';

/** A headline stat cell on the "at a glance" bench, with an optional MoM delta. */
function BoardStat({
  label,
  value,
  info,
  delta,
  sub,
}: {
  label: string;
  value: string;
  info?: string;
  delta?: PeriodDelta;
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

  const calls = filtered.by_call;
  const kpis = filtered.kpis;

  // Period-over-period: KPIs over the equal window before this one, from the full
  // (unfiltered) payload. Null for an unbounded range — no prior to compare to.
  const prior = priorRange(range);
  const priorKpis: ConversionKpis | null = prior
    ? computeKpis(filterCalls(full.by_call, prior))
    : null;
  const delta = (pick: (k: ConversionKpis) => number): PeriodDelta | undefined =>
    priorKpis ? deltaOf(pick(kpis), pick(priorKpis)) : undefined;

  const series = buildDailySeries(calls);

  return (
    <>
      <section className="card board-intro" aria-label="After-hours recap">
        <div className="card-head">
          <h2>After-hours recap</h2>
          <InfoTip text="A one-screen read on whether the after-hours agent earns its cost. Every figure reflects the date range chosen in the header; the arrows compare this window to the equal-length window right before it." />
        </div>
        <p className="card-note">
          A one-screen recap of <strong>{PRESET_LABELS[range.preset]}</strong> for the
          after-hours agent
          {priorKpis
            ? ' — arrows compare to the preceding equal period.'
            : ' — pick a month or a bounded range in the header to see period-over-period change.'}
        </p>
      </section>

      <ExecutiveSummary kpis={kpis} />

      <h2 className="bench-heading">At a glance</h2>
      <section className="kpi-bench" aria-label="Headline metrics at a glance">
        <BoardStat
          label="After-hours calls"
          value={formatCount(kpis.after_hours_calls)}
          delta={delta((k) => k.after_hours_calls)}
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
          info="Won expected revenue from after-hours callers, deduped per lead."
        />
        <BoardStat
          label="$ / after-hours call"
          value={formatCurrency(kpis.dollars_per_after_hours_call)}
          delta={delta((k) => k.dollars_per_after_hours_call)}
          info="After-hours won revenue ÷ after-hours calls — value per call taken."
        />
        <BoardStat
          label="New customers"
          value={formatCount(kpis.after_hours_new_clients)}
          delta={delta((k) => k.after_hours_new_clients)}
          info="Callers the after-hours agent brought into the CRM for the first time."
        />
        <BoardStat
          label="Open pipeline"
          value={formatCurrency(kpis.after_hours_weighted_pipeline)}
          delta={delta((k) => k.after_hours_weighted_pipeline)}
          info="Still-open weighted pipeline from after-hours callers."
        />
      </section>

      {series.length > 1 && <TrendChart series={series} range={range} />}

      <div className="grid-2">
        <FunnelChart funnel={filtered.funnel} />
        <RevenueTrendChart calls={calls} range={range} />
      </div>

      <TopReps calls={calls} />

      <Highlights calls={calls} links={filtered.links} />

      <PageFoot />
    </>
  );
}
