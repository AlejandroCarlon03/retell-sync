/**
 * Two-needle split (signature) — two magnitudes read against one shared scribed
 * rule. The "after" value rides a needle dropping from above the rule; the
 * partner value rides a needle rising from below. Both point at their reading on
 * the same 0→scale-max graduation, so the larger channel is the needle further
 * along the rule and the gap between them is the difference — a direct, on-bench
 * comparison rather than two separate bars.
 *
 * The rule + needles are purely presentational (aria-hidden); the actual figures
 * are the tabular readouts below, which carry the accessible reading.
 */
import { formatCount, formatPercent } from '../lib/format';

interface Side {
  /** Engraved label, e.g. "Matched". */
  label: string;
  /** The measured count this needle reads. */
  value: number;
  /** Which identity hue the needle wears. */
  hue: 'after' | 'business' | 'neutral';
}

interface SplitMeterProps {
  /** The needle dropping from above the rule (drawn first). */
  after: Side;
  /** The needle rising from below the rule. */
  business: Side;
  /** Accessible name for the whole instrument. */
  ariaLabel: string;
}

// Rule geometry — a horizontal scale in a wide, short field. The rule sits on
// the mid-line; needles read it from opposite sides.
const W = 300;
const H = 60;
const X0 = 14;
const X1 = W - 14;
const MID = 30;
const UW = X1 - X0;

/** Round up to a clean instrument max (1/2/2.5/5/10 × 10ⁿ) — the dial's vocabulary. */
function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(x));
  const n = x / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function SplitMeter({ after, business, ariaLabel }: SplitMeterProps) {
  const total = after.value + business.value;
  const scaleMax = niceCeil(Math.max(after.value, business.value, 1));

  const xa = X0 + clamp01(after.value / scaleMax) * UW;
  const xb = X0 + clamp01(business.value / scaleMax) * UW;

  // Graduation ticks — a minor mark every eighth, a longer major every quarter.
  const ticks = Array.from({ length: 9 }, (_, i) => i / 8);

  return (
    <div className="split-meter" role="group" aria-label={ariaLabel}>
      <svg
        className="split-rule"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* The shared rule */}
        <line className="split-rule-line" x1={X0} y1={MID} x2={X1} y2={MID} />
        {ticks.map((t, i) => {
          const major = i % 2 === 0;
          const x = X0 + t * UW;
          const len = major ? 5 : 3;
          return (
            <line
              key={t}
              className={major ? 'split-grad split-grad-major' : 'split-grad'}
              x1={x.toFixed(2)}
              y1={MID - len}
              x2={x.toFixed(2)}
              y2={MID + len}
            />
          );
        })}

        {/* After needle — drops from above the rule */}
        <g className={`split-needle split-needle-${after.hue}`}>
          <line x1={xa.toFixed(2)} y1={9} x2={xa.toFixed(2)} y2={MID} />
          <path
            d={`M ${(xa - 4.5).toFixed(2)} ${(MID - 8).toFixed(2)} L ${(xa + 4.5).toFixed(
              2,
            )} ${(MID - 8).toFixed(2)} L ${xa.toFixed(2)} ${MID} Z`}
          />
        </g>

        {/* Business needle — rises from below the rule */}
        <g className={`split-needle split-needle-${business.hue}`}>
          <line x1={xb.toFixed(2)} y1={MID} x2={xb.toFixed(2)} y2={H - 9} />
          <path
            d={`M ${(xb - 4.5).toFixed(2)} ${(MID + 8).toFixed(2)} L ${(xb + 4.5).toFixed(
              2,
            )} ${(MID + 8).toFixed(2)} L ${xb.toFixed(2)} ${MID} Z`}
          />
        </g>
      </svg>

      <div className="split-readouts">
        {[after, business].map((s) => (
          <div className={`split-readout hue-${s.hue}`} key={s.label}>
            <span className={`split-swatch swatch-${s.hue}`} />
            <span className="split-readout-label">{s.label}</span>
            <span className="split-readout-value">{formatCount(s.value)}</span>
            <span className="split-readout-share">
              {formatPercent(total > 0 ? s.value / total : 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
