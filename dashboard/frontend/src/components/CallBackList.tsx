/**
 * "Call these back" — the Home page's one action list: the after-hours callers
 * still waiting on a first move, newest first, capped at a handful so the home
 * stays a verdict and not a data dump. Each row reads as caller (name over number),
 * when they called, why they're on the list, and the Odoo / Retell row-links. The
 * full set — both buckets, sortable and exportable — lives on Follow-ups, which
 * the foot links to. Derived from `lib/gaps` (the same classification Follow-ups
 * uses), so the two pages always agree on who is waiting.
 */
import type { CallRow, ConversionLinks } from '../types/conversion';
import { callBackList } from '../lib/gaps';
import { fillTemplate, formatCount, formatPhone, formatShortDateTime } from '../lib/format';
import { InfoTip } from './InfoTip';

/** How many callers the Home list shows before pointing to Follow-ups. */
export const CALL_BACK_LIMIT = 5;

const REASON = {
  // The caller cell already reads "Not in CRM"; the reason says what's missing.
  unmatched: 'Needs a lead',
  stalled: 'Stalled lead',
} as const;

export function CallBackList({ calls, links }: { calls: CallRow[]; links?: ConversionLinks }) {
  const { items, total } = callBackList(calls, CALL_BACK_LIMIT);

  return (
    <section className="card callback" aria-labelledby="callback-heading">
      <div className="card-head">
        <h2 id="callback-heading">Call these back</h2>
        <div className="card-head-right">
          <span className="table-count">
            {total === 0 ? 'Nobody waiting' : `${formatCount(total)} waiting`}
          </span>
          <InfoTip
            label="call these back"
            text="After-hours callers still waiting on a first move, newest first: callers who never became a CRM lead, and leads still at the first stage. One row per caller, on their latest call."
          />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="callback-empty">Every after-hours caller in this window has been picked up.</p>
      ) : (
        <ol className="callback-list">
          {items.map(({ call: c, kind }) => {
            const odooUrl = c.matched ? fillTemplate(links?.odoo_lead, 'lead_id', c.lead_id) : null;
            const retellUrl = fillTemplate(links?.retell_call, 'call_id', c.call_id);
            return (
              <li key={c.call_id} className="callback-row">
                <span className="callback-caller">
                  {c.matched && c.lead_name ? (
                    <span className="caller-name" title={c.lead_name}>
                      {c.lead_name}
                    </span>
                  ) : (
                    <span className="caller-name caller-unknown">Not in CRM</span>
                  )}
                  <span className="caller-phone">{formatPhone(c.phone_key)}</span>
                </span>
                <span className="callback-when">{formatShortDateTime(c.ts)}</span>
                <span className="callback-why">
                  <span className="tag">{REASON[kind]}</span>
                  {kind === 'stalled' && c.sales_rep && (
                    <span className="callback-rep" title={c.sales_rep}>
                      {c.sales_rep}
                    </span>
                  )}
                </span>
                <span className="row-links">
                  {odooUrl && (
                    <a
                      className="link-btn"
                      href={odooUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open this caller's lead in Odoo CRM"
                    >
                      Odoo
                    </a>
                  )}
                  {retellUrl && (
                    <a
                      className="link-btn"
                      href={retellUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open this call's transcript in Retell"
                    >
                      Retell
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {total > items.length && (
        <p className="callback-foot">
          <a href="#/follow-up">See all {formatCount(total)} in Follow-ups</a>
        </p>
      )}
    </section>
  );
}
