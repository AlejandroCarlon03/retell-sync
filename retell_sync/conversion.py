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
    "classify_stage",
    "compute_kpis",
    "is_after_hours",
    "join_calls_to_leads",
    "sales_rep_name",
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
    "lead_created",
    "new_after_hours_client",
    "stage_label",
    "sales_rep",
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

    When ``business_hours.all_calls_after_hours`` is set (the default for the
    Retell after-hours line), every call is after-hours regardless of clock time —
    including undatable ones — so this returns ``True`` without inspecting ``ts``.

    >>> bh = BusinessHoursConfig(all_calls_after_hours=False)  # clock-based
    >>> is_after_hours(pd.Timestamp("2026-08-05 15:00", tz="America/Phoenix"), bh)
    False
    >>> is_after_hours(pd.Timestamp("2026-08-05 02:00", tz="America/Phoenix"), bh)
    True
    >>> is_after_hours(pd.Timestamp("2026-08-05 15:00"), BusinessHoursConfig())
    True
    """
    if business_hours.all_calls_after_hours:
        return True
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

    When ``business_hours.all_calls_after_hours`` is set (the default), every call
    is after-hours regardless of clock time, so this returns an all-``True`` Series
    aligned to ``ts`` — even rows with a missing timestamp.
    """
    if business_hours.all_calls_after_hours:
        return pd.Series(True, index=ts.index, dtype="boolean")
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


def sales_rep_name(user_id: Any) -> str | None:
    """Extract the salesperson's name from an Odoo ``user_id`` value.

    Odoo returns the assigned user as a ``[id, "Display Name"]`` many2one pair,
    or ``False`` when the lead has no salesperson. Returns the display name, or
    ``None`` when there isn't one — the dashboard renders that as an em dash.

    >>> sales_rep_name([7, "Jane Doe"])
    'Jane Doe'
    >>> sales_rep_name(False) is None
    True
    """
    if isinstance(user_id, (list, tuple)) and len(user_id) >= 2:
        name = user_id[1]
        return str(name) if name not in (None, False) else None
    if isinstance(user_id, str) and user_id:
        return user_id
    return None


def classify_stage(label: str | None, conversion: ConversionConfig) -> str | None:
    """Map a raw Odoo stage name onto a canonical category via ``stage_rules``.

    Returns ``"won"`` / ``"lost"`` / a :attr:`~ConversionConfig.funnel_stage_order`
    name, or ``None`` when no rule matches. Matching is case-insensitive substring,
    first rule wins (see :attr:`ConversionConfig.stage_rules`).

    >>> cfg = ConversionConfig()
    >>> classify_stage("Finalized - Submitted Order", cfg)
    'won'
    >>> classify_stage("Lead Called - Bad Lead", cfg)
    'lost'
    >>> classify_stage("Quoted Customer", cfg)
    'proposition'
    >>> classify_stage("Random Stage", cfg) is None
    True
    """
    if not label:
        return None
    low = label.lower()
    for substring, category in conversion.stage_rules:
        if substring in low:
            return category
    return None


def stage_to_position(label: str | None, conversion: ConversionConfig) -> int | None:
    """Map a stage name onto its ordered funnel position.

    Classifies the stage via :func:`classify_stage`, then returns that category's
    index in :attr:`ConversionConfig.funnel_stage_order`. Returns ``None`` when the
    stage is unknown or terminal-lost (``"lost"`` lives off the funnel), so
    unrecognized/dead leads don't get pinned onto it.

    >>> cfg = ConversionConfig()
    >>> stage_to_position("Qualified", cfg)
    1
    >>> stage_to_position("Won", cfg) == len(cfg.funnel_stage_order) - 1
    True
    >>> stage_to_position("Something else", cfg) is None
    True
    """
    category = classify_stage(label, conversion)
    if category is None or category not in conversion.funnel_stage_order:
        return None
    return conversion.funnel_stage_order.index(category)


