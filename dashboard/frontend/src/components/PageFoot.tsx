/**
 * The bench's closing datum — a scribed provenance stamp that anchors the foot
 * of every surface, so each page reads as one continuous bench with a real
 * close rather than trailing off after its last table. It reinforces the two
 * product truths that never appear in the numbers: the dashboard is read-only,
 * and its figures come from the Retell × Odoo join, not either source alone.
 *
 * The one measured figure it carries — the calls in the active window — is set
 * in the readout numerals per the Measured-Numeral Rule; everything else is
 * quiet engraved fine-print. It carries no witness red (that belongs to the
 * active nav key).
 */
import { useFilteredData } from '../hooks/useFilteredData';
import { formatCount } from '../lib/format';

export function PageFoot() {
  const { data } = useFilteredData();
  if (!data) return null;

  const inWindow = data.by_call.length;

  return (
    <footer className="page-foot">
      <p className="page-foot-note">
        <span className="page-foot-key">Read-only</span>
        <span className="page-foot-sep" aria-hidden="true">
          ·
        </span>
        Retell calls matched to Odoo leads by phone number
        <span className="page-foot-sep" aria-hidden="true">
          ·
        </span>
        <span className="page-foot-fig">{formatCount(inWindow)}</span> calls in this window
      </p>
    </footer>
  );
}
