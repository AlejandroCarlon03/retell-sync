/**
 * Executive summary — the plain-English lede that opens the home surface, above
 * the dial-gauge readout and the "At a glance" bench, and answers the whole
 * dashboard's question in a sentence or two before anyone reads a single number
 * in isolation. Every figure it cites is pulled straight from the same `kpis`
 * object the dial and the bench use, so the words and the numbers can never
 * disagree; when the shell reloads the payload, this re-renders with it.
 *
 * The prose is assembled from the payload rather than hard-coded, so it stays
 * true for an empty window, a zero-revenue window, or a busy one alike. Numbers
 * are wrapped in <strong> so the eye can skim the figures without losing the
 * sentence around them.
 */
import type { ConversionKpis } from '../types/conversion';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { InfoTip } from './InfoTip';

/** A number rendered inline and emphasized, so figures skim out of the prose. */
function Fig({ children }: { children: React.ReactNode }) {
  return <strong className="exec-fig">{children}</strong>;
}

export function ExecutiveSummary({ kpis, cost }: { kpis: ConversionKpis; cost?: number }) {
  const {
    total_calls,
    after_hours_calls,
    after_hours_conversion_rate,
    after_hours_won_calls,
    after_hours_won_revenue,
    dollars_per_after_hours_call,
    after_hours_new_clients,
    after_hours_new_client_won_deals,
    after_hours_new_client_won_revenue,
    after_hours_weighted_pipeline,
  } = kpis;

  // On DKB's Retell line every call is after-hours, so "x of x (100%)" says
  // nothing; only spell out the share when some calls were business-hours.
  const afterShare = total_calls > 0 ? after_hours_calls / total_calls : null;
  const showShare = afterShare != null && afterShare < 1;
  const returnPerDollar = cost != null && cost > 0 ? after_hours_won_revenue / cost : null;

  return (
    <section className="card exec-summary" aria-label="Executive summary">
      <div className="card-head">
        <h2>Executive summary</h2>
        <InfoTip
          label="the executive summary"
          text="A plain-English recap of the after-hours agent's results for this window, written from the same figures as the dial and the bench below."
        />
      </div>

      <p className="exec-lede">
        The after-hours agent handled <Fig>{formatCount(after_hours_calls)}</Fig>{' '}
        {showShare ? (
          <>
            of <Fig>{formatCount(total_calls)}</Fig> calls (<Fig>{formatPercent(afterShare)}</Fig>)
          </>
        ) : (
          'calls'
        )}
        . <Fig>{formatCount(after_hours_won_calls)}</Fig> of them came from callers whose deal is now
        won, a conversion rate of <Fig>{formatPercent(after_hours_conversion_rate)}</Fig>.
      </p>

      <p className="exec-lede">
        Those callers brought in <Fig>{formatCurrency(after_hours_won_revenue)}</Fig> in won revenue,{' '}
        <Fig>{formatCurrency(dollars_per_after_hours_call)}</Fig> per after-hours call
        {returnPerDollar != null && (
          <>
            {' '}
            and <Fig>{formatCurrency(returnPerDollar)}</Fig> for every $1 the agent cost to run
          </>
        )}
        . The agent also created <Fig>{formatCount(after_hours_new_clients)}</Fig> new leads
        {after_hours_new_client_won_deals > 0 && (
          <>
            , <Fig>{formatCount(after_hours_new_client_won_deals)}</Fig> of them already won (
            <Fig>{formatCurrency(after_hours_new_client_won_revenue)}</Fig>)
          </>
        )}
        , and <Fig>{formatCurrency(after_hours_weighted_pipeline)}</Fig> in weighted pipeline is
        still open.
      </p>
    </section>
  );
}
