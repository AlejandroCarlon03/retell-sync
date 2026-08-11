"""
Tests for :mod:`retell_sync.digest` — per-salesperson routing of the overdue set.

All pure: grouping, name→email merging, and resolution are deterministic transforms
over a synthetic overdue frame, so no network or Odoo is involved.
"""

from __future__ import annotations

import pandas as pd

from retell_sync.digest import (
    build_rep_email_map,
    group_overdue_by_rep,
    plan_rep_digests,
)
from retell_sync.sla import OVERDUE_FIELDS, UNASSIGNED


def _overdue(rows: list[dict]) -> pd.DataFrame:
    """Build an OVERDUE_FIELDS frame from partial row dicts (missing cols -> None)."""
    filled = [{f: r.get(f) for f in OVERDUE_FIELDS} for r in rows]
    return pd.DataFrame(filled, columns=list(OVERDUE_FIELDS))


# --------------------------------------------------------------------------- #
#  group_overdue_by_rep                                                        #
# --------------------------------------------------------------------------- #
def test_group_splits_by_rep_preserving_order():
    overdue = _overdue(
        [
            {"lead_id": 1, "sales_rep": "Jane Doe", "hours_overdue": 90.0},
            {"lead_id": 2, "sales_rep": "Rob Roe", "hours_overdue": 80.0},
            {"lead_id": 3, "sales_rep": "Jane Doe", "hours_overdue": 70.0},
        ]
    )
    groups = group_overdue_by_rep(overdue)
    assert list(groups.keys()) == ["Jane Doe", "Rob Roe"]  # first-appearance order
    assert list(groups["Jane Doe"]["lead_id"]) == [1, 3]
    assert list(groups["Rob Roe"]["lead_id"]) == [2]


def test_group_empty_frame_is_empty_dict():
    assert group_overdue_by_rep(_overdue([])) == {}


# --------------------------------------------------------------------------- #
#  build_rep_email_map                                                         #
# --------------------------------------------------------------------------- #
def test_email_map_normalizes_and_drops_blanks():
    odoo = {"Jane Doe": "jane@dkb.co", "  ": "x@dkb.co", "No Email": ""}
    m = build_rep_email_map(odoo)
    assert m == {"jane doe": "jane@dkb.co"}


def test_override_wins_over_odoo():
    odoo = {"Jane Doe": "old@dkb.co", "Rob Roe": "rob@dkb.co"}
    overrides = (("jane doe", "new@dkb.co"), ("Sue Sky", "sue@dkb.co"))
    m = build_rep_email_map(odoo, overrides)
    assert m["jane doe"] == "new@dkb.co"  # override beat Odoo
    assert m["rob roe"] == "rob@dkb.co"  # untouched Odoo entry
    assert m["sue sky"] == "sue@dkb.co"  # override-only rep


# --------------------------------------------------------------------------- #
#  plan_rep_digests                                                            #
# --------------------------------------------------------------------------- #
def test_plan_resolves_and_collects_unresolved():
    overdue = _overdue(
        [
            {"lead_id": 1, "sales_rep": "Jane Doe", "hours_overdue": 90.0},
            {"lead_id": 2, "sales_rep": "Rob Roe", "hours_overdue": 80.0},
            {"lead_id": 3, "sales_rep": "Jane Doe", "hours_overdue": 70.0},
        ]
    )
    email_map = {"jane doe": "jane@dkb.co"}  # Rob has no email
    plans, unresolved = plan_rep_digests(overdue, email_map)

    assert len(plans) == 1
    assert plans[0].rep == "Jane Doe"
    assert plans[0].email == "jane@dkb.co"
    assert list(plans[0].overdue["lead_id"]) == [1, 3]  # only Jane's leads
    assert unresolved == ["Rob Roe"]


def test_plan_matches_rep_name_case_insensitively():
    overdue = _overdue([{"lead_id": 1, "sales_rep": "JANE DOE", "hours_overdue": 90.0}])
    plans, unresolved = plan_rep_digests(overdue, {"jane doe": "jane@dkb.co"})
    assert unresolved == []
    assert plans[0].email == "jane@dkb.co"


def test_plan_skips_unassigned_bucket():
    overdue = _overdue(
        [
            {"lead_id": 1, "sales_rep": "Jane Doe", "hours_overdue": 90.0},
            {"lead_id": 2, "sales_rep": UNASSIGNED, "hours_overdue": 80.0},
        ]
    )
    plans, unresolved = plan_rep_digests(overdue, {"jane doe": "jane@dkb.co"})
    assert [p.rep for p in plans] == ["Jane Doe"]
    assert UNASSIGNED not in unresolved  # unassigned is never routed nor flagged
