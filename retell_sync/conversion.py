#!/usr/bin/env python3
"""
retell_sync.conversion
======================
The join + funnel — where an after-hours call becomes a dollar figure.

This is the analytical heart of the project and, by design, the only place the
two data sources meet. It takes the normalized call frame from
:mod:`retell_sync.retell` and the lead frame from :mod:`retell_sync.odoo` and
produces three things:

* ``conversion_by_call`` — one row per call, joined to its best-matching lead,
  tagged after-hours vs business-hours, and classified on the funnel (stage
  position, won/lost, weighted value).
* ``conversion_funnel`` — the ordered funnel: how many calls (and dollars) reach
  each stage, split out by after-hours.
* a ``kpis`` mapping — conversion rate, dollars per after-hours call, and the
  weighted pipeline (Σ expected_revenue × probability).

:func:`analyze` bundles all three into a :class:`ConversionResult`.

**Pure by contract.** Nothing in this module does IO: no HTTP, no file writes,
no clock reads. Every function is a deterministic transform of its inputs plus
config, so the funnel logic can be tested hard with synthetic frames (see the
master plan — "most of the value and the subtle bugs live here"). Persisting the
frames is PR 5's job (:mod:`retell_sync.output`).

Join semantics (from the master-plan gotchas)
---------------------------------------------
* Calls and leads join on the **last 10 digits** of the phone
  (:func:`retell_sync.odoo.normalize_phone`) — calls' ``from_number`` against
  leads' ``phone``. (This Odoo instance's ``crm.lead`` has no ``mobile`` field,
  so ``phone`` is the only key.)
* A phone can match several leads; the tie-break is the **most-recently-touched**
  lead (``write_date`` desc), the same rule the production Zapier step uses.
* **Lost leads are archived** (``active = false``). They arrive in the lead frame
  because :mod:`retell_sync.odoo` disables ``active_test``; here a matched lead
  with ``active is False`` (and not won) is classified *lost* rather than dropped.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import pandas as pd

from .config import AppConfig, BusinessHoursConfig, ConversionConfig
from .odoo import LEAD_FIELDS, normalize_phone
from .retell import CALL_FIELDS

log = logging.getLogger("retell_sync.conversion")

__all__ = [
    "BY_CALL_FIELDS",
    "FUNNEL_FIELDS",
    "ConversionResult",
    "analyze",
    "build_conversion_by_call",
    "build_conversion_funnel",
    "compute_kpis",
    "is_after_hours",
    "join_calls_to_leads",
    "stage_label",
    "stage_to_position",
]

#: Columns of the ``conversion_by_call`` frame, in order. One row per input call.
BY_CALL_FIELDS: tuple[str, ...] = (
    "call_id",
    "phone_key",
    "ts",
    "after_hours",
    "duration",
    "cost",
    "matched",
    "lead_id",
    "lead_name",
    "stage_label",
    "funnel_stage",
    "funnel_position",
    "probability",
    "expected_revenue",
    "weighted_value",
    "is_won",
    "is_lost",
)

#: Columns of the ``conversion_funnel`` frame, in order. One row per funnel stage.
FUNNEL_FIELDS: tuple[str, ...] = (
    "position",
    "stage",
    "calls",
    "after_hours_calls",
    "expected_revenue",
    "after_hours_expected_revenue",
)


# --------------------------------------------------------------------------- #
#  After-hours tagging                                                         #
# --------------------------------------------------------------------------- #
def is_after_hours(ts: Any, business_hours: BusinessHoursConfig) -> bool | None:
    """Return whether a single timestamp falls outside business hours.

    ``ts`` is treated as UTC (Retell's convention) and converted into the
    business timezone before the hour/weekday check. A call is after-hours when
    it lands on a non-workday **or** outside ``[start_hour, end_hour)`` — the
    end hour is exclusive.

    Returns ``None`` for a missing/unparseable timestamp (``NaT``/``None``), so an
    undatable call is never miscounted as either in- or after-hours.

    >>> bh = BusinessHoursConfig()  # 08:00–17:00, Mon–Fri, America/Phoenix
    >>> is_after_hours(pd.Timestamp("2026-08-05 15:00", tz="America/Phoenix"), bh)
    False
    >>> is_after_hours(pd.Timestamp("2026-08-05 02:00", tz="America/Phoenix"), bh)
    True
    """
    stamp = pd.Timestamp(ts) if ts is not None else pd.NaT
    if stamp is pd.NaT or pd.isna(stamp):
        return None
    # UTC-localize a naive timestamp; convert an aware one into the business tz.
    stamp = stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp
    local = stamp.tz_convert(business_hours.tz)
    off_day = local.weekday() not in business_hours.workdays
    off_hours = local.hour < business_hours.start_hour or local.hour >= business_hours.end_hour
    return bool(off_day or off_hours)


def _after_hours_series(ts: pd.Series, business_hours: BusinessHoursConfig) -> pd.Series:
    """Vectorized :func:`is_after_hours` over a timestamp column.

    Returns a nullable-boolean Series aligned to ``ts`` (``pd.NA`` where the
    timestamp is missing), so undatable calls stay distinguishable from
    business-hours calls.
    """
    stamps = pd.to_datetime(ts, utc=True, errors="coerce")
    local = stamps.dt.tz_convert(business_hours.tz)
    workdays = list(business_hours.workdays)
    off_day = ~local.dt.weekday.isin(workdays)
    off_hours = (local.dt.hour < business_hours.start_hour) | (
        local.dt.hour >= business_hours.end_hour
    )
    flag = (off_day | off_hours).astype("boolean")
    flag[stamps.isna()] = pd.NA
    return flag


# --------------------------------------------------------------------------- #
#  Stage → funnel position                                                     #
# --------------------------------------------------------------------------- #
def stage_label(stage_id: Any) -> str | None:
    """Extract the human stage name from an Odoo ``stage_id`` value.

    Odoo returns a many2one as a ``[id, "Display Name"]`` pair, or ``False`` when
    unset. Returns the display name, or ``None`` when there isn't one.

    >>> stage_label([3, "Proposition"])
    'Proposition'
    >>> stage_label(False) is None
    True
    """
    if isinstance(stage_id, (list, tuple)) and len(stage_id) >= 2:
        name = stage_id[1]
        return str(name) if name not in (None, False) else None
    if isinstance(stage_id, str) and stage_id:
        return stage_id
    return None


def stage_to_position(label: str | None, conversion: ConversionConfig) -> int | None:
    """Map a stage name onto its ordered funnel position.

    Matching is case-insensitive substring against
    :attr:`ConversionConfig.funnel_stage_order` (e.g. Odoo's ``"Qualified"``
    matches the canonical ``"qualified"``). The first canonical name found in the
    label wins. Returns ``None`` for an unknown/empty stage, so unrecognized
    leads don't get pinned to the bottom of the funnel.

    >>> cfg = ConversionConfig()
    >>> stage_to_position("Qualified", cfg)
    1
    >>> stage_to_position("Won", cfg) == len(cfg.funnel_stage_order) - 1
    True
    >>> stage_to_position("Something else", cfg) is None
    True
    """
    if not label:
        return None
    low = label.lower()
    for position, name in enumerate(conversion.funnel_stage_order):
        if name.lower() in low:
            return position
    return None


def _classify(
    row: Mapping[str, Any], conversion: ConversionConfig
) -> tuple[str | None, int | None, bool, bool]:
    """Return ``(funnel_stage, funnel_position, is_won, is_lost)`` for one lead row.

    * *won* — the lead's probability is at or above
      :attr:`ConversionConfig.won_probability`, or its stage name contains
      ``"won"``.
    * *lost* — the lead is archived (``active is False``) and not won; a lost
      opportunity in Odoo is deactivated with probability 0.
    """
    label = stage_label(row.get("stage_id"))
    position = stage_to_position(label, conversion)
    funnel_stage = (
        conversion.funnel_stage_order[position] if position is not None else None
    )

    probability = _to_float(row.get("probability"))
    won_by_prob = probability is not None and probability >= conversion.won_probability
    won_by_stage = label is not None and "won" in label.lower()
    is_won = bool(won_by_prob or won_by_stage)

    # Equality, not identity: after a left-join ``active`` may be a numpy bool
    # (``np.False_ is False`` is False), so ``is False`` would miss real losses.
    # ``nan == False`` is False, so an unmatched row is never called lost.
    active = row.get("active")
    is_lost = bool((active == False) and not is_won)  # noqa: E712
    return funnel_stage, position, is_won, is_lost


# --------------------------------------------------------------------------- #
#  Join                                                                        #
# --------------------------------------------------------------------------- #
def join_calls_to_leads(calls: pd.DataFrame, leads: pd.DataFrame) -> pd.DataFrame:
    """Left-join each call to its single best-matching lead on the phone key.

    Both sides are keyed on :func:`normalize_phone` (last 10 digits) — calls on
    ``from_number``, leads on ``phone``. When a phone matches several leads the
    **most-recently-touched** one wins (``write_date`` desc); this collapses the
    lead frame to one row per phone before the merge, so every call gets at most
    one lead. Leads with no usable phone key are dropped from the match set (they
    can never join and would otherwise collide on the empty key).

    The result has one row per input call: the call columns plus ``phone_key``
    and every :data:`~retell_sync.odoo.LEAD_FIELDS` column (``NaN``/``None`` for
    unmatched calls). Row order and count follow ``calls``.
    """
    calls = calls.copy()
    calls["phone_key"] = calls["from_number"].map(normalize_phone)

    best = _best_lead_per_phone(leads)
    merged = calls.merge(best, how="left", on="phone_key", suffixes=("", "_lead"))
    return merged


def _best_lead_per_phone(leads: pd.DataFrame) -> pd.DataFrame:
    """Reduce the lead frame to one row per phone key (most recent write_date).

    Returns a frame carrying ``phone_key`` plus every :data:`LEAD_FIELDS` column.
    Leads whose phone normalizes to an empty key are excluded so they can't
    collide with each other on the join.
    """
    cols = ["phone_key", *LEAD_FIELDS]
    if leads.empty:
        return pd.DataFrame(columns=cols)

    work = leads.copy()
    work["phone_key"] = work["phone"].map(normalize_phone)
    work = work[work["phone_key"] != ""]
    if work.empty:
        return pd.DataFrame(columns=cols)

    # Sort most-recently-touched last-wins is error-prone; sort desc and keep
    # first. Parse write_date so string ordering can't bite on odd formats.
    order = pd.to_datetime(work["write_date"], errors="coerce")
    work = work.assign(_order=order).sort_values(
        "_order", ascending=False, kind="stable", na_position="last"
    )
    work = work.drop_duplicates(subset="phone_key", keep="first")
    return work[cols].reset_index(drop=True)


# --------------------------------------------------------------------------- #
#  conversion_by_call                                                          #
# --------------------------------------------------------------------------- #
def build_conversion_by_call(
    calls: pd.DataFrame,
    leads: pd.DataFrame,
    config: AppConfig,
) -> pd.DataFrame:
    """Build the per-call frame: one row per call with join + funnel classification.

    Columns are exactly :data:`BY_CALL_FIELDS`, in order, even for empty input.
    Each row carries the after-hours flag, the matched lead (if any), its funnel
    position, won/lost classification, and a ``weighted_value``
    (``expected_revenue × probability / 100``) — the per-call contribution to the
    weighted pipeline.
    """
    if calls.empty:
        return pd.DataFrame(columns=list(BY_CALL_FIELDS))

    joined = join_calls_to_leads(calls, leads)
    after_hours = _after_hours_series(joined["ts"], config.business_hours)

    records: list[dict[str, Any]] = []
    for pos, (_, row) in enumerate(joined.iterrows()):
        # The lead's primary key arrives under "id" (from LEAD_FIELDS); it is the
        # marker of a successful join.
        matched = pd.notna(row.get("id"))
        funnel_stage, funnel_position, is_won, is_lost = (
            _classify(row, config.conversion) if matched else (None, None, False, False)
        )
        probability = _to_float(row.get("probability")) if matched else None
        revenue = _to_float(row.get("expected_revenue")) if matched else None
        weighted = (
            round(revenue * probability / 100.0, 4)
            if matched and revenue is not None and probability is not None
            else None
        )
        ah = after_hours.iloc[pos]
        records.append(
            {
                "call_id": row.get("call_id"),
                "phone_key": row.get("phone_key"),
                "ts": row.get("ts"),
                "after_hours": None if pd.isna(ah) else bool(ah),
                "duration": row.get("duration"),
                "cost": row.get("cost"),
                "matched": bool(matched),
                "lead_id": _to_int(row.get("id")) if matched else None,
                "lead_name": row.get("name") if matched else None,
                "stage_label": stage_label(row.get("stage_id")) if matched else None,
                "funnel_stage": funnel_stage,
                "funnel_position": funnel_position,
                "probability": probability,
                "expected_revenue": revenue,
                "weighted_value": weighted,
                "is_won": is_won,
                "is_lost": is_lost,
            }
        )

    frame = pd.DataFrame(records, columns=list(BY_CALL_FIELDS))
    # Keep ids/positions as nullable integers (not float-with-NaN) so an
    # unmatched call reads as <NA> and downstream JSON stays integer-clean.
    for col in ("lead_id", "funnel_position"):
        frame[col] = frame[col].astype("Int64")
    return frame


# --------------------------------------------------------------------------- #
#  conversion_funnel                                                           #
# --------------------------------------------------------------------------- #
def build_conversion_funnel(by_call: pd.DataFrame, config: AppConfig) -> pd.DataFrame:
    """Aggregate the per-call frame into an ordered, cumulative funnel.

    One row per stage in :attr:`ConversionConfig.funnel_stage_order`. Counts are
    **cumulative**: a call whose lead reached position *k* is counted at every
    position ``0..k`` (reaching a stage implies passing the earlier ones), so the
    ``calls`` column is monotonically non-increasing down the funnel — the
    classic drop-off view. ``expected_revenue`` sums the matched leads' revenue
    for the calls counted at each level, with an after-hours split alongside.

    Columns are exactly :data:`FUNNEL_FIELDS`, in order.
    """
    order = config.conversion.funnel_stage_order
    rows: list[dict[str, Any]] = []

    positions = (
        pd.to_numeric(by_call["funnel_position"], errors="coerce")
        if not by_call.empty
        else pd.Series(dtype="float64")
    )
    after_hours = (
        by_call["after_hours"].astype("boolean")
        if not by_call.empty
        else pd.Series(dtype="boolean")
    )
    revenue = (
        pd.to_numeric(by_call["expected_revenue"], errors="coerce")
        if not by_call.empty
        else pd.Series(dtype="float64")
    )

    # NA (undatable call) counts as not-after-hours; filling keeps the boolean
    # masks usable for indexing (a mask with NA can't index a frame).
    is_ah = (after_hours == True).fillna(False).to_numpy(dtype=bool)  # noqa: E712

    for position, stage in enumerate(order):
        reached = (positions >= position).to_numpy(dtype=bool)
        ah_reached = reached & is_ah
        rows.append(
            {
                "position": position,
                "stage": stage,
                "calls": int(reached.sum()),
                "after_hours_calls": int(ah_reached.sum()),
                "expected_revenue": round(float(revenue[reached].sum()), 4),
                "after_hours_expected_revenue": round(float(revenue[ah_reached].sum()), 4),
            }
        )

    return pd.DataFrame(rows, columns=list(FUNNEL_FIELDS))


# --------------------------------------------------------------------------- #
#  KPIs                                                                        #
# --------------------------------------------------------------------------- #
def compute_kpis(by_call: pd.DataFrame, config: AppConfig) -> dict[str, Any]:
    """Roll the per-call frame up into the headline KPIs.

    Revenue/pipeline sums dedupe on ``lead_id`` (many calls can hit one lead), so
    a single opportunity's value is never double-counted; call counts are per
    call. Keys:

    * ``total_calls`` / ``after_hours_calls`` / ``business_hours_calls``
    * ``matched_calls`` / ``after_hours_matched_calls``
    * ``won_calls`` / ``after_hours_won_calls`` / ``lost_calls``
    * ``conversion_rate`` — won calls ÷ total calls
    * ``after_hours_conversion_rate`` — after-hours won calls ÷ after-hours calls
    * ``won_revenue`` / ``after_hours_won_revenue`` — expected_revenue of unique
      won leads (all / after-hours-originated)
    * ``dollars_per_after_hours_call`` — after-hours won revenue ÷ after-hours calls
    * ``weighted_pipeline`` / ``after_hours_weighted_pipeline`` —
      Σ expected_revenue × probability over unique matched leads
    """
    total = len(by_call)
    if total == 0:
        return _empty_kpis()

    # Fill NA before use: an undatable call (after_hours NA) counts as neither
    # after- nor business-hours, and a mask carrying NA can't index a frame.
    after_hours = by_call["after_hours"].astype("boolean")
    is_ah = (after_hours == True).fillna(False)  # noqa: E712
    is_bh = (after_hours == False).fillna(False)  # noqa: E712
    matched = by_call["matched"].astype("boolean").fillna(False)
    won = by_call["is_won"].astype("boolean").fillna(False)
    lost = by_call["is_lost"].astype("boolean").fillna(False)

    after_hours_calls = int(is_ah.sum())
    won_calls = int(won.sum())
    ah_won_calls = int((won & is_ah).sum())

    won_revenue = _unique_lead_sum(by_call[won], "expected_revenue")
    ah_won_revenue = _unique_lead_sum(by_call[won & is_ah], "expected_revenue")
    weighted_pipeline = _unique_lead_sum(by_call[matched], "weighted_value")
    ah_weighted_pipeline = _unique_lead_sum(by_call[matched & is_ah], "weighted_value")

    return {
        "total_calls": total,
        "after_hours_calls": after_hours_calls,
        "business_hours_calls": int(is_bh.sum()),
        "matched_calls": int(matched.sum()),
        "after_hours_matched_calls": int((matched & is_ah).sum()),
        "won_calls": won_calls,
        "after_hours_won_calls": ah_won_calls,
        "lost_calls": int(lost.sum()),
        "conversion_rate": round(won_calls / total, 6),
        "after_hours_conversion_rate": (
            round(ah_won_calls / after_hours_calls, 6) if after_hours_calls else 0.0
        ),
        "won_revenue": round(won_revenue, 4),
        "after_hours_won_revenue": round(ah_won_revenue, 4),
        "dollars_per_after_hours_call": (
            round(ah_won_revenue / after_hours_calls, 4) if after_hours_calls else 0.0
        ),
        "weighted_pipeline": round(weighted_pipeline, 4),
        "after_hours_weighted_pipeline": round(ah_weighted_pipeline, 4),
    }


# --------------------------------------------------------------------------- #
#  Bundle                                                                      #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ConversionResult:
    """The full output of :func:`analyze`: the two frames and the KPI mapping."""

    by_call: pd.DataFrame
    funnel: pd.DataFrame
    kpis: dict[str, Any]


def analyze(calls: pd.DataFrame, leads: pd.DataFrame, config: AppConfig) -> ConversionResult:
    """Run the whole join + funnel + KPI pipeline over one call and lead frame.

    A pure transform: given the same frames and config it always yields the same
    result. No IO — writing the frames/JSON is PR 5's concern.
    """
    by_call = build_conversion_by_call(calls, leads, config)
    funnel = build_conversion_funnel(by_call, config)
    kpis = compute_kpis(by_call, config)
    log.info(
        "Conversion: %d call(s), %d after-hours, %d won",
        kpis["total_calls"],
        kpis["after_hours_calls"],
        kpis["won_calls"],
    )
    return ConversionResult(by_call=by_call, funnel=funnel, kpis=kpis)


# --------------------------------------------------------------------------- #
#  Small numeric helpers                                                       #
# --------------------------------------------------------------------------- #
def _to_float(value: Any) -> float | None:
    """Coerce to ``float``; ``None`` for missing/blank/unparseable values."""
    if value is None or value is False or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    return None if pd.isna(result) else result


def _to_int(value: Any) -> int | None:
    """Coerce to ``int``; ``None`` for missing/unparseable values."""
    f = _to_float(value)
    return None if f is None else int(f)


def _unique_lead_sum(frame: pd.DataFrame, column: str) -> float:
    """Sum ``column`` over rows deduped by ``lead_id`` (unmatched rows ignored).

    Prevents a single lead hit by several calls from being counted more than once
    in revenue/pipeline totals. Rows without a ``lead_id`` contribute nothing.
    """
    if frame.empty:
        return 0.0
    sub = frame[frame["lead_id"].notna()].drop_duplicates(subset="lead_id", keep="first")
    values = pd.to_numeric(sub[column], errors="coerce")
    return float(values.sum())


def _empty_kpis() -> dict[str, Any]:
    """The KPI mapping for zero calls — every metric present, all zero."""
    return {
        "total_calls": 0,
        "after_hours_calls": 0,
        "business_hours_calls": 0,
        "matched_calls": 0,
        "after_hours_matched_calls": 0,
        "won_calls": 0,
        "after_hours_won_calls": 0,
        "lost_calls": 0,
        "conversion_rate": 0.0,
        "after_hours_conversion_rate": 0.0,
        "won_revenue": 0.0,
        "after_hours_won_revenue": 0.0,
        "dollars_per_after_hours_call": 0.0,
        "weighted_pipeline": 0.0,
        "after_hours_weighted_pipeline": 0.0,
    }


# Keep a reference to CALL_FIELDS so the intended call-frame schema is documented
# at import and a stale import fails loudly rather than silently.
_ = CALL_FIELDS
