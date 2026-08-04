"""
Tests for :mod:`retell_sync.conversion` — the join + funnel.

Everything here is synthetic and pure: no HTTP, no files, no clock. The module is
where the master plan says "most of the value and the subtle bugs live," so the
coverage is deliberately hard:

* after-hours tagging, including the exact hour/day boundaries and UTC→local
  conversion (Retell timestamps are UTC; the business runs on America/Phoenix),
* stage-name → funnel-position mapping and won/lost classification (incl. the
  archived-lead-is-lost rule),
* the phone join and its most-recently-touched multi-match tie-break,
* the cumulative funnel frame and the headline KPIs (conversion rate,
  $/after-hours call, weighted pipeline), with lead-dedup so one opportunity hit
  by several calls isn't double-counted,
* stable frame schemas on empty input.
"""

from __future__ import annotations

import pandas as pd
import pytest

from retell_sync.config import AppConfig, BusinessHoursConfig, ConversionConfig
from retell_sync.conversion import (
    BY_CALL_FIELDS,
    FUNNEL_FIELDS,
    analyze,
    build_conversion_by_call,
    build_conversion_funnel,
    compute_kpis,
    is_after_hours,
    join_calls_to_leads,
    stage_label,
    stage_to_position,
)
from retell_sync.odoo import LEAD_FIELDS
from retell_sync.retell import CALL_FIELDS

BH = BusinessHoursConfig()  # 08:00–17:00, Mon–Fri, America/Phoenix
CONV = ConversionConfig()
CFG = AppConfig()


# --------------------------------------------------------------------------- #
#  Builders for synthetic frames                                              #
# --------------------------------------------------------------------------- #
def _call(call_id, from_number, ts, **over):
    base = {f: None for f in CALL_FIELDS}
    base.update(
        call_id=call_id,
        from_number=from_number,
        ts=pd.Timestamp(ts) if ts is not None else pd.NaT,
        duration=60.0,
        cost=0.25,
        direction="inbound",
    )
    base.update(over)
    return base


def _lead(lead_id, phone, stage, *, probability=10.0, revenue=0.0, active=True,
          write_date="2026-08-01 12:00:00", **over):
    base = {f: None for f in LEAD_FIELDS}
    base.update(
        id=lead_id,
        name=f"Lead {lead_id}",
        phone=phone,
        stage_id=[1, stage] if stage is not None else False,
        probability=probability,
        expected_revenue=revenue,
        active=active,
        write_date=write_date,
        create_date=write_date,
        type="opportunity",
    )
    base.update(over)
    return base


def _calls(rows):
    return pd.DataFrame(rows, columns=list(CALL_FIELDS))


def _leads(rows):
    return pd.DataFrame(rows, columns=list(LEAD_FIELDS))


# A UTC timestamp whose Phoenix (UTC-7) wall clock is `hour` on the given date.
def _utc_for_phoenix(year, month, day, hour):
    local = pd.Timestamp(year=year, month=month, day=day, hour=hour, tz="America/Phoenix")
    return local.tz_convert("UTC")


# --------------------------------------------------------------------------- #
#  After-hours tagging                                                        #
# --------------------------------------------------------------------------- #
def test_after_hours_business_hours_weekday_is_false():
    # Wednesday 2026-08-05, 10:00 Phoenix -> in hours.
    assert is_after_hours(_utc_for_phoenix(2026, 8, 5, 10), BH) is False


def test_after_hours_evening_is_true():
    # Wednesday 20:00 Phoenix -> after hours.
    assert is_after_hours(_utc_for_phoenix(2026, 8, 5, 20), BH) is True


def test_after_hours_start_boundary_is_inclusive():
    # 08:00 exactly is the first in-hours minute.
    assert is_after_hours(_utc_for_phoenix(2026, 8, 5, 8), BH) is False


def test_after_hours_end_boundary_is_exclusive():
    # end_hour=17 is exclusive, so 17:00 is already after-hours.
    assert is_after_hours(_utc_for_phoenix(2026, 8, 5, 17), BH) is True
    assert is_after_hours(_utc_for_phoenix(2026, 8, 5, 16), BH) is False


def test_after_hours_weekend_is_true_even_midday():
    # Saturday 2026-08-08, noon Phoenix -> after-hours (non-workday).
    assert is_after_hours(_utc_for_phoenix(2026, 8, 8, 12), BH) is True


