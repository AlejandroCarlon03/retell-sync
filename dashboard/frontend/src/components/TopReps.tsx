/**
 * Top salespeople for the window — a leaderboard seated on the shared scribed
 * bench (`.kpi-bench` / `.kpi-cell`), one cell per rep: a ranked engraved label,
 * won revenue as the measured figure, and a quiet deals·calls sub-line. Derived
 * from the same `by_call` rows as the KPIs (see `lib/board.topReps`), so it always
 * agrees with them. Honest empty state when no lead carries a salesperson.
 */
import type { CallRow } from '../types/conversion';
import { topReps } from '../lib/board';
import { formatCount, formatCurrency } from '../lib/format';
import { InfoTip } from './InfoTip';

export function TopReps({ calls, limit = 5 }: { calls: CallRow[]; limit?: number }) {
  const reps = topReps(calls, limit);

  return (
    <>
      <h2 className="bench-heading">Top salespeople</h2>
      <section className="kpi-bench" aria-label="Top salespeople by won revenue">
        {reps.length === 0 ? (
          <div className="kpi-cell">
            <div className="kpi-label">Top salespeople</div>
            <p className="kpi-empty-line">No leads with an assigned salesperson in this window.</p>
          </div>
        ) : (
          reps.map((r, i) => (
            <div className="kpi-cell" key={r.rep}>
              {i === 0 && (
                <InfoTip text="Salespeople ranked by won expected revenue in this window. Revenue and deals are deduped per lead, so a deal reached on several calls counts once." />
              )}
              <div className="kpi-label">
                {i + 1} · {r.rep}
              </div>
              <div className="kpi-value">{formatCurrency(r.wonRevenue)}</div>
              <div className="kpi-sub">
                {formatCount(r.wonDeals)} won · {formatCount(r.calls)} calls
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}
