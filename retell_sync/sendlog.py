#!/usr/bin/env python3
"""
retell_sync.sendlog
===================
A durable record of every digest email the alert path actually sends.

The per-salesperson overdue digests (:mod:`retell_sync.digest`), the manager
digest, and the weekly scorecard (:mod:`retell_sync.mailer`) are all fire-and-
forget: they POST to Microsoft Graph and print a line to stdout, leaving no trace
an operator can inspect later. This module gives those sends a **persisted log**
— ``outputs/email_log.json``, an append-only JSON array — so the dashboard can
answer "which reps were emailed, on what day, and what did the message say?"
(see the Email Log page in ``dashboard/frontend``).

Design
------
* :func:`build_record` is **pure** — inputs in, a JSON-safe dict out — so the
  record shape is unit-tested with no IO.
* :func:`append_record` is the only IO: it reads the existing array (tolerant of a
  missing or corrupt file), appends, trims to the newest :data:`DEFAULT_LOG_CAP`
  entries, and writes atomically (temp file + ``os.replace``) so a crash mid-write
  can't leave a half-written log.
* :func:`record_send` is the convenience the CLI calls right after a successful
  send. It is **best-effort**: a logging failure is warned and swallowed, never
  raised, because failing to *log* a mail that already went out must not fail the
  run. The CLI only calls it in the success path (never on ``--dry-run``), so the
  log reflects mail that was truly sent.

The stored ``html`` is the same body Graph delivered, so the dashboard renders the
exact message in a sandboxed frame — the "see exactly what's being emailed" ask.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import PathsConfig

log = logging.getLogger("retell_sync.sendlog")

__all__ = [
    "EMAIL_LOG_FILENAME",
    "DEFAULT_LOG_CAP",
    "build_record",
    "append_record",
    "record_send",
]

#: Filename of the send-log, written into :attr:`PathsConfig.output_dir` alongside
#: ``conversion.json`` (so the dashboard's publish step ships both together).
EMAIL_LOG_FILENAME = "email_log.json"

#: Keep only the newest N records. The log is a rolling operational trail, not an
#: archive; capping it bounds the file the dashboard fetches and the disk it uses.
DEFAULT_LOG_CAP = 500

#: The recognized send kinds, for the dashboard to label rows.
_KINDS = ("manager", "per_rep", "scorecard")


def build_record(
    *,
    kind: str,
    recipients: list[str] | tuple[str, ...],
    subject: str,
    lead_count: int,
    html: str,
    rep: str | None = None,
    sent_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble one JSON-safe send-log record (pure — no IO, no implicit clock).

    ``kind`` is one of ``"manager"`` / ``"per_rep"`` / ``"scorecard"``; ``rep`` names
    the salesperson for a ``per_rep`` send and is ``None`` otherwise. ``lead_count``
    is the number of rows the message covered (overdue leads, or ranked reps for the
    scorecard). ``sent_at`` defaults to "now" in UTC; pass it for a deterministic
    record in tests. Every field is a JSON-native scalar or list of strings.
    """
    stamp = (sent_at or datetime.now(UTC)).isoformat()
    return {
        "sent_at": stamp,
        "kind": str(kind),
        "rep": str(rep) if rep else None,
        "recipients": [str(r) for r in recipients],
        "subject": str(subject),
        "lead_count": int(lead_count),
        "html": str(html),
    }


def append_record(
    output_dir: Path, record: dict[str, Any], *, cap: int = DEFAULT_LOG_CAP
) -> Path:
    """Append ``record`` to ``<output_dir>/email_log.json``, newest-capped, atomically.

    Reads the existing array (a missing, empty, or corrupt file is treated as an
    empty log so a hand-mangled file can't wedge delivery), appends ``record``,
    keeps only the last ``cap`` entries, and writes via a temp file + ``os.replace``
    so a reader never sees a partial document. Returns the log path.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / EMAIL_LOG_FILENAME

    records = _read_existing(path)
    records.append(record)
    if cap is not None and cap > 0 and len(records) > cap:
        records = records[-cap:]

    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(records, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return path


def record_send(
    paths: PathsConfig,
    *,
    kind: str,
    recipients: list[str] | tuple[str, ...],
    subject: str,
    lead_count: int,
    html: str,
    rep: str | None = None,
) -> None:
    """Build + append a send record, swallowing any IO error (best-effort).

    The CLI calls this immediately after a successful ``send_digest``. A failure to
    write the log is warned and dropped rather than raised: the mail already went
    out, so a logging hiccup must not fail the command or the nightly run.
    """
    try:
        record = build_record(
            kind=kind,
            recipients=recipients,
            subject=subject,
            lead_count=lead_count,
            html=html,
            rep=rep,
        )
        append_record(paths.resolved().output_dir, record)
    except OSError as exc:  # disk full, permissions, path gone — never fatal
        log.warning("Could not write email send-log: %s", exc)


def _read_existing(path: Path) -> list[dict[str, Any]]:
    """Return the current log as a list, or ``[]`` for a missing/corrupt/odd file."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return raw if isinstance(raw, list) else []
