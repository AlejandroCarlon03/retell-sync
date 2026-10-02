/**
 * Follow-up gaps — the after-hours calls that need attention so none slip through.
 * A counts bench up top (unmatched callers, stalled leads, revenue at risk), then a
 * segmented control switching the table between the two buckets: Unmatched (no CRM
 * lead was ever created) and Stalled (a matched lead still at the funnel entry). The
 * table is the shared CallsTable, so the rows deep-link to Retell / Odoo and export
 * to CSV like everywhere else. Respects the global date filter via useFilteredData.
 */
import { useMemo, useState } from 'react';

import { CallsTable } from '../components/CallsTable';
import { InfoTip } from '../components/InfoTip';
import { PageFoot } from '../components/PageFoot';
import { SegmentedControl } from '../components/SegmentedControl';
import { NO_CALLS, useFilteredData } from '../hooks/useFilteredData';
import { filterGap, gapCounts } from '../lib/gaps';
import { formatCount, formatCurrency } from '../lib/format';

type Bucket = 'unmatched' | 'stalled';

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'stalled', label: 'Stalled' },
];

const BUCKET_INFO: Record<Bucket, string> = {
  unmatched:
    'After-hours calls that never became a CRM lead — the caller reached the agent but nothing was logged in Odoo. Follow up or create the lead.',
  stalled:
    "Matched after-hours leads still sitting at the funnel's entry stage — assigned but not yet advanced, won, or lost. These are waiting on a first move.",
};

export function FollowUpGapsPage() {
  const { data, range } = useFilteredData();
  const [bucket, setBucket] = useState<Bucket>('unmatched');

  const calls = data?.by_call ?? NO_CALLS;
  const counts = useMemo(() => gapCounts(calls), [calls]);
  const buckets = useMemo(
    () => ({ unmatched: filterGap(calls, 'unmatched'), stalled: filterGap(calls, 'stalled') }),
    [calls],
  );
  const rows = buckets[bucket];

  if (!data) return null;

  return (
    <>
      <section className="card" aria-label="Follow-up gaps">
        <div className="card-head">
          <h2>Follow-up gaps</h2>
          <InfoTip text="Two buckets of after-hours calls that need attention: callers with no CRM lead, and matched leads still at the funnel entry. Derived from the same call data as the rest of the dashboard; scoped to the date range in the header." />
        </div>
        <p className="card-note">
          After-hours calls at risk of slipping through — callers we never logged, and
          leads nobody has advanced yet.
        </p>
      </section>

      <section className="kpi-bench" aria-label="Follow-up gap counts">
        <div className="kpi-cell">
          <div className="kpi-label">Unmatched callers</div>
          <div className="kpi-value">{formatCount(counts.unmatchedCallers)}</div>
          <div className="kpi-sub">{formatCount(counts.unmatchedCalls)} calls, no CRM lead</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Stalled leads</div>
          <div className="kpi-value">{formatCount(counts.stalledLeads)}</div>
          <div className="kpi-sub">at the funnel entry</div>
        </div>
        <div className="kpi-cell">
          <InfoTip text="Expected revenue sitting in stalled leads, counted once per lead. Often understated — many entry-stage Odoo leads carry $0 expected revenue until qualified." />
          <div className="kpi-label">Revenue at risk</div>
          <div className="kpi-value">{formatCurrency(counts.stalledRevenue)}</div>
          <div className="kpi-sub">in stalled leads</div>
        </div>
      </section>

      <section className="card" aria-label="Gap filter">
        <SegmentedControl
          ariaLabel="Follow-up bucket"
          value={bucket}
          onChange={setBucket}
          options={BUCKETS.map((b) => ({ ...b, count: buckets[b.key].length }))}
        />
      </section>

      <CallsTable
        calls={rows}
        links={data.links}
        mode="all"
        heading={bucket === 'unmatched' ? 'Unmatched after-hours calls' : 'Stalled after-hours leads'}
        infoText={BUCKET_INFO[bucket]}
        range={range}
        exportName={bucket === 'unmatched' ? 'unmatched-calls' : 'stalled-leads'}
      />

      <PageFoot />
    </>
  );
}
