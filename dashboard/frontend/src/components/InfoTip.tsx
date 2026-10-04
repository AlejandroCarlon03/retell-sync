/**
 * A small "?" help affordance for the corner of a stat tile or card. Hovering or
 * focusing it reveals a plain-English note on how the number was obtained — no
 * formulas, just what it means. Keyboard-accessible (focusable button, tooltip
 * tied via aria-describedby) and works on touch (tap focuses the button).
 *
 * WCAG 1.4.13 wants content shown on hover or focus to be hoverable, persistent
 * *and dismissible*. The bubble lives inside the hover target, so it is already
 * hoverable and persistent; `dismissed` supplies the third — Escape closes a
 * bubble that is covering the reading beneath it, without moving the pointer or
 * focus. Leaving the affordance re-arms it.
 */
import { useId, useState } from 'react';

export function InfoTip({ text, label }: { text: string; label?: string }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);

  return (
    <span
      className={`infotip${dismissed ? ' infotip-dismissed' : ''}`}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || dismissed) return;
        // Only swallow the key when there is a bubble to close, so Escape still
        // reaches anything wrapping this tip.
        e.stopPropagation();
        setDismissed(true);
      }}
    >
      <button
        type="button"
        className="infotip-btn"
        aria-label={label ? `About ${label}` : 'How this number is calculated'}
        aria-describedby={id}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="infotip-bubble">
        {text}
      </span>
    </span>
  );
}
