/**
 * The other half of the home's question, "does the after-hours agent pay for
 * itself?": what it cost to run against what it won. Seated in the same hero frame
 * as the $ / after-hours call dial, with a scribed ledger where the dial would sit
 * (won revenue, agent cost, cost per call) and the return readout on the face.
 *
 * Cost is Retell's per-call spend for the window, shown to the cent (whole dollars
 * would round the per-call cost to "$0"). Without cost data the return reads as an
 * honest em dash rather than a division by zero.
 */
import { formatCost, formatCount, formatCurrency } from '../lib/format';
import { InfoTip } from './InfoTip';

export function CostReturn({
  wonRevenue,
  cost,
  calls,
}: {
  /** Won revenue from after-hours callers (deduped per lead), in dollars. */
  wonRevenue: number;
  /** What the agent cost to run in this window, in dollars. */
  cost: number;
  /** Calls the agent handled in this window. */
  calls: number;
}) {
  const returnPerDollar = cost > 0 ? wonRevenue / cost : null;
  const perCall = calls > 0 ? cost / calls : null;

  return (
    <section className="kpi-hero" aria-label="Return on agent cost">
      <dl className="kpi-hero-dial cost-ledger">
        <div className="cost-ledger-row">
          <dt>Won revenue</dt>
          <dd>{formatCurrency(wonRevenue)}</dd>
        </div>
        <div className="cost-ledger-row">
          <dt>Agent cost</dt>
          <dd>{formatCost(cost)}</dd>
        </div>
        <div className="cost-ledger-row cost-ledger-row--quiet">
          <dt>Per call</dt>
          <dd>{formatCost(perCall)}</dd>
        </div>
      </dl>
      <div className="kpi-hero-face">
        <InfoTip
          label="return on agent cost"
          text="Won revenue from after-hours callers divided by what the agent cost to run (Retell's per-call charges) in this window. It counts revenue already won, not open pipeline."
        />
        <div className="kpi-label">Won per $1 spent</div>
        <div className="kpi-value">{formatCurrency(returnPerDollar)}</div>
        <div className="kpi-sub">on the agent, across {formatCount(calls)} calls</div>
      </div>
    </section>
  );
}
