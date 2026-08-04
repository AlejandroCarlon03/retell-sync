#!/usr/bin/env python3
"""
retell_sync.retell
==================
Retell AI read client — pulls call logs for the conversion join.

This is the call side of the analysis; :mod:`retell_sync.odoo` is the lead side.
It talks to Retell's ``POST /v2/list-calls`` endpoint (bearer auth, JSON array
body), walks every page of history in the requested window, and normalizes each
raw call into the flat record the funnel needs::

    call_id, from_number, ts, duration, cost, direction,
    disconnection_reason, sentiment

Design mirrors :mod:`retell_sync.odoo` on purpose (same shape of client, same
injectable ``session``, same "always return a DataFrame with a fixed schema"
guarantee) so the two clients read the same way.

Key behaviours
--------------
* **Pagination.** ``list-calls`` returns at most ``limit`` calls sorted newest
  first; the next page is requested with ``pagination_key`` set to the last
  ``call_id`` seen. We loop until a short (or empty) page comes back, with a
  ``max_pages`` guard so a misbehaving cursor can't spin forever.
* **Dedup on ``call_id``.** Overlapping pages (or re-pulls) can repeat a call;
  :meth:`RetellClient.fetch_calls` keeps the first occurrence of each
  ``call_id``. Normalization is pure, so re-running it on the same raw input is
  idempotent.
* **Units are normalized for humans.** Retell reports timestamps in epoch
  milliseconds and cost in cents; records carry a UTC :class:`pandas.Timestamp`
  and a dollar ``float`` respectively, with duration in whole seconds.

Read-only: this module only ever issues ``list-calls``. It never mutates Retell.

Secrets come from :class:`retell_sync.config.RetellConfig` (env-backed); nothing
is hard-coded here.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime
from typing import Any

import pandas as pd
import requests

from .config import RetellConfig

log = logging.getLogger("retell_sync.retell")

__all__ = [
    "RetellClient",
    "RetellError",
    "normalize_call",
    "calls_to_frame",
    "CALL_FIELDS",
]

#: Columns of the normalized call frame, in order. This is the contract the
#: conversion step (PR 4) joins against; keep it stable.
CALL_FIELDS: tuple[str, ...] = (
    "call_id",
    "from_number",
    "ts",
    "duration",
    "cost",
    "direction",
    "disconnection_reason",
    "sentiment",
)

#: Retell's list endpoint. ``base_url`` comes from config; this is the path.
_LIST_CALLS_PATH = "/v2/list-calls"

#: Hard ceiling on pages walked in one pull, so a stuck cursor can't loop
#: forever. At the default page size of 1000 this is a million calls — orders of
#: magnitude beyond any real window for this after-hours agent.
_MAX_PAGES = 1000


class RetellError(RuntimeError):
    """Raised when a Retell request fails (non-2xx) or returns an unusable body."""


# --------------------------------------------------------------------------- #
#  Field coercion helpers                                                      #
# --------------------------------------------------------------------------- #
def _epoch_ms_to_ts(value: Any) -> pd.Timestamp:
    """Convert an epoch-millisecond value to a UTC :class:`pandas.Timestamp`.

    Returns ``pd.NaT`` for anything missing or unparseable, so a single bad
    call never breaks a whole pull.
    """
    if value is None:
        return pd.NaT
    try:
        return pd.to_datetime(int(value), unit="ms", utc=True)
    except (ValueError, TypeError, OverflowError):
        return pd.NaT


def _duration_seconds(call: Mapping[str, Any]) -> float:
    """Best-effort call duration in whole seconds.

    Prefers Retell's ``duration_ms`` when present, else derives it from the
    start/end timestamps. Missing data yields ``NaN`` rather than 0 so absent
    durations don't masquerade as instantaneous calls.
    """
    duration_ms = call.get("duration_ms")
    if duration_ms is None:
        start, end = call.get("start_timestamp"), call.get("end_timestamp")
        if start is not None and end is not None:
            try:
                duration_ms = int(end) - int(start)
            except (ValueError, TypeError):
                duration_ms = None
    if duration_ms is None:
        return float("nan")
    try:
        return round(int(duration_ms) / 1000.0, 3)
    except (ValueError, TypeError):
        return float("nan")


def _cost_dollars(call: Mapping[str, Any]) -> float:
    """Combined call cost in dollars.

    Retell reports ``call_cost.combined_cost`` in **cents**; convert to dollars.
    Missing cost yields ``NaN``.
    """
    call_cost = call.get("call_cost")
    if not isinstance(call_cost, Mapping):
        return float("nan")
    cents = call_cost.get("combined_cost")
    if cents is None:
        return float("nan")
    try:
        return round(float(cents) / 100.0, 4)
    except (ValueError, TypeError):
        return float("nan")


def _sentiment(call: Mapping[str, Any]) -> Any:
    """Pull user sentiment out of the nested ``call_analysis`` block, if any."""
    analysis = call.get("call_analysis")
    if isinstance(analysis, Mapping):
        return analysis.get("user_sentiment")
    return None


# --------------------------------------------------------------------------- #
#  Normalization                                                               #
# --------------------------------------------------------------------------- #
def normalize_call(call: Mapping[str, Any]) -> dict[str, Any]:
    """Map one raw Retell call object to a flat :data:`CALL_FIELDS` record.

    Pure and total: it never raises on a missing or oddly-typed field (unknown
    values become ``None``/``NaN``/``NaT``), so a single malformed call can't
    abort a pull. Running it twice on the same input gives the same output.

    >>> rec = normalize_call({
    ...     "call_id": "abc",
    ...     "from_number": "+1 (480) 555-1234",
    ...     "start_timestamp": 1_753_000_000_000,
    ...     "duration_ms": 42_000,
    ...     "call_cost": {"combined_cost": 275},
    ...     "direction": "inbound",
    ...     "disconnection_reason": "user_hangup",
    ...     "call_analysis": {"user_sentiment": "Positive"},
    ... })
    >>> rec["duration"], rec["cost"], rec["sentiment"]
    (42.0, 2.75, 'Positive')
    """
    return {
        "call_id": call.get("call_id"),
        "from_number": call.get("from_number"),
        "ts": _epoch_ms_to_ts(call.get("start_timestamp")),
        "duration": _duration_seconds(call),
        "cost": _cost_dollars(call),
        "direction": call.get("direction"),
        "disconnection_reason": call.get("disconnection_reason"),
        "sentiment": _sentiment(call),
    }


def calls_to_frame(calls: Iterable[Mapping[str, Any]], *, dedup: bool = True) -> pd.DataFrame:
    """Normalize raw calls into a DataFrame with the fixed :data:`CALL_FIELDS` schema.

    The frame always has exactly :data:`CALL_FIELDS` as its columns, in order,
    even when ``calls`` is empty. When ``dedup`` is set (the default), repeated
    ``call_id`` values keep their **first** occurrence — because pages come back
    newest-first, that is the most complete/most recent copy. Rows with no
    ``call_id`` are never dropped (nothing to dedup on).
    """
    records = [normalize_call(c) for c in calls]
    frame = pd.DataFrame(records, columns=list(CALL_FIELDS))
    if dedup and not frame.empty:
        has_id = frame["call_id"].notna()
        deduped_ids = frame[has_id].drop_duplicates(subset="call_id", keep="first")
        frame = pd.concat([deduped_ids, frame[~has_id]]).sort_index()
    return frame.reset_index(drop=True)


# --------------------------------------------------------------------------- #
#  Client                                                                      #
# --------------------------------------------------------------------------- #
def _to_epoch_ms(since: datetime | date | str | int | float | None) -> int | None:
    """Coerce a ``since`` value into epoch milliseconds for the filter, or None."""
    if since is None:
        return None
    if isinstance(since, bool):  # guard: bool is an int subclass
        raise TypeError("since must not be a bool")
    if isinstance(since, (int, float)):
        return int(since)
    if isinstance(since, str):
        since = datetime.fromisoformat(since)
    if isinstance(since, datetime):
        if since.tzinfo is None:
            since = since.replace(tzinfo=UTC)
        return int(since.timestamp() * 1000)
    if isinstance(since, date):
        dt = datetime(since.year, since.month, since.day, tzinfo=UTC)
        return int(dt.timestamp() * 1000)
    raise TypeError(
        f"since must be datetime, date, ISO str, epoch ms, or None; got {type(since)!r}"
    )


class RetellClient:
    """Thin, read-only client over Retell's ``/v2/list-calls`` endpoint.

    Parameters
    ----------
    config:
        Retell connection config. Its API key is validated
        (:meth:`RetellConfig.require`) on construction, so a client always has a
        usable key.
    session:
        Optional :class:`requests.Session` (injected in tests). A fresh session
        is created if omitted.
    timeout:
        Per-request timeout in seconds.
    """

    def __init__(
        self,
        config: RetellConfig,
        *,
        session: requests.Session | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._config = config.require()
        self._base_url = str(self._config.base_url).rstrip("/")
        self._session = session or requests.Session()
        self._timeout = timeout

    # -- low-level -------------------------------------------------------- #
    def _post(self, path: str, payload: Mapping[str, Any]) -> Any:
        """POST ``payload`` to ``{base}/{path}`` and return the parsed JSON body.

        Bearer auth, raise :class:`RetellError` on non-2xx with the response
        text, and unwrap a ``{"result"/"calls"/"data": [...]}`` envelope if the
        API (or a proxy) wraps the list.
        """
        url = f"{self._base_url}/{path.lstrip('/')}"
        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = self._session.post(
                url, json=dict(payload), headers=headers, timeout=self._timeout
            )
        except requests.RequestException as exc:  # network-level failure
            raise RetellError(f"Retell {path} request failed: {exc}") from exc

        if not resp.ok:
            body = (resp.text or "")[:500]
            raise RetellError(f"Retell {path} {resp.status_code}: {body}")

        try:
            data = resp.json()
        except ValueError as exc:
            raise RetellError(f"Retell {path} returned non-JSON body: {resp.text[:200]!r}") from exc

        return _unwrap_calls(data)

    def list_calls_page(
        self,
        *,
        limit: int,
        pagination_key: str | None = None,
        since_ms: int | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch a single page of raw call objects (newest first).

        Exposed separately from :meth:`iter_calls` so the request/envelope
        handling is unit-testable without driving the whole pagination loop.
        """
        payload: dict[str, Any] = {"limit": limit, "sort_order": "descending"}
        if pagination_key is not None:
            payload["pagination_key"] = pagination_key
        if since_ms is not None:
            payload["filter_criteria"] = {"start_timestamp": {"lower_threshold": since_ms}}

        page = self._post(_LIST_CALLS_PATH, payload)
        if not isinstance(page, list):
            return []
        return page

    def iter_calls(
        self,
        since: datetime | date | str | int | float | None = None,
        *,
        page_size: int | None = None,
        max_pages: int = _MAX_PAGES,
    ) -> list[dict[str, Any]]:
        """Walk every page of calls since ``since`` and return the raw objects.

        Pages are requested newest-first; the cursor is the last ``call_id`` of
        the previous page. Stops when a page comes back smaller than the page
        size (the last page) or when ``max_pages`` is hit. Returns raw dicts —
        deduping and normalization happen in :meth:`fetch_calls`.
        """
        limit = page_size or self._config.page_size
        since_ms = _to_epoch_ms(since)
        cursor: str | None = None
        collected: list[dict[str, Any]] = []

        for page_no in range(1, max_pages + 1):
            page = self.list_calls_page(limit=limit, pagination_key=cursor, since_ms=since_ms)
            collected.extend(page)
            log.debug("Retell page %d: %d call(s)", page_no, len(page))
            if len(page) < limit:
                break  # short page => no more history
            next_cursor = page[-1].get("call_id")
            if not next_cursor or next_cursor == cursor:
                # No usable cursor to advance; stop rather than loop forever.
                break
            cursor = next_cursor
        else:
            log.warning("Retell pagination hit max_pages=%d; results may be truncated", max_pages)

        log.info("Fetched %d raw Retell call(s) since %s", len(collected), since)
        return collected

    def fetch_calls(
        self,
        since: datetime | date | str | int | float | None = None,
        *,
        page_size: int | None = None,
    ) -> pd.DataFrame:
        """Pull, dedup, and normalize calls since ``since`` into a DataFrame.

        Returns a frame whose columns are exactly :data:`CALL_FIELDS`, in order,
        even when nothing matches (empty frame with the right schema). Duplicate
        ``call_id`` values across overlapping pages are collapsed to one row.
        """
        raw = self.iter_calls(since, page_size=page_size)
        return calls_to_frame(raw, dedup=True)


# --------------------------------------------------------------------------- #
#  Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _unwrap_calls(data: Any) -> Any:
    """Return the call list from whatever envelope Retell/its proxy used.

    Retell's documented response is a bare JSON array, but tolerate the common
    ``{"calls": [...]}`` / ``{"result": [...]}`` / ``{"data": [...]}`` wrappers
    so a proxy in front of the API doesn't silently zero out a pull.
    """
    if isinstance(data, Mapping):
        for key in ("calls", "result", "data"):
            if key in data:
                return data[key]
    return data
