/**
 * When calls come in — a weekday × hour heatmap (Phoenix local time), shaded on a
 * single sequential hue (the magnitude rule). Rendered as an accessible table: a
 * hairline header of hours, a weekday per row, one shaded cell per bucket. Every
 * cell carries its exact value in a title tooltip, and a legend names the ramp — so
 * the reading never depends on colour alone. Wide, so it scrolls in its own box.
 */
import type { TimeHeatmap as TimeHeatmapData } from '../lib/heatmap';
import { rampColor, WEEKDAYS } from '../lib/heatmap';
import { InfoTip } from './InfoTip';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Compact hour label, shown every 3rd column to keep the header legible. */
function hourLabel(h: number): string {
  if (h % 3 !== 0) return '';
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function fullHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export function TimeHeatmap({
  data,
  metricLabel,
  format,
}: {
  data: TimeHeatmapData;
  metricLabel: string;
  format: (n: number) => string;
}) {
  return (
    <section className="card" aria-label="Calls by time of day and day of week">
      <div className="card-head">
        <h2>When calls come in</h2>
        <InfoTip text="Every after-hours call bucketed by day of week and hour, in Phoenix local time. Darker cells = more; the exact value is in each cell's tooltip. Switch the metric above to shade by calls, won deals, or revenue." />
      </div>
      <p className="card-note">{metricLabel} by weekday and hour (Phoenix time).</p>

      <div className="chart-scroll">
        <table className="heatmap-time">
          <thead>
            <tr>
              <th className="heatmap-corner" scope="col">
                <span className="visually-hidden">Weekday</span>
              </th>
              {HOURS.map((h) => (
                <th key={h} scope="col" className="heatmap-hour">
                  {hourLabel(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((day, d) => (
              <tr key={day}>
                <th scope="row" className="heatmap-day">
                  {day}
                </th>
                {HOURS.map((h) => {
                  const value = data.grid[d][h];
                  return (
                    <td
                      key={h}
                      className="heatmap-cell"
                      style={{ background: rampColor(value, data.max) }}
                      title={`${day} ${fullHour(h)} — ${format(value)}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <HeatmapLegend max={data.max} format={format} />
    </section>
  );
}

/** Shared ramp legend: a few swatches from low to high with the end values. */
export function HeatmapLegend({ max, format }: { max: number; format: (n: number) => string }) {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="heatmap-legend" aria-hidden="true">
      <span className="heatmap-legend-label">less</span>
      {steps.map((s) => (
        <span
          key={s}
          className="heatmap-legend-swatch"
          style={{ background: rampColor(s * max, max) }}
        />
      ))}
      <span className="heatmap-legend-label">more</span>
      <span className="heatmap-legend-max">peak {format(max)}</span>
    </div>
  );
}