def test_after_hours_uses_local_not_utc():
    # 02:00 UTC on a weekday is 19:00 the *previous* Phoenix day (after-hours).
    ts = pd.Timestamp("2026-08-06 02:00", tz="UTC")
    assert is_after_hours(ts, BH) is True


def test_after_hours_naive_timestamp_is_treated_as_utc():
    # Naive 02:00 == 02:00 UTC == 19:00 Phoenix prior day -> after-hours.
    assert is_after_hours(pd.Timestamp("2026-08-06 02:00"), BH) is True


def test_after_hours_missing_timestamp_is_none():
    assert is_after_hours(pd.NaT, BH) is None
    assert is_after_hours(None, BH) is None


# --------------------------------------------------------------------------- #
#  Stage mapping + classification                                             #
# --------------------------------------------------------------------------- #
def test_stage_label_extracts_from_many2one():
    assert stage_label([3, "Proposition"]) == "Proposition"
    assert stage_label(False) is None
    assert stage_label(None) is None


def test_stage_to_position_matches_case_insensitive_substring():
    assert stage_to_position("New", CONV) == 0
    assert stage_to_position("Qualified", CONV) == 1
    assert stage_to_position("Proposition", CONV) == 2
    assert stage_to_position("Won", CONV) == 3


def test_stage_to_position_unknown_is_none():
    assert stage_to_position("Random Stage", CONV) is None
    assert stage_to_position(None, CONV) is None


# --------------------------------------------------------------------------- #
#  Join + tie-break                                                           #
# --------------------------------------------------------------------------- #
def test_join_matches_on_last_10_digits():
    calls = _calls([_call("c1", "+1 (480) 555-1234", "2026-08-05T17:00:00Z")])
    leads = _leads([_lead(1, "480-555-1234", "Qualified")])
    joined = join_calls_to_leads(calls, leads)
    assert joined.iloc[0]["id"] == 1
    assert joined.iloc[0]["phone_key"] == "4805551234"


def test_join_unmatched_call_has_null_lead():
    calls = _calls([_call("c1", "4805550000", "2026-08-05T17:00:00Z")])
    leads = _leads([_lead(1, "4805551234", "Qualified")])
    joined = join_calls_to_leads(calls, leads)
    assert pd.isna(joined.iloc[0]["id"])


def test_join_tiebreak_keeps_most_recently_touched_lead():
    calls = _calls([_call("c1", "4805551234", "2026-08-05T17:00:00Z")])
    leads = _leads([
        _lead(1, "4805551234", "New", write_date="2026-07-01 09:00:00"),
        _lead(2, "4805551234", "Won", write_date="2026-08-03 09:00:00"),  # newer
        _lead(3, "4805551234", "Qualified", write_date="2026-07-15 09:00:00"),
    ])
    joined = join_calls_to_leads(calls, leads)
    assert len(joined) == 1  # one row per call, not per matching lead
    assert joined.iloc[0]["id"] == 2  # newest write_date wins


def test_join_ignores_leads_with_empty_phone():
    calls = _calls([_call("c1", "4805551234", "2026-08-05T17:00:00Z")])
    leads = _leads([
        _lead(1, "n/a", "New"),          # no digits -> empty key, must not match
        _lead(2, "4805551234", "Qualified"),
    ])
    joined = join_calls_to_leads(calls, leads)
    assert joined.iloc[0]["id"] == 2


# --------------------------------------------------------------------------- #
#  conversion_by_call frame                                                   #
# --------------------------------------------------------------------------- #
def test_by_call_schema_and_row_per_call():
    calls = _calls([
        _call("c1", "4805551234", _utc_for_phoenix(2026, 8, 5, 20)),   # after-hours
        _call("c2", "4805559999", _utc_for_phoenix(2026, 8, 5, 10)),   # business hrs, no lead
    ])
    leads = _leads([_lead(1, "4805551234", "Qualified", probability=40.0, revenue=1000.0)])
    by_call = build_conversion_by_call(calls, leads, CFG)

    assert list(by_call.columns) == list(BY_CALL_FIELDS)
    assert len(by_call) == 2

    c1 = by_call[by_call["call_id"] == "c1"].iloc[0]
    assert bool(c1["after_hours"]) is True
    assert bool(c1["matched"]) is True
    assert c1["lead_id"] == 1
    assert c1["funnel_stage"] == "qualified"
    assert c1["funnel_position"] == 1
    assert c1["weighted_value"] == pytest.approx(400.0)  # 1000 * 40 / 100

    c2 = by_call[by_call["call_id"] == "c2"].iloc[0]
    assert bool(c2["after_hours"]) is False
    assert bool(c2["matched"]) is False
    assert pd.isna(c2["lead_id"])
    assert pd.isna(c2["funnel_position"])


