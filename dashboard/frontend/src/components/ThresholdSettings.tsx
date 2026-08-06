/**
 * Inline editor for the KPI health thresholds. Each metric exposes its two
 * boundaries (healthy / warning) and its direction; editing a field writes
 * through `setRule` immediately, so the badges on the tiles above re-colour as
 * you type. Percent metrics are entered as whole percents (15 → 0.15) and shown
 * that way; currency/count are entered as-is.
 */
import {
  THRESHOLD_META,
  type KpiMetricKey,
  type ThresholdConfig,
  type ThresholdMeta,
  type ThresholdRule,
  type ThresholdUnit,
} from '../lib/thresholds';

/** Rule value → the number shown in the input (percent scaled to whole %). */
function toDisplay(value: number, unit: ThresholdUnit): number {
  return unit === 'percent' ? Math.round(value * 1000) / 10 : value;
}

/** Input number → the stored rule value (whole % scaled back to a fraction). */
function fromDisplay(display: number, unit: ThresholdUnit): number {
  return unit === 'percent' ? display / 100 : display;
}

function unitSuffix(unit: ThresholdUnit): string {
  if (unit === 'currency') return '$';
  if (unit === 'percent') return '%';
  return '#';
}

function Row({
  meta,
  rule,
  onChange,
}: {
  meta: ThresholdMeta;
  rule: ThresholdRule;
  onChange: (rule: ThresholdRule) => void;
}) {
  const step = meta.unit === 'currency' ? 1 : meta.unit === 'percent' ? 0.5 : 1;
  const edit = (patch: Partial<ThresholdRule>) => onChange({ ...rule, ...patch });

  return (
    <div className="threshold-row">
      <div className="threshold-name">
        {meta.label} <span className="threshold-unit">({unitSuffix(meta.unit)})</span>
      </div>
      <label className="threshold-field">
        <span>Healthy ≥</span>
        <input
          type="number"
          step={step}
          value={toDisplay(rule.healthy, meta.unit)}
          onChange={(e) => edit({ healthy: fromDisplay(Number(e.target.value), meta.unit) })}
        />
      </label>
      <label className="threshold-field">
        <span>Warning ≥</span>
        <input
          type="number"
          step={step}
          value={toDisplay(rule.warning, meta.unit)}
          onChange={(e) => edit({ warning: fromDisplay(Number(e.target.value), meta.unit) })}
        />
      </label>
      <label className="threshold-field">
        <span>Direction</span>
        <select
          value={rule.direction}
          onChange={(e) => edit({ direction: e.target.value as ThresholdRule['direction'] })}
        >
          <option value="higher-better">Higher is better</option>
          <option value="lower-better">Lower is better</option>
        </select>
      </label>
    </div>
  );
}

export function ThresholdSettings({
  config,
  setRule,
  reset,
  onClose,
}: {
  config: ThresholdConfig;
  setRule: (key: KpiMetricKey, rule: ThresholdRule) => void;
  reset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="threshold-panel" role="group" aria-label="KPI health thresholds">
      <p className="threshold-help">
        Set where each metric turns healthy, warning, or critical. Changes apply
        instantly and are saved on this machine. For “higher is better”, a value at
        or above the healthy line is healthy; below the warning line is critical.
      </p>
      {THRESHOLD_META.map((meta) => (
        <Row
          key={meta.key}
          meta={meta}
          rule={config[meta.key]}
          onChange={(rule) => setRule(meta.key, rule)}
        />
      ))}
      <div className="threshold-actions">
        <button type="button" className="threshold-btn" onClick={reset}>
          Reset to defaults
        </button>
        <button type="button" className="threshold-btn threshold-btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