def _classify(
    row: Mapping[str, Any], conversion: ConversionConfig
) -> tuple[str | None, int | None, bool, bool]:
    """Return ``(funnel_stage, funnel_position, is_won, is_lost)`` for one lead row.

    Classification is driven entirely by the stage name (via
    :func:`classify_stage`), not probability — this CRM sets high win
    probabilities on dead leads, so probability is not a usable success signal.

    * *won* — the stage maps to the ``"won"`` category (e.g. "Finalized -
      Submitted Order", "Completed", or a literal "Won").
    * *lost* — the stage maps to ``"lost"`` (e.g. "Bad Lead", "Junk", "Lost"),
      **or** the lead is archived (``active is False``) and not won — Odoo
      deactivates a lost opportunity.
    """
    label = stage_label(row.get("stage_id"))
    category = classify_stage(label, conversion)

    position = (
        conversion.funnel_stage_order.index(category)
        if category is not None and category in conversion.funnel_stage_order
        else None
    )
    funnel_stage = (
        conversion.funnel_stage_order[position] if position is not None else None
    )

    is_won = category == "won"

    # Equality, not identity: after a left-join ``active`` may be a numpy bool
    # (``np.False_ is False`` is False), so ``is False`` would miss real losses.
    # ``nan == False`` is False, so an unmatched row is never called lost.
    active = row.get("active")
    is_lost = bool(category == "lost" or ((active == False) and not is_won))  # noqa: E712
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
                "lead_created": row.get("create_date") if matched else None,
                # Filled in after the frame is built (needs the whole frame to
                # find each caller's first after-hours contact).
                "new_after_hours_client": False,
                "stage_label": stage_label(row.get("stage_id")) if matched else None,
                "sales_rep": sales_rep_name(row.get("user_id")) if matched else None,
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
    frame["new_after_hours_client"] = _new_after_hours_flags(
        frame, config.conversion.new_client_grace_hours
    )
    return frame


