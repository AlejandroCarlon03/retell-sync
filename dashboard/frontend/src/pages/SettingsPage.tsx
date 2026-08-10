/**
 * Alert-settings editor — the in-app "flexible receiver". A successor changes who
 * gets the SLA digest, the overdue window, and the on/off switch here, with no
 * code or env edit: Save writes `data/alert_settings.json` through the host's
 * `PUT /api/settings`, and the next `alert`/`run` reads it back (settings file >
 * env > default). Host-only — the static salesperson viewer never mounts this page
 * (see `hostOnly` in nav.ts / VITE_STATIC).
 *
 * Secrets are deliberately absent: the Microsoft Graph credentials and the sender
 * mailbox stay in the machine environment and are never shown or edited here.
 */
import { useEffect, useState } from 'react';

import { ApiError, fetchSettings, saveSettings } from '../api/client';
import type { AlertSettings } from '../types/settings';

/** A light, forgiving email check — enough to catch a fat-fingered address. */
function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(['']);
  const [slaHours, setSlaHours] = useState<number>(48);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    fetchSettings()
      .then((s) => {
        if (!alive) return;
        // Always leave at least one (blank) row so the field is visible to edit.
        setRecipients(s.recipients.length > 0 ? s.recipients : ['']);
        setSlaHours(s.sla_hours);
        setEnabled(s.enabled);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadError(err instanceof ApiError ? err.message : 'Could not load settings.');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const editRecipient = (index: number, value: string) => {
    setRecipients((prev) => prev.map((r, i) => (i === index ? value : r)));
    setSave({ kind: 'idle' });
  };
  const addRecipient = () => {
    setRecipients((prev) => [...prev, '']);
    setSave({ kind: 'idle' });
  };
  const removeRecipient = (index: number) => {
    setRecipients((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [''];
    });
    setSave({ kind: 'idle' });
  };

  const cleaned = recipients.map((r) => r.trim()).filter(Boolean);
  const hasInvalid = cleaned.some((r) => !isEmailish(r));
  // A blank recipient list is allowed (it falls back to the ALERT_TO env seed);
  // an address that is present but malformed is not.
  const canSave = !hasInvalid && slaHours > 0 && save.kind !== 'saving';

  const onSave = async () => {
    setSave({ kind: 'saving' });
    const payload: AlertSettings = { recipients: cleaned, sla_hours: slaHours, enabled };
    try {
      const stored = await saveSettings(payload);
      setRecipients(stored.recipients.length > 0 ? stored.recipients : ['']);
      setSlaHours(stored.sla_hours);
      setEnabled(stored.enabled);
      setSave({ kind: 'saved' });
    } catch (err: unknown) {
      setSave({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save settings.',
      });
    }
  };

  if (loading) {
    return (
      <div className="state-panel" role="status" aria-live="polite">
        <p className="state-msg">Loading settings…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="card state-msg-card state-error" role="alert">
        <div className="state-head">
          <strong>Couldn&apos;t load settings.</strong>
        </div>
        <p className="state-body">{loadError}</p>
      </section>
    );
  }

  return (
    <section className="card settings-card" aria-label="Alert settings">
        <div className="card-head">
          <h2>Callback alert delivery</h2>
        </div>
        <p className="card-note">
          Choose who receives the overdue-callback digest and when a caller counts as
          overdue. Changes take effect on the next scheduled run. Email sign-in secrets
          are configured on the server and are not shown here.
        </p>

        <fieldset className="settings-group">
          <legend>Recipients</legend>
          <p className="settings-hint">
            Addresses that receive the digest. Leave empty to use the server&apos;s
            default recipient.
          </p>
          {recipients.map((value, index) => {
            const invalid = value.trim() !== '' && !isEmailish(value);
            return (
              <div className="settings-recipient" key={index}>
                <input
                  type="email"
                  aria-label={`Recipient ${index + 1}`}
                  aria-invalid={invalid}
                  placeholder="name@dkbinc.co"
                  value={value}
                  onChange={(e) => editRecipient(index, e.target.value)}
                />
                <button
                  type="button"
                  className="threshold-btn"
                  onClick={() => removeRecipient(index)}
                  aria-label={`Remove recipient ${index + 1}`}
                >
                  Remove
                </button>
                {invalid && <span className="settings-field-error">Not a valid email.</span>}
              </div>
            );
          })}
          <button type="button" className="threshold-btn" onClick={addRecipient}>
            + Add recipient
          </button>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Overdue window</legend>
          <label className="settings-field">
            <span>SLA hours</span>
            <input
              type="number"
              min={1}
              step={1}
              value={slaHours}
              aria-invalid={!(slaHours > 0)}
              onChange={(e) => {
                setSlaHours(Number(e.target.value));
                setSave({ kind: 'idle' });
              }}
            />
          </label>
          <p className="settings-hint">
            A caller with no callback this many hours after their after-hours call is
            flagged overdue.
          </p>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Delivery</legend>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setSave({ kind: 'idle' });
              }}
            />
            <span>Send the digest email on each scheduled run</span>
          </label>
        </fieldset>

        <div className="threshold-actions">
          {save.kind === 'saved' && (
            <span className="settings-status settings-status-ok" role="status">
              Saved.
            </span>
          )}
          {save.kind === 'error' && (
            <span className="settings-status settings-status-error" role="alert">
              {save.message}
            </span>
          )}
          <button
            type="button"
            className="threshold-btn threshold-btn-primary"
            onClick={onSave}
            disabled={!canSave}
          >
            {save.kind === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
        </div>
    </section>
  );
}