def test_by_call_won_and_lost_classification():
    calls = _calls([
        _call("won", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),
        _call("lost", "4805550002", _utc_for_phoenix(2026, 8, 5, 20)),
    ])
    leads = _leads([
        _lead(1, "4805550001", "Won", probability=100.0, revenue=5000.0, active=True),
        # Lost opportunities are archived (active=False, probability 0).
        _lead(2, "4805550002", "Qualified", probability=0.0, revenue=800.0, active=False),
    ])
    by_call = build_conversion_by_call(calls, leads, CFG)

    won = by_call[by_call["call_id"] == "won"].iloc[0]
    assert bool(won["is_won"]) is True
    assert bool(won["is_lost"]) is False

    lost = by_call[by_call["call_id"] == "lost"].iloc[0]
    assert bool(lost["is_won"]) is False
    assert bool(lost["is_lost"]) is True


def test_by_call_empty_input_has_schema():
    by_call = build_conversion_by_call(_calls([]), _leads([]), CFG)
    assert by_call.empty
    assert list(by_call.columns) == list(BY_CALL_FIELDS)


def test_by_call_missing_timestamp_after_hours_is_none():
    calls = _calls([_call("c1", "4805551234", None)])
    leads = _leads([_lead(1, "4805551234", "New")])
    by_call = build_conversion_by_call(calls, leads, CFG)
    assert by_call.iloc[0]["after_hours"] is None


# --------------------------------------------------------------------------- #
#  Funnel frame                                                               #
# --------------------------------------------------------------------------- #
def test_funnel_is_cumulative_and_monotonic():
    # Three after-hours calls, leads at New / Qualified / Won.
    calls = _calls([
        _call("c1", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),
        _call("c2", "4805550002", _utc_for_phoenix(2026, 8, 5, 20)),
        _call("c3", "4805550003", _utc_for_phoenix(2026, 8, 5, 20)),
    ])
    leads = _leads([
        _lead(1, "4805550001", "New", probability=10.0, revenue=100.0),
        _lead(2, "4805550002", "Qualified", probability=40.0, revenue=200.0),
        _lead(3, "4805550003", "Won", probability=100.0, revenue=300.0),
    ])
    by_call = build_conversion_by_call(calls, leads, CFG)
    funnel = build_conversion_funnel(by_call, CFG)

    assert list(funnel.columns) == list(FUNNEL_FIELDS)
    # Positions 0..3 for new/qualified/proposition/won.
    calls_by_pos = dict(zip(funnel["position"], funnel["calls"], strict=True))
    assert calls_by_pos[0] == 3   # all three reached "new"
    assert calls_by_pos[1] == 2   # qualified + won
    assert calls_by_pos[2] == 1   # only the won lead passed proposition
    assert calls_by_pos[3] == 1   # won
    # Monotonically non-increasing.
    assert list(funnel["calls"]) == sorted(funnel["calls"], reverse=True)


def test_funnel_after_hours_split():
    calls = _calls([
        _call("ah", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),   # after-hours
        _call("bh", "4805550002", _utc_for_phoenix(2026, 8, 5, 10)),   # business hrs
    ])
    leads = _leads([
        _lead(1, "4805550001", "Qualified", revenue=500.0),
        _lead(2, "4805550002", "Qualified", revenue=700.0),
    ])
    funnel = build_conversion_funnel(build_conversion_by_call(calls, leads, CFG), CFG)
    qualified = funnel[funnel["position"] == 1].iloc[0]
    assert qualified["calls"] == 2
    assert qualified["after_hours_calls"] == 1
    assert qualified["expected_revenue"] == pytest.approx(1200.0)
    assert qualified["after_hours_expected_revenue"] == pytest.approx(500.0)


def test_funnel_handles_unmatched_calls():
    # An unmatched call has a <NA> funnel_position; it must simply not be counted
    # at any stage rather than crashing the nullable-boolean -> numpy conversion.
    calls = _calls([
        _call("hit", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),
        _call("miss", "4805559999", _utc_for_phoenix(2026, 8, 5, 20)),  # no lead
    ])
    leads = _leads([_lead(1, "4805550001", "Qualified", revenue=300.0)])
    funnel = build_conversion_funnel(build_conversion_by_call(calls, leads, CFG), CFG)
    calls_by_pos = dict(zip(funnel["position"], funnel["calls"], strict=True))
    assert calls_by_pos[0] == 1  # only the matched call is on the funnel
    assert calls_by_pos[1] == 1
    assert calls_by_pos[2] == 0


