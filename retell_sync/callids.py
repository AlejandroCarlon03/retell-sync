#!/usr/bin/env python3
"""
retell_sync.callids
===================
Write the Retell ``call_id`` that created a lead onto that lead in Odoo.

The call → lead join is a phone match (:mod:`retell_sync.conversion`), and when a
phone matches several leads the most-recently-touched one wins, so attribution can
drift as other leads with the same number get edited. Storing the originating call
id on the lead (a custom ``crm.lead`` Char field named by ``ODOO_CALL_ID_FIELD``)
pins it: the join then matches that call to that lead exactly.

Only writes we can stand behind
-------------------------------
:func:`plan_call_id_writes` proposes a write for a lead only when **all** hold:

* the lead's call-id field is **empty** — nothing is ever overwritten;
* the caller's phone matches **exactly one** lead in the pull (no tie-break guess);
* the lead was created no earlier than its first matched call minus the new-client
  grace window — i.e. the lead plausibly *came from* that call, the same rule as
  the "new from after-hours" metric; an existing client's older lead is skipped;
* no other lead already holds that call id.

The plan is a pure transform (no IO). :func:`apply_call_id_writes` does the HTTP,
one ``crm.lead/write`` per lead, and stops early if Odoo keeps refusing (a missing
field or a read-only key fails every write the same way).
"""

from __future__ import annotations

import pandas as pd

from .odoo import CALL_ID_COLUMN, OdooClient, OdooError, normalize_phone

__all__ = ["PLAN_FIELDS", "plan_call_id_writes", "apply_call_id_writes"]

#: Columns of the plan frame, in order.
PLAN_FIELDS: tuple[str, ...] = ("lead_id", "lead_name", "call_id", "call_ts", "phone_key")

#: Consecutive write failures after which the backfill stops trying.
MAX_CONSECUTIVE_FAILURES = 3


def plan_call_id_writes(
    by_call: pd.DataFrame, leads: pd.DataFrame, grace_hours: float
) -> pd.DataFrame:
    """Which leads to stamp with which call id (see the module rules). Pure.

    ``by_call`` is the :func:`~retell_sync.conversion.build_conversion_by_call`
    frame; ``leads`` is the lead pull it was built from, carrying
    :data:`~retell_sync.odoo.CALL_ID_COLUMN`. Without that column (the field isn't
    configured) the plan is empty. Rows are ordered by call time.
    """
    empty = pd.DataFrame(columns=list(PLAN_FIELDS))
    if CALL_ID_COLUMN not in leads.columns or leads.empty or by_call.empty:
        return empty

    stored = leads[CALL_ID_COLUMN].astype("string").str.strip()
    has_id = stored.notna() & (stored != "")
    filled_leads = set(pd.to_numeric(leads.loc[has_id, "id"], errors="coerce").dropna().astype(int))
    taken_call_ids = set(stored[has_id])

    phone_keys = leads["phone"].map(normalize_phone)
    leads_per_phone = (
        pd.DataFrame({"key": phone_keys, "id": leads["id"]})
        .loc[lambda f: f["key"] != ""]
        .groupby("key")["id"]
        .nunique()
    )
    unambiguous = set(leads_per_phone[leads_per_phone == 1].index)

    rows = by_call.copy()
    rows["lead_id"] = pd.to_numeric(rows["lead_id"], errors="coerce")
    rows["_ts"] = pd.to_datetime(rows["ts"], utc=True, errors="coerce")
    rows["_created"] = pd.to_datetime(rows["lead_created"], utc=True, errors="coerce")
    rows = rows[
        rows["matched"].astype("boolean").fillna(False).to_numpy(dtype=bool)
        & rows["lead_id"].notna().to_numpy(dtype=bool)
        & rows["phone_key"].isin(unambiguous).to_numpy(dtype=bool)
        & rows["_ts"].notna().to_numpy(dtype=bool)
        & rows["_created"].notna().to_numpy(dtype=bool)
    ]
    rows = rows[~rows["lead_id"].astype(int).isin(filled_leads)]
    if rows.empty:
        return empty

    # The lead's earliest matched call is its candidate origin.
    first = rows.sort_values("_ts", kind="stable").groupby("lead_id", sort=False).head(1)
    grace = pd.Timedelta(hours=grace_hours)
    first = first[first["_created"] >= first["_ts"] - grace]
    first = first[~first["call_id"].astype(str).isin(taken_call_ids)]
    if first.empty:
        return empty

    plan = pd.DataFrame(
        {
            "lead_id": first["lead_id"].astype(int).to_numpy(),
            "lead_name": first["lead_name"].to_numpy(),
            "call_id": first["call_id"].astype(str).to_numpy(),
            "call_ts": first["_ts"].to_numpy(),
            "phone_key": first["phone_key"].to_numpy(),
        }
    )
    return plan.sort_values("call_ts", kind="stable").reset_index(drop=True)[list(PLAN_FIELDS)]


def apply_call_id_writes(plan: pd.DataFrame, client: OdooClient) -> tuple[int, list[str]]:
    """Write each planned call id; returns ``(written, errors)``.

    Stops after :data:`MAX_CONSECUTIVE_FAILURES` failures in a row, since a missing
    field or a key without write access fails every write identically.
    """
    written = 0
    errors: list[str] = []
    streak = 0
    for row in plan.itertuples(index=False):
        try:
            client.set_lead_call_id(int(row.lead_id), str(row.call_id))
        except OdooError as exc:
            errors.append(f"lead {row.lead_id}: {exc}")
            streak += 1
            if streak >= MAX_CONSECUTIVE_FAILURES:
                errors.append(
                    f"stopped after {MAX_CONSECUTIVE_FAILURES} failures in a row; "
                    "check the field exists and the API key can write crm.lead."
                )
                break
            continue
        written += 1
        streak = 0
    return written, errors
