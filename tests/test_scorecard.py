"""
Tests for :mod:`retell_sync.scorecard` — the per-rep performance leaderboard.

Pure: aggregation over synthetic ``by_call`` + ``overdue`` frames, no network.
"""

from __future__ import annotations

import pandas as pd

from retell_sync.conversion import BY_CALL_FIELDS
from retell_sync.scorecard import SCORE_FIELDS, build_rep_scorecard
from retell_sync.sla import OVERDUE_FIELDS, UNASSIGNED


def _by_call(rows: list[dict]) -> pd.DataFrame:
    filled = [{f: r.get(f) for f in BY_CALL_FIELDS} for r in rows]
    return pd.DataFrame(filled, columns=list(BY_CALL_FIELDS))


def _overdue(rows: list[dict]) -> pd.DataFrame:
    filled = [{f: r.get(f) for f in OVERDUE_FIELDS} for r in rows]
    return pd.DataFrame(filled, columns=list(OVERDUE_FIELDS))


def test_empty_by_call_yields_empty_scorecard():
    out = build_rep_scorecard(_by_call([]), _overdue([]))
    assert list(out.columns) == list(SCORE_FIELDS)
    assert out.empty


def test_ranks_by_won_revenue_and_dedupes_per_lead():
    by_call = _by_call(
        [
            # Jane: lead 1 won (1000) over two calls (counts once) + an open matched lead.
            {"sales_rep": "Jane", "lead_id": 1, "matched": True, "is_won": True,
             "expected_revenue": 1000},
            {"sales_rep": "Jane", "lead_id": 1, "matched": True, "is_won": True,
             "expected_revenue": 1000},
            {"sales_rep": "Jane", "lead_id": 2, "matched": True, "is_won": False,
             "expected_revenue": 500},
            # Rob: lead 3 won (2500).
            {"sales_rep": "Rob", "lead_id": 3, "matched": True, "is_won": True,
             "expected_revenue": 2500},
        ]
    )
    out = build_rep_scorecard(by_call, _overdue([]))

    assert list(out["rep"]) == ["Rob", "Jane"]  # 2500 > 1000
    jane = out[out["rep"] == "Jane"].iloc[0]
    assert jane["calls"] == 3
    assert jane["matched_leads"] == 2  # leads 1 and 2
    assert jane["won_deals"] == 1  # lead 1, once
    assert jane["won_revenue"] == 1000.0  # not double-counted
    assert jane["win_rate"] == 0.5  # 1 won of 2 matched leads
    assert jane["overdue_now"] == 0


def test_overdue_now_joins_by_rep():
    by_call = _by_call(
        [
            {"sales_rep": "Jane", "lead_id": 1, "matched": True, "is_won": True,
             "expected_revenue": 1000},
            {"sales_rep": "Rob", "lead_id": 2, "matched": True, "is_won": False},
        ]
    )
    overdue = _overdue(
        [
            {"sales_rep": "Rob", "lead_id": 2, "hours_overdue": 70.0},
            {"sales_rep": "Rob", "lead_id": 9, "hours_overdue": 60.0},
            {"sales_rep": "Jane", "lead_id": 8, "hours_overdue": 55.0},
        ]
    )
    out = build_rep_scorecard(by_call, overdue)
    counts = dict(zip(out["rep"], out["overdue_now"], strict=True))
    assert counts["Rob"] == 2
    assert counts["Jane"] == 1


def test_unassigned_bucket_sorts_last():
    by_call = _by_call(
        [
            # Unassigned pile has the most calls, but must not top the leaderboard.
            {"sales_rep": None, "lead_id": 1, "matched": True, "is_won": False},
            {"sales_rep": None, "lead_id": 2, "matched": True, "is_won": False},
            {"sales_rep": None, "lead_id": 3, "matched": True, "is_won": False},
            {"sales_rep": "Amy", "lead_id": 4, "matched": True, "is_won": True,
             "expected_revenue": 300},
        ]
    )
    out = build_rep_scorecard(by_call, _overdue([]))
    assert out.iloc[0]["rep"] == "Amy"
    assert out.iloc[-1]["rep"] == UNASSIGNED


def test_win_rate_zero_when_no_matched_leads():
    by_call = _by_call([{"sales_rep": "Ben", "lead_id": None, "matched": False, "is_won": False}])
    out = build_rep_scorecard(by_call, _overdue([]))
    ben = out[out["rep"] == "Ben"].iloc[0]
    assert ben["matched_leads"] == 0
    assert ben["win_rate"] == 0.0
