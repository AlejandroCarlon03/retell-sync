/**
 * A scribed trace — the compact trend for a KPI readout, no chart library. The
 * line is scribed in the after-hours identity hue (steel-blue) on a hairline
 * baseline rule, with a small witness tick at the latest reading, so it reads as
 * a measurement drawn onto the bench rather than a decorative swoosh. Purely
 * supporting context for the headline number, so it carries an aria-hidden and
 * no axes/labels.
 */
interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}

export function Sparkline({
  values,
  width = 96,
  height = 30,
  stroke = 'var(--series-after)',
}: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;
  const usable = height - pad * 2;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + usable - ((v - min) / span) * usable;
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Scribed baseline rule the trace is measured against. */}
      <line
        className="sparkline-base"
        x1={0}
        y1={height - 0.5}
        x2={width}
        y2={height - 0.5}
      />
      <polyline
        className="sparkline-trace"
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Witness tick at the latest reading. */}
      <circle className="sparkline-mark" cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={1.9} fill={stroke} />
    </svg>
  );
}
