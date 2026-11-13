/**
 * The update prompt: a quiet strip under the label plate, in the same family as
 * the refresh and stale notices, shown when the internal server publishes a newer
 * version than the one running. "Update now" has the host download the installer,
 * check it, run it and close the app; the installer reopens the dashboard on the
 * new version. "Later" hides the strip for this window; it returns next launch.
 */
import { useState } from 'react';

import { ApiError, installUpdate } from '../api/client';
import { useAppVersion } from '../hooks/useAppVersion';

type Phase = 'idle' | 'installing' | 'handed-off' | 'failed';

export function UpdateNotice() {
  const info = useAppVersion();
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const update = info?.update;
  if (!info || !update || dismissed) return null;

  async function onUpdate() {
    setPhase('installing');
    setError(null);
    try {
      await installUpdate();
      setPhase('handed-off');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The update couldn’t be installed.');
      setPhase('failed');
    }
  }

  if (phase === 'handed-off') {
    return (
      <div className="refresh-notice update-notice" role="status" aria-live="polite">
        <span className="cal-bar" aria-hidden>
          <span className="cal-bar-seg" />
        </span>
        <span className="refresh-notice-text">
          <strong>Installing version {update.version}.</strong> The dashboard will close and
          reopen on the new version in a moment.
        </span>
      </div>
    );
  }

  return (
    <div
      className={`refresh-notice update-notice${phase === 'failed' ? ' refresh-notice-error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <UpdateGlyph />
      <span className="refresh-notice-text">
        <strong>Version {update.version} is available.</strong> You have {info.version}.
        {update.notes && <> {update.notes}</>}
        {phase === 'failed' && error && <> {error}</>}
      </span>
      <button
        type="button"
        className="btn btn-update"
        onClick={onUpdate}
        disabled={phase === 'installing'}
      >
        {phase === 'installing' ? 'Downloading…' : phase === 'failed' ? 'Try again' : 'Update now'}
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => setDismissed(true)}
        disabled={phase === 'installing'}
      >
        Later
      </button>
    </div>
  );
}

/** An up-arrow into a tray: "new version", drawn in the notice's quiet stroke. */
function UpdateGlyph() {
  return (
    <svg
      className="update-glyph"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <polyline points="7 8 12 3 17 8" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}