def test_funnel_empty_input_has_all_stage_rows():
    funnel = build_conversion_funnel(build_conversion_by_call(_calls([]), _leads([]), CFG), CFG)
    assert list(funnel["stage"]) == list(CONV.funnel_stage_order)
    assert list(funnel["calls"]) == [0, 0, 0, 0]


# --------------------------------------------------------------------------- #
#  KPIs                                                                       #
# --------------------------------------------------------------------------- #
def test_kpis_conversion_rate_and_dollars_per_after_hours_call():
    calls = _calls([
        _call("c1", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),   # AH, won
        _call("c2", "4805550002", _utc_for_phoenix(2026, 8, 5, 21)),   # AH, no lead
        _call("c3", "4805550003", _utc_for_phoenix(2026, 8, 5, 10)),   # BH, qualified
    ])
    leads = _leads([
        _lead(1, "4805550001", "Won", probability=100.0, revenue=6000.0),
        _lead(3, "4805550003", "Qualified", probability=50.0, revenue=1000.0),
    ])
    kpis = compute_kpis(build_conversion_by_call(calls, leads, CFG), CFG)

    assert kpis["total_calls"] == 3
    assert kpis["after_hours_calls"] == 2
    assert kpis["business_hours_calls"] == 1
    assert kpis["matched_calls"] == 2
    assert kpis["won_calls"] == 1
    assert kpis["after_hours_won_calls"] == 1
    assert kpis["conversion_rate"] == pytest.approx(1 / 3)
    assert kpis["after_hours_conversion_rate"] == pytest.approx(1 / 2)
    # $6000 won revenue attributable to after-hours, over 2 after-hours calls.
    assert kpis["after_hours_won_revenue"] == pytest.approx(6000.0)
    assert kpis["dollars_per_after_hours_call"] == pytest.approx(3000.0)


def test_kpis_weighted_pipeline_dedups_leads():
    # Two calls hit the SAME lead; its weighted value must count once.
    calls = _calls([
        _call("c1", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),
        _call("c2", "4805550001", _utc_for_phoenix(2026, 8, 5, 21)),
    ])
    leads = _leads([_lead(1, "4805550001", "Qualified", probability=50.0, revenue=2000.0)])
    kpis = compute_kpis(build_conversion_by_call(calls, leads, CFG), CFG)

    assert kpis["matched_calls"] == 2          # both calls matched
    # weighted = 2000 * 50 / 100 = 1000, counted ONCE despite two calls.
    assert kpis["weighted_pipeline"] == pytest.approx(1000.0)
    assert kpis["after_hours_weighted_pipeline"] == pytest.approx(1000.0)


def test_kpis_lost_counts_and_empty():
    calls = _calls([_call("c1", "4805550002", _utc_for_phoenix(2026, 8, 5, 20))])
    leads = _leads([_lead(1, "4805550002", "Qualified", probability=0.0, active=False)])
    kpis = compute_kpis(build_conversion_by_call(calls, leads, CFG), CFG)
    assert kpis["lost_calls"] == 1
    assert kpis["won_calls"] == 0

    empty = compute_kpis(build_conversion_by_call(_calls([]), _leads([]), CFG), CFG)
    assert empty["total_calls"] == 0
    assert empty["conversion_rate"] == 0.0
    assert empty["dollars_per_after_hours_call"] == 0.0


# --------------------------------------------------------------------------- #
#  analyze bundle                                                             #
# --------------------------------------------------------------------------- #
def test_analyze_bundles_all_three_and_is_pure():
    calls = _calls([_call("c1", "4805550001", _utc_for_phoenix(2026, 8, 5, 20))])
    leads = _leads([_lead(1, "4805550001", "Won", probability=100.0, revenue=9000.0)])

    first = analyze(calls, leads, CFG)
    second = analyze(calls, leads, CFG)

    assert list(first.by_call.columns) == list(BY_CALL_FIELDS)
    assert list(first.funnel.columns) == list(FUNNEL_FIELDS)
    assert first.kpis["won_calls"] == 1
    # Deterministic: same inputs -> identical frames and KPIs.
    pd.testing.assert_frame_equal(first.by_call, second.by_call)
    pd.testing.assert_frame_equal(first.funnel, second.funnel)
    assert first.kpis == second.kpis
