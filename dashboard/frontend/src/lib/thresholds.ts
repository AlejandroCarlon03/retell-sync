/**
 * KPI health thresholds — the rules that turn a raw metric into a
 * healthy / warning / critical status, plus their persistence.
 *
 * Only a curated subset of KPIs carries a health judgement: metrics where a
 * higher (or lower) number is unambiguously "good" for the after-hours agent.
 * Each rule has two boundaries; where a value falls relative to them (and the
 * rule's direction) decides the status. Rules are user-editable and persisted to
 * localStorage so a tuned set survives a window reopen — the defaults below are
 * only the starting point.
 */

/** The three-level health status a KPI can be in. */
export type Status = 'healthy' | 'warning' | 'critical';

/** Whether a bigger number is better (revenue, conversion) or worse. */
export type Direction = 'higher-better' | 'lower-better';

/** How a threshold's raw value is entered and displayed in the editor. */
export type ThresholdUnit = 'currency' | 'percent' | 'count';

/** The KPIs that carry a configurable health judgement, keyed by their field. */
export type KpiMetricKey =
  | 'dollars_per_after_hours_call'
  | 'dollars_per_unique_after_hours_call'
  | 'after_hours_conversion_rate'
  | 'after_hours_new_clients';

/**
 * One metric's rule. For `higher-better`, a value at or above `healthy` is
 * healthy and at or above `warning` is warning (so `healthy >= warning`); for
 * `lower-better` the comparisons flip (`healthy <= warning`).
 */
export interface ThresholdRule {
  direction: Direction;
  healthy: number;
  warning: number;
}

/** Static presentation metadata for a metric — not user-editable. */
export interface ThresholdMeta {
  key: KpiMetricKey;
  label: string;
  unit: ThresholdUnit;
}

export type ThresholdConfig = Record<KpiMetricKey, ThresholdRule>;

/**
 * Editor labels + units, in the order they should appear. Only metrics whose rule
 * actually drives a reading on screen are editable (today the home dial's badge
 * and threshold ticks); the other keys stay in the config so saved preferences
 * keep loading, but an editor that changes nothing would only mislead.
 */
export const THRESHOLD_META: ThresholdMeta[] = [
  { key: 'dollars_per_after_hours_call', label: '$ / after-hours call', unit: 'currency' },
];

/** Starting thresholds. Tunable at runtime; these are the seed values. */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  dollars_per_after_hours_call: { direction: 'higher-better', healthy: 50, warning: 20 },
  dollars_per_unique_after_hours_call: { direction: 'higher-better', healthy: 30, warning: 10 },
  after_hours_conversion_rate: { direction: 'higher-better', healthy: 0.15, warning: 0.05 },
  after_hours_new_clients: { direction: 'higher-better', healthy: 10, warning: 3 },
};

const STORAGE_KEY = 'retell-sync-thresholds';

/** All metric keys, for iteration / validation. */
export const METRIC_KEYS = Object.keys(DEFAULT_THRESHOLDS) as KpiMetricKey[];

/**
 * Classify a value against a rule. `null`/non-finite values have no status
 * (the tile shows no badge) — a missing metric is not "critical".
 */
export function evaluateStatus(
  value: number | null | undefined,
  rule: ThresholdRule,
): Status | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (rule.direction === 'higher-better') {
    if (value >= rule.healthy) return 'healthy';
    if (value >= rule.warning) return 'warning';
    return 'critical';
  }
  if (value <= rule.healthy) return 'healthy';
  if (value <= rule.warning) return 'warning';
  return 'critical';
}

/** Human label for a status. */
export function statusLabel(status: Status): string {
  return { healthy: 'Healthy', warning: 'Warning', critical: 'Critical' }[status];
}

function isRule(v: unknown): v is ThresholdRule {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (r.direction === 'higher-better' || r.direction === 'lower-better') &&
    typeof r.healthy === 'number' &&
    Number.isFinite(r.healthy) &&
    typeof r.warning === 'number' &&
    Number.isFinite(r.warning)
  );
}

/**
 * Load the persisted config, merged over the defaults so a partial or stale
 * stored blob (e.g. after a new metric ships) still yields a complete config.
 * Any malformed rule falls back to its default.
 */
export function loadThresholds(): ThresholdConfig {
  const merged: ThresholdConfig = { ...DEFAULT_THRESHOLDS };
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return merged;
    stored = JSON.parse(raw);
  } catch {
    return merged;
  }
  if (typeof stored !== 'object' || stored === null) return merged;
  const rec = stored as Record<string, unknown>;
  for (const key of METRIC_KEYS) {
    if (isRule(rec[key])) merged[key] = rec[key] as ThresholdRule;
  }
  return merged;
}

/** Persist the config. Failures (private mode, quota) are swallowed. */
export function saveThresholds(config: ThresholdConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* non-fatal: thresholds simply won't persist */
  }
}
