/**
 * Export button for a chart card: rasterizes the card's `<svg>` to a PNG and
 * downloads it. Sits in the card head beside the InfoTip. The chart colours come
 * from CSS variables, so the raster is produced by `svgToPng` (which inlines the
 * resolved styles); the card's own background and heading are painted into the
 * image so the download reads like what's on screen, not a bare transparent plot.
 */
import { useState } from 'react';
import type { RefObject } from 'react';

import type { DateRange } from '../lib/dateRange';
import { downloadBlob, pngFilename, svgToPng } from '../lib/export';

/** First non-transparent background walking up from `el`, else the page body's. */
function resolveBackground(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = window.getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
    node = node.parentElement;
  }
  return window.getComputedStyle(document.body).backgroundColor || '#ffffff';
}

export function ChartExportButton({
  targetRef,
  name,
  title,
  range,
  disabled = false,
}: {
  /** The chart card element containing the `<svg>` to export. */
  targetRef: RefObject<HTMLElement | null>;
  /** Base filename (before the date-range suffix), e.g. "daily-call-volume". */
  name: string;
  /** Heading drawn atop the exported image (usually the card's title). */
  title: string;
  /** Active date range, used to name the file. */
  range?: DateRange;
  /** Disable when there is no chart to export (e.g. too few points). */
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    const root = targetRef.current;
    // Target the chart surface specifically — NOT the small icon SVGs in the card
    // head (this button's own icon, the InfoTip's "?").
    const svg = root?.querySelector<SVGSVGElement>('.chart-scroll svg, svg.recharts-surface');
    if (!root || !svg) return;
    setBusy(true);
    try {
      const h2 = root.querySelector('h2');
      const titleStyle = h2 ? window.getComputedStyle(h2) : window.getComputedStyle(root);
      const blob = await svgToPng(svg, {
        background: resolveBackground(root),
        title: {
          text: title,
          color: titleStyle.color,
          font: `${titleStyle.fontWeight} ${titleStyle.fontSize} ${titleStyle.fontFamily}`,
        },
      });
      downloadBlob(pngFilename(name, range), blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-icon chart-export"
      onClick={handleExport}
      disabled={disabled || busy}
      title={disabled ? 'No chart to export' : 'Download this chart as a PNG image'}
      aria-label="Export chart as PNG"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
      PNG
    </button>
  );
}
