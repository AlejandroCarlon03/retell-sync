/**
 * TypeScript model of `conversion.json` — the payload written by the Python
 * package's `retell_sync/output.py` (`build_payload`). This is the single source
 * of truth for the dashboard's data shape; PR 7's visualizations build on it.
 *
 * The payload is JSON-safe (guaranteed free of NaN/Infinity), but many fields are
 * legitimately `null`: an unmatched call has no lead, an undatable call has no
 * timestamp, a call with no cost data has `cost: null`. `after_hours` is a
 * tri-state — `true` / `false` / `null` (null = the call had no usable timestamp,
 * so it is neither after- nor business-hours).
 */

/** Headline metrics. Rates are fractions in `0..1`; money is in dollars. */
export interface ConversionKpis {
  total_calls: number;
  after_hours_calls: number;
  business_hours_calls: number;
  matched_calls: number;
  after_hours_matched_calls: number;
  /** Distinct callers (by phone), all-hours. */
  unique_callers: number;
  /** Distinct callers already in the CRM (matched to a lead), all-hours. */
  known_callers: number;
  /** Distinct after-hours callers. */
  after_hours_unique_callers: number;
  /** Distinct after-hours callers already in the CRM. */
  after_hours_known_callers: number;
  /**
   * Distinct callers who were NOT in the CRM before their after-hours call and
   * became a lead because of it — new customers won by the after-hours agent.
   */
  after_hours_new_clients: number;
  /** Distinct won deals among those new-from-after-hours clients. */
  after_hours_new_client_won_deals: number;
  /** Won expected_revenue from new-from-after-hours clients, in dollars. */
  after_hours_new_client_won_revenue: number;
  /** Still-open weighted pipeline from new-from-after-hours clients, in dollars. */
  after_hours_new_client_pipeline: number;
  won_calls: number;
  after_hours_won_calls: number;
  lost_calls: number;
  /** Won calls ÷ total calls, as a fraction 0..1. */
  conversion_rate: number;
  /** After-hours won calls ÷ after-hours calls, as a fraction 0..1. */
  after_hours_conversion_rate: number;
  won_revenue: number;
  after_hours_won_revenue: number;
  dollars_per_after_hours_call: number;
  weighted_pipeline: number;
  after_hours_weighted_pipeline: number;
}

/**
 * One ordered funnel stage. Counts are **cumulative**: a call counted at stage
 * `k` is also counted at every earlier stage, so `calls` is non-increasing down
 * the funnel.
 */
export interface FunnelStage {
  position: number;
  stage: string;
  calls: number;
  after_hours_calls: number;
  expected_revenue: number;
  after_hours_expected_revenue: number;
}

/** One row per call, joined to its best-matching lead (if any). */
export interface CallRow {
  call_id: string;
  phone_key: string | null;
  /** ISO-8601 UTC timestamp, or null when the call had no usable start time. */
  ts: string | null;
  /** Tri-state: true = after-hours, false = business-hours, null = undatable. */
  after_hours: boolean | null;
  duration: number | null;
  cost: number | null;
  matched: boolean;
  lead_id: number | null;
  lead_name: string | null;
  /** Odoo lead create_date (UTC), or null when unmatched. */
  lead_created: string | null;
  /**
   * True when this after-hours call is what brought the caller into the CRM
   * (they had no lead before calling). False for existing clients, unmatched,
   * and business-hours calls.
   */
  new_after_hours_client: boolean;
  stage_label: string | null;
  /** Assigned Odoo salesperson (user_id display name), or null when none. */
  sales_rep: string | null;
  funnel_stage: string | null;
  funnel_position: number | null;
  probability: number | null;
  expected_revenue: number | null;
  weighted_value: number | null;
  is_won: boolean;
  is_lost: boolean;
}

/** The analysis window the payload covers. */
export interface ConversionWindow {
  since: string | null;
}

/**
 * Click-through URL templates. Each carries a single `{call_id}` / `{lead_id}`
 * placeholder the dashboard substitutes per row. A `null` template means that
 * link is unavailable (e.g. no Odoo web URL configured) and is simply omitted.
 */
export interface ConversionLinks {
  /** Template to a call's transcript in the Retell dashboard, or null. */
  retell_call: string | null;
  /** Template to a lead's form in the Odoo web UI, or null. */
  odoo_lead: string | null;
}

/** The full `conversion.json` document. */
export interface ConversionPayload {
  /** ISO-8601 UTC timestamp of when the payload was generated. */
  generated_at: string;
  window: ConversionWindow;
  /** Deep-link templates; optional for backward compatibility with old payloads. */
  links?: ConversionLinks;
  kpis: ConversionKpis;
  funnel: FunnelStage[];
  by_call: CallRow[];
}

/** The lightweight header slice returned by `GET /api/conversion/stats`. */
export interface ConversionStats {
  generated_at: string;
  window: ConversionWindow;
  kpis: ConversionKpis;
}
