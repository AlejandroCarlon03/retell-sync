/**
 * A small "?" help affordance for the corner of a stat tile or card. Hovering or
 * focusing it reveals a plain-English note on how the number was obtained — no
 * formulas, just what it means. Keyboard-accessible (focusable button, tooltip
 * tied via aria-describedby) and works on touch (tap focuses the button).
 */
import { useId } from 'react';

export function InfoTip({ text }: { text: string }) {
  const id = useId();
  return (
    <span className="infotip">
      <button
        type="button"
        className="infotip-btn"
        aria-label="How this number is calculated"
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
