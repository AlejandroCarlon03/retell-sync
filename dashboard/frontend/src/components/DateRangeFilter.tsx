/**
 * The global date-range control that lives in the app header. A preset dropdown
 * (Last 7/30/90 days, This/Last month, All time, Custom) plus, when "Custom" is
 * chosen, a pair of from/to date inputs. Writing to the shared date-range context
 * refreshes every visualization at once — that's the whole point of it being
 * global rather than per-page.
 */
import { useDateRange } from '../context/dateRangeContext';
import { PRESET_LABELS, PRESET_ORDER, type RangePreset } from '../lib/dateRange';

/** ISO yyyy-mm-dd for a `<input type="date">`, from epoch ms. */
function toDateInput(ms: number | null): string {
  if (ms == null) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

export function DateRangeFilter() {
  const { preset, setPreset, custom, setCustom, range } = useDateRange();

  return (
    <div className="date-filter">
      <label className="date-filter-preset">
        <span className="date-filter-label">Range</span>
        <select
          className="date-select"
          value={preset}
          onChange={(e) => setPreset(e.target.value as RangePreset)}
          aria-label="Date range"
        >
          {PRESET_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </label>

      {preset === 'custom' && (
        <div className="date-filter-custom">
          <input
            type="date"
            className="date-input"
            aria-label="From date"
            value={custom.fromDate ?? toDateInput(range.from)}
            max={custom.toDate ?? undefined}
            onChange={(e) => setCustom({ ...custom, fromDate: e.target.value || null })}
          />
          <span className="date-filter-dash" aria-hidden>
            –
          </span>
          <input
            type="date"
            className="date-input"
            aria-label="To date"
            value={custom.toDate ?? toDateInput(range.to == null ? null : range.to - 1)}
            min={custom.fromDate ?? undefined}
            onChange={(e) => setCustom({ ...custom, toDate: e.target.value || null })}
          />
        </div>
      )}
    </div>
  );
}
