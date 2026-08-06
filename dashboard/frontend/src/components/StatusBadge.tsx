/**
 * A small color-coded health pill for a KPI tile. Colour never carries the
 * meaning alone: a text label (Healthy / Warning / Critical) always rides with
 * the dot, and the tooltip explains why the metric landed there.
 */
import { statusLabel, type Status } from '../lib/thresholds';

export function StatusBadge({ status, title }: { status: Status; title?: string }) {
  return (
    <span className={`status-badge status-${status}`} title={title} role="status">
      <span className="status-dot" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}
