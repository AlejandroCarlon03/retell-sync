/**
 * The signature instrument of The Measured Bench: a dial-gauge readout for the
 * lead KPI ($ / after-hours call). A scribed tick scale sweeps a semicircle; a
 * graphite needle points to the reading and a steel-blue arc (the after-hours
 * identity hue) sweeps from the zero mark to the needle. When the metric carries
 * a health rule, its warning and healthy lines are struck onto the scale as small
 * radial witness ticks — the same thresholds the status badge names in words, so
 * the colour never carries the meaning alone.
 *
 * Purely presentational: the value is shown as real text in the readout face
 * beside this dial, so the SVG is aria-hidden and adds no duplicate reading.
 */
import type { ThresholdRule } from '../lib/thresholds';

interface DialGaugeProps {
  /** The raw metric value; null/undefined renders an at-rest gauge (needle at zero). */
  value: number | null | undefined;
  /** The metric's health rule, when present — drives the scale headroom and threshold ticks. */
  rule?: ThresholdRule;
  /** Formats the scale's end label (e.g. the max reading). */
  formatTick?: (n: number) => string;
}

// Dial geometry — a top semicircle. The pivot sits low so the needle reads like
// a real gauge; the arc radius fills the face.
const CX = 120;
const CY = 128;
const R = 102;

/** Round a value up to a clean instrument scale max (1/2/2.5/5/10 × 10ⁿ). */
function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(x));
  const n = x / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Point on the arc for a scale fraction f∈[0,1] at radius rad (f=0 left, f=1 right). */
function pt(f: number, rad: number): [number, number] {
  const theta = (Math.PI * (1 - f)); // 180°(1-f) in radians
  return [CX + rad * Math.cos(theta), CY - rad * Math.sin(theta)];
}

/** SVG arc path along the scale from fraction a to fraction b. */
function arc(a: number, b: number, rad: number): string {
  const [x0, y0] = pt(a, rad);
  const [x1, y1] = pt(b, rad);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rad} ${rad} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function DialGauge({ value, rule, formatTick }: DialGaugeProps) {
  const has = value != null && Number.isFinite(value);
  const v = has ? (value as number) : 0;
  const healthy = rule?.healthy;
  const warning = rule?.warning;

  const scaleMax = niceCeil(
    Math.max(v, healthy ?? 0, warning ?? 0, 1) * 1.08,
  );
  const f = clamp01(v / scaleMax);

  // Tick scale: a minor mark every 5%, a longer major mark every 25%.
  const ticks = Array.from({ length: 21 }, (_, i) => i / 20);

  // Threshold witness marks — only drawn when they fall on the scale.
  const markers = [
    { key: 'warning', frac: warning != null ? warning / scaleMax : -1, cls: 'dial-mark-warning' },
    { key: 'healthy', frac: healthy != null ? healthy / scaleMax : -1, cls: 'dial-mark-healthy' },
  ].filter((m) => m.frac > 0.001 && m.frac < 0.999);

  const [nx, ny] = pt(f, R - 20);
  const [tailx, taily] = pt(f, -14); // short counterweight past the pivot
  const fmt = formatTick ?? ((n: number) => String(n));

  return (
    <svg
      className="dial"
      viewBox="0 0 240 156"
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
    >
      {/* Scale track */}
      <path className="dial-track" d={arc(0, 1, R)} fill="none" />
      {/* Value sweep — the after-hours reading, in steel-blue */}
      <path className="dial-sweep" d={arc(0, Math.max(f, 0.0001), R)} fill="none" />

      {/* Tick scale */}
      {ticks.map((t, i) => {
        const major = i % 5 === 0;
        const [x1, y1] = pt(t, R - (major ? 13 : 7));
        const [x2, y2] = pt(t, R - 1);
        return (
          <line
            key={t}
            className={major ? 'dial-tick dial-tick-major' : 'dial-tick'}
            x1={x1.toFixed(2)}
            y1={y1.toFixed(2)}
            x2={x2.toFixed(2)}
            y2={y2.toFixed(2)}
          />
        );
      })}

      {/* Threshold witness marks (warning / healthy), struck outside the scale */}
      {markers.map((m) => {
        const [x1, y1] = pt(m.frac, R - 1);
        const [x2, y2] = pt(m.frac, R + 9);
        return (
          <line
            key={m.key}
            className={`dial-mark ${m.cls}`}
            x1={x1.toFixed(2)}
            y1={y1.toFixed(2)}
            x2={x2.toFixed(2)}
            y2={y2.toFixed(2)}
          />
        );
      })}

      {/* Scale end labels */}
      <text className="dial-scale-label" x="16" y="150" textAnchor="start">
        0
      </text>
      <text className="dial-scale-label" x="224" y="150" textAnchor="end">
        {fmt(scaleMax)}
      </text>

      {/* Needle + hub */}
      <line
        className="dial-needle"
        x1={tailx.toFixed(2)}
        y1={taily.toFixed(2)}
        x2={nx.toFixed(2)}
        y2={ny.toFixed(2)}
      />
      <circle className="dial-hub" cx={CX} cy={CY} r="8" />
      <circle className="dial-hub-pin" cx={CX} cy={CY} r="3" />
    </svg>
  );
}
