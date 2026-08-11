/**
 * Where calls come from — a US tile-grid cartogram (each state one cell, see
 * lib/usStateGrid) shaded on the same sequential hue as the time heatmap, beside a
 * ranked list of states that carries the exact figures. The list is the accessible,
 * colour-independent readout; the map is the at-a-glance shape. Calls whose area
 * code we can't map to a state are surfaced as an honest "unmapped" footnote rather
 * than dropped or guessed.
 */
import type { GeoHeatmap as GeoHeatmapData } from '../lib/heatmap';
import { rampColor, rankStates } from '../lib/heatmap';
import { GRID_COLS, GRID_ROWS, STATE_GRID, stateName } from '../lib/usStateGrid';
import { InfoTip } from './InfoTip';

/** Reverse lookup: "row,col" → state code, so the grid can render position by position. */
const CELL_AT: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_GRID).map(([code, cell]) => [`${cell.row},${cell.col}`, code]),
);

export function GeoHeatmap({
  data,
  metricLabel,
  format,
}: {
  data: GeoHeatmapData;
  metricLabel: string;
  format: (n: number) => string;
}) {
  const ranked = rankStates(data);

  return (
    <section className="card" aria-label="Calls by US state">
      <div className="card-head">
        <h2>Where calls come from</h2>
        <InfoTip text="Each after-hours caller placed by the US state of their phone's area code, on a tile grid (every state an equal square, not a scaled map). Darker = more; exact values are in the list and each tile's tooltip. Area codes we can't map are counted in the footnote below, not on the map." />
      </div>
      <p className="card-note">{metricLabel} by caller state (from area code).</p>

      <div className="heatmap-geo">
        <div
          className="heatmap-map"
          role="img"
          aria-label={`US tile map shaded by ${metricLabel.toLowerCase()} per state`}
          style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
        >
          {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
            const row = Math.floor(i / GRID_COLS);
            const col = i % GRID_COLS;
            const code = CELL_AT[`${row},${col}`];
            if (!code) return <span key={i} className="heatmap-tile heatmap-tile-empty" />;
            const value = data.byState[code] ?? 0;
            return (
              <span
                key={i}
                className="heatmap-tile"
                style={{ background: rampColor(value, data.max, 65) }}
                title={`${stateName(code)} — ${format(value)}`}
              >
                {code}
              </span>
            );
          })}
        </div>

        <div className="heatmap-ranks">
          <div className="heatmap-ranks-head">Top states</div>
          {ranked.length === 0 ? (
            <p className="kpi-empty-line">No mappable caller states in this window.</p>
          ) : (
            <ol className="heatmap-rank-list">
              {ranked.slice(0, 12).map((r) => (
                <li key={r.state} className="heatmap-rank-row">
                  <span className="heatmap-rank-state">{r.state}</span>
                  <span className="heatmap-rank-bar" aria-hidden="true">
                    <span
                      className="heatmap-rank-fill"
                      style={{ width: `${data.max > 0 ? (r.value / data.max) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="heatmap-rank-value">{format(r.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {data.unknown > 0 && (
        <p className="card-note heatmap-unknown">
          {format(data.unknown)} from area codes we couldn’t map to a state (toll-free,
          non-US, or an unlisted code) — counted here but not on the map.
        </p>
      )}
    </section>
  );
}