def _new_after_hours_flags(by_call: pd.DataFrame, grace_hours: float) -> pd.Series:
    """Flag each after-hours call whose caller is *new because of it*.

    A caller (deduped by phone) is "new from after-hours" when their matched
    lead's ``create_date`` is no earlier than their **first** after-hours call
    minus ``grace_hours`` — the lead did not exist before they rang the
    after-hours line, so that call is what brought them into the CRM. An existing
    client, whose lead predates the call, is not flagged.

    The decision is made per caller (using their earliest after-hours contact, so
    a later repeat call can't demote them to "existing") and then broadcast back
    to every after-hours, matched row for that caller. Returns a plain-``bool``
    Series aligned to ``by_call``; non-after-hours, unmatched, and undatable rows
    are ``False``.
    """
    result = pd.Series(False, index=by_call.index, dtype=bool)
    if by_call.empty:
        return result

    after_hours = by_call["after_hours"].astype("boolean").fillna(False)
    matched = by_call["matched"].astype("boolean").fillna(False)
    keys = by_call["phone_key"].astype("string").fillna("")
    call_ts = pd.to_datetime(by_call["ts"], utc=True, errors="coerce")
    created = pd.to_datetime(by_call["lead_created"], utc=True, errors="coerce")

    eligible = (
        after_hours.to_numpy(dtype=bool)
        & matched.to_numpy(dtype=bool)
        & (keys.str.len() > 0).to_numpy(dtype=bool)
        & call_ts.notna().to_numpy(dtype=bool)
        & created.notna().to_numpy(dtype=bool)
    )
    if not eligible.any():
        return result

    work = pd.DataFrame(
        {"key": keys[eligible], "call_ts": call_ts[eligible], "created": created[eligible]}
    )
    grace = pd.Timedelta(hours=grace_hours)
    # Earliest after-hours contact per caller; the best-lead-per-phone join means
    # `created` is constant within a key, so this comparison is stable per caller.
    earliest = work.groupby("key")["call_ts"].transform("min")
    is_new = work["created"] >= (earliest - grace)
    new_keys = set(work.loc[is_new, "key"])

    result.loc[eligible] = keys[eligible].isin(new_keys).to_numpy(dtype=bool)
    return result


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
        # An unmatched call has a <NA> funnel_position; the comparison yields a
        # nullable boolean, so fill NA (didn't reach this stage) before making a
        # plain bool mask — the same treatment `is_ah` above gets.
        reached = (positions >= position).fillna(False).to_numpy(dtype=bool)
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
    * ``unique_callers`` / ``known_callers`` — distinct callers (by phone) and how
      many of them are already in the CRM; ``after_hours_*`` variants alongside
    * ``after_hours_new_clients`` — distinct callers who were *not* in the CRM
      before their after-hours call and became a lead because of it (see
      :func:`_new_after_hours_flags`); with the money they brought in:
      ``after_hours_new_client_won_deals`` (distinct won leads),
      ``after_hours_new_client_won_revenue`` (their won expected_revenue), and
      ``after_hours_new_client_pipeline`` (their still-open weighted value)
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

    # Distinct *people*, not calls: one caller can ring several times. Count on the
    # phone key (empty keys are undialable/unknown and never count as a person).
    unique_callers = _unique_caller_count(by_call)
    known_callers = _unique_caller_count(by_call[matched])
    ah_unique_callers = _unique_caller_count(by_call[is_ah])
    ah_known_callers = _unique_caller_count(by_call[is_ah & matched])

    won_revenue = _unique_lead_sum(by_call[won], "expected_revenue")
    ah_won_revenue = _unique_lead_sum(by_call[won & is_ah], "expected_revenue")
    weighted_pipeline = _unique_lead_sum(by_call[matched], "weighted_value")
    ah_weighted_pipeline = _unique_lead_sum(by_call[matched & is_ah], "weighted_value")

    # New clients acquired *because of* an after-hours call (stranger → lead).
    new_client = by_call["new_after_hours_client"].astype("boolean").fillna(False)
    ah_new_clients = _unique_caller_count(by_call[new_client])
    ah_new_won = by_call[new_client & won]
    ah_new_won_revenue = _unique_lead_sum(ah_new_won, "expected_revenue")
    ah_new_won_deals = _unique_lead_count(ah_new_won)
    ah_new_pipeline = _unique_lead_sum(by_call[new_client], "weighted_value")

    return {
        "total_calls": total,
        "after_hours_calls": after_hours_calls,
        "business_hours_calls": int(is_bh.sum()),
        "matched_calls": int(matched.sum()),
        "after_hours_matched_calls": int((matched & is_ah).sum()),
        "unique_callers": unique_callers,
        "known_callers": known_callers,
        "after_hours_unique_callers": ah_unique_callers,
        "after_hours_known_callers": ah_known_callers,
        "after_hours_new_clients": ah_new_clients,
        "after_hours_new_client_won_deals": ah_new_won_deals,
        "after_hours_new_client_won_revenue": round(ah_new_won_revenue, 4),
        "after_hours_new_client_pipeline": round(ah_new_pipeline, 4),
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


def _unique_caller_count(frame: pd.DataFrame) -> int:
    """Count distinct callers in ``frame`` by their ``phone_key``.

    Callers are people, not calls: a phone that rang three times is one caller.
    Rows with a missing/empty phone key contribute nothing (there is no person to
    count), so this never inflates the count with unknown numbers.
    """
    if frame.empty:
        return 0
    keys = frame["phone_key"].dropna()
    keys = keys[keys.astype(str).str.len() > 0]
    return int(keys.nunique())


def _unique_lead_count(frame: pd.DataFrame) -> int:
    """Count distinct leads in ``frame`` by ``lead_id`` (unmatched rows ignored).

    Several calls can land on one lead; this counts the *opportunity* once. Rows
    without a ``lead_id`` contribute nothing.
    """
    if frame.empty:
        return 0
    return int(frame["lead_id"].dropna().nunique())


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
        "unique_callers": 0,
        "known_callers": 0,
        "after_hours_unique_callers": 0,
        "after_hours_known_callers": 0,
        "after_hours_new_clients": 0,
        "after_hours_new_client_won_deals": 0,
        "after_hours_new_client_won_revenue": 0.0,
        "after_hours_new_client_pipeline": 0.0,
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
