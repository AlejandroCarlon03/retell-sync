#!/usr/bin/env python3
"""
retell_sync.sla
===============
Lead follow-up SLA detection — which after-hours callers are still waiting.

retell-sync *measures* after-hours conversion; this module is the first step
toward *acting* on it. It answers one question over data the conversion join has
already produced: **which after-hours callers have not been called back within the
SLA window?**

The callback signal is the rep **advancing the lead's stage**. DKB's pipeline
encodes contact status in the stage name (a called-but-dead lead lands in
"Lead Called - Bad Lead"), so a lead still sitting at the funnel's entry level —
or at one of the configured freshly-created stages — means nobody has followed up
yet. A caller is **overdue** when:

* the call is a **matched, after-hours** lead (there is a lead to check, and it
  came in on the after-hours line),
* its call time ``ts`` is older than :attr:`~retell_sync.config.AlertConfig.sla_hours`,
* the lead is **not won/lost** (a terminal lead needs no callback), and
* the stage is **still un-actioned** — funnel position at the entry level, or the
  raw stage name in :attr:`~retell_sync.config.AlertConfig.unactioned_stages`.

**Pure by contract.** Like :mod:`retell_sync.conversion`, nothing here does IO: no
HTTP, no file writes, no clock reads. ``now`` is passed in, so the detection is a
deterministic transform of ``(by_call, cfg, now)`` and can be tested hard with
synthetic frames. Sending the digest email is PR B's job; this PR only detects.

A daily standing digest re-lists whatever is currently overdue, so there is no
per-lead alert state to keep — :func:`find_overdue` simply recomputes the set.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import pandas as pd

from .config import AlertConfig

log = logging.getLogger("retell_sync.sla")

__all__ = ["OVERDUE_FIELDS", "UNASSIGNED", "find_overdue"]

#: Funnel position of the entry stage (``funnel_stage_order[0]``). A lead still at
#: this position has not been advanced, i.e. no callback has been logged.
_ENTRY_POSITION = 0

#: Placeholder owner shown for an overdue lead with no assigned salesperson.
UNASSIGNED = "unassigned"

#: Columns of the overdue frame, in order. One row per overdue lead.
#:
#: ``call_id`` is the id of the caller's *first* after-hours call (the one whose
#: age sets the SLA clock); the digest (PR B) fills the Retell click-through link
#: template with it, just as ``lead_id`` fills the Odoo one.
OVERDUE_FIELDS: tuple[str, ...] = (
    "lead_id",
    "lead_name",
    "phone_key",
    "sales_rep",
    "stage_label",
    "call_id",
    "first_call_ts",
    "hours_overdue",
)


def find_overdue(by_call: pd.DataFrame, cfg: AlertConfig, now: datetime) -> pd.DataFrame:
    """Return the after-hours callers overdue for a callback, one row per lead.

    ``by_call`` is the :data:`~retell_sync.conversion.BY_CALL_FIELDS` frame; ``cfg``
    supplies the SLA window and the un-actioned stage list; ``now`` is the reference
    time (treated as UTC; a naive value is assumed UTC). The result carries exactly
    :data:`OVERDUE_FIELDS`, deduped on ``lead_id`` and sorted most-overdue first.

    A caller's SLA clock runs from their **first** after-hours call, so when one
    lead was rung several times the earliest call time sets the age — a later repeat
    call can't reset the clock. Rows with no lead id or no datable call time are
    dropped (there is nothing to alert on). An overdue lead with no salesperson
    renders its ``sales_rep`` as ``"unassigned"``.
    """
    if by_call.empty:
        return pd.DataFrame(columns=list(OVERDUE_FIELDS))

    now_utc = _as_utc(now)

    # Static (non-time) predicate. All of these columns are lead-constant across a
    # caller's rows (the best-lead-per-phone join), so a lead either passes on all
    # its after-hours rows or none.
    matched = by_call["matched"].astype("boolean").fillna(False)
    after_hours = (by_call["after_hours"].astype("boolean") == True).fillna(False)  # noqa: E712
    won = by_call["is_won"].astype("boolean").fillna(False)
    lost = by_call["is_lost"].astype("boolean").fillna(False)

    position = pd.to_numeric(by_call["funnel_position"], errors="coerce")
    at_entry = (position == _ENTRY_POSITION).fillna(False)
    in_unactioned = _label_in_stages(by_call["stage_label"], cfg.unactioned_stages)
    unactioned = at_entry | in_unactioned

    keep = (matched & after_hours & ~won & ~lost & unactioned).to_numpy(dtype=bool)
    if not keep.any():
        return pd.DataFrame(columns=list(OVERDUE_FIELDS))

    cols = ["lead_id", "lead_name", "phone_key", "sales_rep", "stage_label", "call_id", "ts"]
    work = by_call.loc[keep, cols].copy()
    work["_ts"] = pd.to_datetime(work["ts"], utc=True, errors="coerce")
    work = work[work["_ts"].notna() & work["lead_id"].notna()]
    if cfg.max_age_days > 0:
        # Recent calls only (see AlertConfig.max_age_days). Filtered before the
        # first-call grouping, so a caller who rang months ago and again this week
        # is judged on this week's call, exactly as the old 35-day pull did.
        work = work[work["_ts"] >= now_utc - timedelta(days=cfg.max_age_days)]
    if work.empty:
        return pd.DataFrame(columns=list(OVERDUE_FIELDS))

    # SLA age is measured from the earliest after-hours call per lead.
    work = work.sort_values("_ts", kind="stable").drop_duplicates(subset="lead_id", keep="first")

    age_hours = (now_utc - work["_ts"]).dt.total_seconds() / 3600.0
    work = work[(age_hours >= cfg.sla_hours).to_numpy(dtype=bool)]
    if work.empty:
        return pd.DataFrame(columns=list(OVERDUE_FIELDS))

    hours_overdue = ((now_utc - work["_ts"]).dt.total_seconds() / 3600.0).round(2)
    out = pd.DataFrame(
        {
            "lead_id": work["lead_id"].astype("Int64"),
            "lead_name": work["lead_name"],
            "phone_key": work["phone_key"],
            "sales_rep": work["sales_rep"].map(_owner_or_unassigned),
            "stage_label": work["stage_label"],
            "call_id": work["call_id"],
            "first_call_ts": work["_ts"],
            "hours_overdue": hours_overdue,
        },
        columns=list(OVERDUE_FIELDS),
    )
    out = out.sort_values("hours_overdue", ascending=False, kind="stable").reset_index(drop=True)
    log.info("SLA: %d overdue after-hours caller(s) past %.0fh", len(out), cfg.sla_hours)
    return out


# --------------------------------------------------------------------------- #
#  Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _as_utc(now: datetime) -> pd.Timestamp:
    """Coerce ``now`` to a UTC-aware Timestamp (a naive value is assumed UTC)."""
    ts = pd.Timestamp(now)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def _label_in_stages(labels: pd.Series, stages: tuple[str, ...]) -> pd.Series:
    """Boolean Series: whether each stage label is one of ``stages`` (case-insensitive).

    Matching is on the whole trimmed label, so an env-supplied name is compared as a
    full stage, not a substring. Missing labels are ``False``.
    """
    wanted = {s.strip().lower() for s in stages}
    if not wanted:
        return pd.Series(False, index=labels.index, dtype="boolean")
    norm = labels.astype("string").str.strip().str.lower()
    return norm.isin(wanted).fillna(False)


def _owner_or_unassigned(value: object) -> str:
    """Return the salesperson's name, or ``"unassigned"`` when there isn't one."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return UNASSIGNED
    text = str(value).strip()
    return text or UNASSIGNED
