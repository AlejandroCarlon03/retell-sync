/**
 * Performance highlights — the best and worst readings in the window, seated on
 * the shared scribed bench (`.kpi-bench` / `.kpi-cell`), NOT as floating cards.
 * Each cell is an engraved label, a measured figure in the readout monospace, and
 * a quiet sub-line naming the record it points to. Depth is hairline + tone.
 *
 * Every figure is DERIVED from the same `by_call` rows the KPIs use (see
 * `lib/highlights.ts`); the largest-deal cell carries the row-link treatment so it
 * drills to the Retell call and the Odoo lead. Honest empty / low-volume states.
 */
import type { CallRow, ConversionLinks } from '../types/conversion';
import { buildHighlights, MIN_DAY_VOLUME } from '../lib/highlights';
import {
  EMPTY,
  fillTemplate,
  formatCount,
  formatCurrency,
  formatPercent,
  formatUtcDay,
} from '../lib/format';
import { InfoTip } from './InfoTip';

/** A day-conversion cell (best / worst), with its honest low-volume empty line. */
function DayConversionCell({
  label,
  info,
  day,
}: {
  label: string;
  info: string;
  day: ReturnType<typeof buildHighlights>['bestConversion'];
}) {
  return (
    <div className="kpi-cell">
      <InfoTip text={info} />
      <div className="kpi-label">{label}</div>
      {day ? (
        <>
          <div className="kpi-value">{formatPercent(day.rate)}</div>
          <div className="kpi-sub">
            {formatUtcDay(day.date)} · {formatCount(day.won)}/{formatCount(day.calls)} won
          </div>
        </>
      ) : (
        <p className="kpi-empty-line">Not enough volume yet — no day with ≥{MIN_DAY_VOLUME} calls.</p>
      )}
    </div>
  );
}

export function Highlights({ calls, links }: { calls: CallRow[]; links?: ConversionLinks }) {
  const h = buildHighlights(calls);

  const gate = `Ranked among days with at least ${MIN_DAY_VOLUME} after-hours calls, so a single call can't score 100%${
    h.qualifyingDays > 0 ? ` (${h.qualifyingDays} qualify)` : ''
  }.`;

  const deal = h.largestDeal;
  const retellUrl = deal ? fillTemplate(links?.retell_call, 'call_id', deal.callId) : null;
  const odooUrl = deal ? fillTemplate(links?.odoo_lead, 'lead_id', deal.leadId) : null;

  return (
    <>
      <h2 className="bench-heading">Highlights</h2>
      <section className="kpi-bench" aria-label="Performance highlights">
        <DayConversionCell
          label="Highest-converting day"
          info={`The day with the best won-conversion (won ÷ calls). ${gate}`}
          day={h.bestConversion}
        />
        <DayConversionCell
          label="Worst-performing day"
          info={`The day with the lowest won-conversion (won ÷ calls). ${gate}`}
          day={h.worstConversion}
        />

        <div className="kpi-cell">
          <InfoTip text="The day that booked the most won expected revenue. Each deal counts once, even if the caller reached us on several calls that day." />
          <div className="kpi-label">Highest-revenue day</div>
          {h.bestRevenueDay ? (
            <>
              <div className="kpi-value">{formatCurrency(h.bestRevenueDay.wonRevenue)}</div>
              <div className="kpi-sub">{formatUtcDay(h.bestRevenueDay.date)} won</div>
            </>
          ) : (
            <p className="kpi-empty-line">No won revenue in this window yet.</p>
          )}
        </div>

        <div className="kpi-cell">
          <InfoTip text="The single biggest won deal in the window, by expected revenue. The links open its Retell call and its Odoo lead." />
          <div className="kpi-label">Largest deal</div>
          {deal ? (
            <>
              <div className="kpi-value">{formatCurrency(deal.revenue)}</div>
              <div className="kpi-sub">
                {deal.leadName ?? EMPTY}
                {deal.salesRep ? ` · ${deal.salesRep}` : ''}
              </div>
              <div className="kpi-sub kpi-sub-quiet">{formatUtcDay(deal.ts)}</div>
              <span className="row-links highlight-links">
                {retellUrl ? (
                  <a
                    className="link-btn"
                    href={retellUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this call's transcript in Retell"
                  >
                    Retell
                  </a>
                ) : (
                  <span className="link-btn link-btn-disabled">Retell</span>
                )}
                {odooUrl ? (
                  <a
                    className="link-btn"
                    href={odooUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this deal's lead in Odoo CRM"
                  >
                    Odoo
                  </a>
                ) : (
                  <span
                    className="link-btn link-btn-disabled"
                    title="Odoo web URL not configured"
                  >
                    Odoo
                  </span>
                )}
              </span>
            </>
          ) : (
            <p className="kpi-empty-line">No won deals in this window yet.</p>
          )}
        </div>
      </section>
    </>
  );
}
