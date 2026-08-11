#!/usr/bin/env python3
"""
retell_sync.scorecard
=====================
Per-salesperson performance leaderboard — the weekly manager scorecard.

Where :mod:`retell_sync.sla` answers "who is overdue *right now*", this module
answers "how did each rep *do* over the window": calls handled, leads worked, won
deals, won revenue, win rate, and how many of their callers are currently overdue.
It is the reporting companion to the alerting path.

**Pure by contract.** Like :mod:`retell_sync.conversion` / :mod:`retell_sync.sla`,
nothing here does IO: :func:`build_rep_scorecard` is a deterministic transform of
``(by_call, overdue)`` and is tested with synthetic frames. Rendering + sending the
email live in :mod:`retell_sync.mailer`; the CLI wires them together.

Money and deal counts **dedupe on ``lead_id``** exactly like
:func:`retell_sync.conversion.compute_kpis`, so a deal reached on several calls
counts once and the scorecard never disagrees with the headline KPIs.
"""

from __future__ import annotations

import logging

import pandas as pd

from .sla import UNASSIGNED

log = logging.getLogger("retell_sync.scorecard")

__all__ = ["SCORE_FIELDS", "build_rep_scorecard"]

#: Columns of the scorecard frame, in order. One row per salesperson.
SCORE_FIELDS: tuple[str, ...] = (
    "rep",
    "calls",
    "matched_leads",
    "won_deals",
    "won_revenue",
    "win_rate",
    "overdue_now",
)


def build_rep_scorecard(by_call: pd.DataFrame, overdue: pd.DataFrame) -> pd.DataFrame:
    """Roll ``by_call`` up into a per-rep leaderboard, joined to the overdue set.

    ``by_call`` is the :data:`~retell_sync.conversion.BY_CALL_FIELDS` frame; ``overdue``
    is the :data:`~retell_sync.sla.OVERDUE_FIELDS` frame from
    :func:`~retell_sync.sla.find_overdue`. The result carries exactly
    :data:`SCORE_FIELDS`, one row per salesperson, sorted by won revenue (desc), then
    won deals, then calls — with the ``"unassigned"`` bucket always last.

    Per rep: ``calls`` is a row count; ``matched_leads`` / ``won_deals`` are distinct
    ``lead_id`` counts (an opportunity hit by several calls counts once); ``won_revenue``
    is the lead-deduped ``expected_revenue`` of won leads; ``win_rate`` is
    ``won_deals ÷ matched_leads`` (0 when the rep worked no matched leads); and
    ``overdue_now`` is how many of that rep's callers are currently overdue.
    """
    if by_call.empty:
        return pd.DataFrame(columns=list(SCORE_FIELDS))

    df = by_call.copy()
    df["_rep"] = df["sales_rep"].map(_rep_or_unassigned)
    overdue_counts = _overdue_by_rep(overdue)

    rows: list[dict[str, object]] = []
    for rep, grp in df.groupby("_rep", sort=False):
        won = grp[grp["is_won"].astype("boolean").fillna(False)]
        matched = grp[grp["matched"].astype("boolean").fillna(False)]
        matched_leads = int(matched["lead_id"].dropna().nunique())
        won_deals = int(won["lead_id"].dropna().nunique())
        rows.append(
            {
                "rep": rep,
                "calls": int(len(grp)),
                "matched_leads": matched_leads,
                "won_deals": won_deals,
                "won_revenue": _lead_sum(won, "expected_revenue"),
                "win_rate": round(won_deals / matched_leads, 6) if matched_leads else 0.0,
                "overdue_now": int(overdue_counts.get(str(rep), 0)),
            }
        )

    out = pd.DataFrame(rows, columns=list(SCORE_FIELDS))
    # Sort by won revenue then deals then volume; keep the unassigned bucket last so
    # a big pile of unowned calls never tops the leaderboard.
    out["_unassigned"] = out["rep"] == UNASSIGNED
    out = (
        out.sort_values(
            by=["_unassigned", "won_revenue", "won_deals", "calls"],
            ascending=[True, False, False, False],
            kind="stable",
        )
        .drop(columns="_unassigned")
        .reset_index(drop=True)
    )
    log.info("Scorecard: %d salesperson row(s)", len(out))
    return out


# --------------------------------------------------------------------------- #
#  Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _rep_or_unassigned(value: object) -> str:
    """The salesperson's name, or ``"unassigned"`` when there isn't one."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or value is pd.NA:
        return UNASSIGNED
    text = str(value).strip()
    return text or UNASSIGNED


def _lead_sum(frame: pd.DataFrame, column: str) -> float:
    """Sum ``column`` over rows deduped by ``lead_id`` (rows without a lead ignored)."""
    if frame.empty:
        return 0.0
    sub = frame[frame["lead_id"].notna()].drop_duplicates(subset="lead_id", keep="first")
    return float(pd.to_numeric(sub[column], errors="coerce").sum())


def _overdue_by_rep(overdue: pd.DataFrame) -> dict[str, int]:
    """Count overdue rows per salesperson name (``sales_rep`` already normalized)."""
    if overdue is None or overdue.empty or "sales_rep" not in overdue.columns:
        return {}
    counts = overdue["sales_rep"].map(_rep_or_unassigned).value_counts()
    return {str(k): int(v) for k, v in counts.items()}
