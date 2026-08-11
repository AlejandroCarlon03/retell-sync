/**
 * Shape of the runtime alert settings exchanged with the host's `/api/settings`
 * endpoints and persisted to `data/alert_settings.json`. Snake_case keys match the
 * file the Python config layer reads (`retell_sync.config.load_alert_settings`), so
 * this is the one wire/disk contract shared by all three sides. No secrets here —
 * the Graph credentials and sender mailbox live only in the machine environment.
 */
export interface AlertSettings {
  /** Who receives the SLA digest. Empty means "fall back to the ALERT_TO env seed". */
  recipients: string[];
  /** Hours past which an un-actioned after-hours caller is overdue. */
  sla_hours: number;
  /** Master on/off switch for sending the digest. */
  enabled: boolean;
}
