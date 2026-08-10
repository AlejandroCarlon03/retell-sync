"""
Tests for :mod:`retell_sync.sla` — lead follow-up SLA detection.

Everything here is synthetic and pure: no HTTP, no files, and ``now`` is passed
in, so the overdue set is a deterministic function of ``(by_call, cfg, now)``.

The frames are built through the real conversion join (``build_conversion_by_call``
over calls + leads with DKB's actual stage names), so these tests double as a
calibration check that the detection agrees with the funnel classification:

* an after-hours caller stuck at an entry stage past the window is overdue,
* advancing the stage (quoted/measure), winning, or losing clears the alert,
* a call inside the window is not yet overdue,
* the ``unactioned_stages`` list flags stages off the entry level,
* repeat calls dedupe to one row per lead, aged from the *first* call,
* an unassigned lead renders its owner as "unassigned",
* the SLA window is configurable, and empty input yields the stable schema.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pandas as pd

from retell_sync.config import AlertConfig, AppConfig
from retell_sync.conversion import BY_CALL_FIELDS, build_conversion_by_call
from retell_sync.odoo import LEAD_FIELDS
from retell_sync.retell import CALL_FIELDS
from retell_sync.sla import OVERDUE_FIELDS, UNASSIGNED, find_overdue

# Default config: the Retell after-hours line, so every call is after-hours.
CFG = AppConfig()
ALERT = AlertConfig()  # off, 48h, DKB entry stages
NOW = datetime(2026, 8, 10, 12, 0, 0, tzinfo=UTC)


def _ago(hours: float) -> pd.Timestamp:
    return pd.Timestamp(NOW) - timedelta(hours=hours)


def _call(call_id, from_number, ts, **over):
    base = {f: None for f in CALL_FIELDS}
    base.update(call_id=call_id, from_number=from_number, ts=ts,
                duration=60.0, cost=0.25, direction="inbound")
    base.update(over)
    return base


def _lead(lead_id, phone, stage, *, user=None, revenue=0.0, probability=10.0,
          active=True, write_date="2026-08-01 12:00:00", **over):
    base = {f: None for f in LEAD_FIELDS}
    base.update(
        id=lead_id,
        name=f"Lead {lead_id}",
        phone=phone,
        stage_id=[1, stage] if stage is not None else False,
        user_id=[9, user] if user is not None else False,
        probability=probability,
        expected_revenue=revenue,
        active=active,
        write_date=write_date,
        create_date=write_date,
        type="opportunity",
    )
    base.update(over)
    return base


def _by_call(calls, leads):
    calls_df = pd.DataFrame(calls, columns=list(CALL_FIELDS))
    leads_df = pd.DataFrame(leads, columns=list(LEAD_FIELDS))
    return build_conversion_by_call(calls_df, leads_df, CFG)


# --------------------------------------------------------------------------- #
#  Core predicate                                                             #
# --------------------------------------------------------------------------- #
def test_entry_stage_past_window_is_overdue():
    by_call = _by_call(
        [_call("c1", "4805550001", _ago(60))],
        [_lead(1, "4805550001", "New Customer / Need Info", user="Jane Doe")],
    )
    out = find_overdue(by_call, ALERT, NOW)
    assert list(out.columns) == list(OVERDUE_FIELDS)
    assert len(out) == 1
    row = out.iloc[0]
    assert row["lead_id"] == 1
    assert row["sales_rep"] == "Jane Doe"
    assert row["stage_label"] == "New Customer / Need Info"
    assert row["hours_overdue"] == 60.0


def test_imported_entry_stage_is_overdue():
    # "Imported - Need to Assign Stage" maps to funnel position 0 (the entry level).
    by_call = _by_call(
        [_call("c1", "4805550002", _ago(72))],
        [_lead(1, "4805550002", "Imported - Need to Assign Stage", user="Bob")],
    )
    out = find_overdue(by_call, ALERT, NOW)
    assert len(out) == 1


def test_advanced_stage_is_not_overdue():
    # The rep advanced the lead (quoted) — the callback happened.
    by_call = _by_call(
        [_call("c1", "4805550003", _ago(60))],
        [_lead(1, "4805550003", "Quoted Customer", user="Jane")],
    )
    assert find_overdue(by_call, ALERT, NOW).empty


def test_won_lead_is_not_overdue():
    by_call = _by_call(
        [_call("c1", "4805550004", _ago(60))],
        [_lead(1, "4805550004", "Finalized - Submitted Order", revenue=5000.0)],
    )
    assert find_overdue(by_call, ALERT, NOW).empty


def test_lost_lead_is_not_overdue():
    # DKB records a called-but-dead lead as "Lead Called - Bad Lead" -> lost.
    by_call = _by_call(
        [_call("c1", "4805550005", _ago(60))],
        [_lead(1, "4805550005", "Lead Called - Bad Lead")],
    )
    assert find_overdue(by_call, ALERT, NOW).empty


def test_inside_window_is_not_overdue():
    by_call = _by_call(
        [_call("c1", "4805550006", _ago(10))],
        [_lead(1, "4805550006", "New Customer / Need Info")],
    )
    assert find_overdue(by_call, ALERT, NOW).empty


def test_unmatched_call_is_never_overdue():
    # A caller with no lead has nothing to check a callback against.
    by_call = _by_call([_call("c1", "4805559999", _ago(60))], [])
    assert find_overdue(by_call, ALERT, NOW).empty


# --------------------------------------------------------------------------- #
#  unactioned_stages branch                                                   #
# --------------------------------------------------------------------------- #
def test_unactioned_stages_flags_off_entry_stage():
    # "Quoted Customer" is funnel position 2 (advanced), so it is not overdue by
    # default — but listing it as un-actioned flags it via the membership branch.
    by_call = _by_call(
        [_call("c1", "4805550007", _ago(60))],
        [_lead(1, "4805550007", "Quoted Customer")],
    )
    assert find_overdue(by_call, ALERT, NOW).empty

    cfg = AlertConfig(unactioned_stages=("Quoted Customer",))
    out = find_overdue(by_call, cfg, NOW)
    assert len(out) == 1
    assert out.iloc[0]["stage_label"] == "Quoted Customer"


def test_unactioned_stage_match_is_case_insensitive():
    by_call = _by_call(
        [_call("c1", "4805550008", _ago(60))],
        [_lead(1, "4805550008", "Quoted Customer")],
    )
    cfg = AlertConfig(unactioned_stages=("  quoted CUSTOMER ",))
    assert len(find_overdue(by_call, cfg, NOW)) == 1


# --------------------------------------------------------------------------- #
#  Dedup, ownership, ordering, window                                         #
# --------------------------------------------------------------------------- #
def test_repeat_calls_dedupe_and_age_from_first_call():
    # Same caller rings twice; the SLA clock starts at the earliest call (60h),
    # not the later repeat (5h), and the lead appears once. The carried call_id is
    # the *first* call's (c1), so the digest's Retell link points at that call.
    by_call = _by_call(
        [
            _call("c1", "4805550010", _ago(60)),
            _call("c2", "4805550010", _ago(5)),
        ],
        [_lead(1, "4805550010", "New Customer / Need Info")],
    )
    out = find_overdue(by_call, ALERT, NOW)
    assert len(out) == 1
    assert out.iloc[0]["hours_overdue"] == 60.0
    assert out.iloc[0]["call_id"] == "c1"


def test_missing_owner_renders_unassigned():
    by_call = _by_call(
        [_call("c1", "4805550011", _ago(60))],
        [_lead(1, "4805550011", "New Customer / Need Info", user=None)],
    )
    out = find_overdue(by_call, ALERT, NOW)
    assert out.iloc[0]["sales_rep"] == UNASSIGNED


def test_overdue_sorted_most_overdue_first():
    by_call = _by_call(
        [
            _call("c1", "4805550020", _ago(50)),
            _call("c2", "4805550021", _ago(90)),
        ],
        [
            _lead(1, "4805550020", "New Customer / Need Info"),
            _lead(2, "4805550021", "Imported - Need to Assign Stage"),
        ],
    )
    out = find_overdue(by_call, ALERT, NOW)
    assert list(out["lead_id"]) == [2, 1]
    assert list(out["hours_overdue"]) == [90.0, 50.0]


def test_sla_hours_is_configurable():
    by_call = _by_call(
        [_call("c1", "4805550030", _ago(30))],
        [_lead(1, "4805550030", "New Customer / Need Info")],
    )
    # 30h is inside the default 48h window but past a 24h window.
    assert find_overdue(by_call, ALERT, NOW).empty
    assert len(find_overdue(by_call, AlertConfig(sla_hours=24.0), NOW)) == 1


def test_empty_by_call_yields_stable_schema():
    empty = pd.DataFrame(columns=list(BY_CALL_FIELDS))
    out = find_overdue(empty, ALERT, NOW)
    assert out.empty
    assert list(out.columns) == list(OVERDUE_FIELDS)


def test_naive_now_is_treated_as_utc():
    by_call = _by_call(
        [_call("c1", "4805550040", _ago(60))],
        [_lead(1, "4805550040", "New Customer / Need Info")],
    )
    naive_now = datetime(2026, 8, 10, 12, 0, 0)  # no tzinfo
    out = find_overdue(by_call, ALERT, naive_now)
    assert len(out) == 1
    assert out.iloc[0]["hours_overdue"] == 60.0
