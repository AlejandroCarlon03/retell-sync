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

export function ExecutiveSummary({ kpis }: { kpis: ConversionKpis }) {
  const {
    total_calls,
    after_hours_calls,
    after_hours_conversion_rate,
    after_hours_won_calls,
    after_hours_won_revenue,
    dollars_per_after_hours_call,
    after_hours_new_clients,
    after_hours_new_client_won_revenue,
    after_hours_weighted_pipeline,
  } = kpis;

  const afterShare = total_calls > 0 ? after_hours_calls / total_calls : null;

  return (
    <section className="card exec-summary" aria-label="Executive summary">
      <div className="card-head">
        <h2>Executive summary</h2>
        <InfoTip text="A plain-English recap of the after-hours agent's results for this window. It reads from the same data as the dial and the 'At a glance' bench below, so the words and the numbers always agree; it refreshes when you reload the data." />
      </div>

      <p className="exec-lede">
        The after-hours agent handled <Fig>{formatCount(after_hours_calls)}</Fig> of{' '}
        <Fig>{formatCount(total_calls)}</Fig> total calls
        {afterShare != null && <> (<Fig>{formatPercent(afterShare)}</Fig> of all volume)</>}. Of those
        after-hours calls, <Fig>{formatCount(after_hours_won_calls)}</Fig> became won deals — an
        after-hours conversion rate of <Fig>{formatPercent(after_hours_conversion_rate)}</Fig>.
      </p>

      <p className="exec-lede">
        That work brought in <Fig>{formatCount(after_hours_new_clients)}</Fig> brand-new customers and{' '}
        <Fig>{formatCurrency(after_hours_won_revenue)}</Fig> in won revenue
        {after_hours_new_client_won_revenue > 0 && (
          <> (<Fig>{formatCurrency(after_hours_new_client_won_revenue)}</Fig> of it from those new
          customers)</>
        )}
        , which works out to <Fig>{formatCurrency(dollars_per_after_hours_call)}</Fig> of value per
        after-hours call. A further <Fig>{formatCurrency(after_hours_weighted_pipeline)}</Fig> in
        weighted pipeline is still open from after-hours callers.
      </p>
    </section>
  );
}
