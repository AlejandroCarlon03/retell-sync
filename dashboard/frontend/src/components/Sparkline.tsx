/**
 * Tiny inline-SVG sparkline — a compact trend for a KPI tile, no chart library.
 * Draws a smoothed polyline plus a soft area fill, scaled to the value range.
 * Purely decorative context for the headline number, so it carries an aria-hidden
 * and no axes/labels.
 */
interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}

export function Sparkline({
  values,
  width = 88,
  height = 30,
  stroke = 'var(--accent)',
}: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 2;
  const usable = height - pad * 2;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + usable - ((v - min) / span) * usable;
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${points[0][0].toFixed(1)},${height} ${line} ${points[points.length - 1][0].toFixed(1)},${height}`;

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
