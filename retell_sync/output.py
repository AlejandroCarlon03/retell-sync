#!/usr/bin/env python3
"""
retell_sync.output
==================
The write layer — turns a :class:`~retell_sync.conversion.ConversionResult` into
the three deliverables on disk:

* ``conversion_by_call.csv`` — one row per call (the full per-call frame).
* ``conversion_funnel.csv`` — the ordered, cumulative funnel.
* ``conversion.json`` — a single JSON-safe payload (metadata + KPIs + both
  frames as records) for the dashboard (PR 6) to consume without re-parsing CSV.

Why a dedicated JSON sanitizer
------------------------------
The frames coming out of :mod:`retell_sync.conversion` are pandas objects, so
their cells are **not** plain Python: an integer column is ``numpy.int64``, a
missing number is ``float('nan')`` (or ``pd.NA``), a boolean is ``numpy.bool_``,
and ``ts`` holds :class:`pandas.Timestamp` values. ``json.dumps`` chokes on all
of those (``numpy.int64`` isn't serializable; ``NaN`` produces invalid JSON that
strict parsers — including the browser's ``JSON.parse`` — reject). :func:`_json_safe`
walks the payload and coerces every value to a JSON-native one: ``NaN``/``NaT``/
``pd.NA`` → ``null``, numpy scalars → Python scalars, timestamps → ISO-8601
strings. The result is guaranteed ``NaN``-free and round-trips through any strict
JSON parser.

This module is the only place in the package (besides the CLI cache) that writes
files; the conversion math stays pure in :mod:`retell_sync.conversion`.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import PathsConfig
from .conversion import ConversionResult

log = logging.getLogger("retell_sync.output")

__all__ = [
    "BY_CALL_CSV",
    "FUNNEL_CSV",
    "CONVERSION_JSON",
    "HISTORY_JSON",
    "OutputPaths",
    "append_history",
    "build_history_snapshot",
    "build_links",
    "build_payload",
    "write_outputs",
]

#: Deliverable filenames (written into :attr:`PathsConfig.output_dir`).
BY_CALL_CSV = "conversion_by_call.csv"
FUNNEL_CSV = "conversion_funnel.csv"
CONVERSION_JSON = "conversion.json"
#: Append-only KPI history (one snapshot per UTC calendar date), for the
#: dashboard's cross-run "Trends Over Time" page. Lives beside ``conversion.json``
#: in ``output_dir`` so both the Photino host (``/api/history``) and the static
#: IIS viewer (a sibling ``./history.json``) can read it.
HISTORY_JSON = "history.json"

#: The curated KPI keys carried into each history snapshot — the headline figures
#: a manager tracks over time. Kept small and stable so the file stays lightweight
#: and its shape doesn't churn when the full KPI set grows.
_HISTORY_KPI_KEYS: tuple[str, ...] = (
    "total_calls",
    "after_hours_calls",
    "matched_calls",
    "won_calls",
    "conversion_rate",
    "after_hours_conversion_rate",
    "dollars_per_after_hours_call",
    "won_revenue",
    "weighted_pipeline",
    "after_hours_new_clients",
)


@dataclass(frozen=True)
class OutputPaths:
    """The three files :func:`write_outputs` produced, for the caller to report."""

    by_call_csv: Path
    funnel_csv: Path
    conversion_json: Path

    def as_list(self) -> list[Path]:
        """The three paths in deliverable order."""
        return [self.by_call_csv, self.funnel_csv, self.conversion_json]


# --------------------------------------------------------------------------- #
#  JSON-safety                                                                 #
# --------------------------------------------------------------------------- #
def _json_safe(value: Any) -> Any:
    """Recursively coerce ``value`` into something ``json.dumps`` accepts.

    The contract: the returned structure contains only ``None``, ``bool``,
    ``int``, ``float`` (never ``NaN``/``inf``), ``str``, ``list``, and ``dict``.
    Timestamps become ISO-8601 strings; numpy scalars become Python scalars;
    every flavour of "missing" (``None``, ``NaN``, ``NaT``, ``pd.NA``) becomes
    ``None``.
    """
    if value is None or value is pd.NA or value is pd.NaT:
        return None

    # Containers first, so the scalar `pd.isna` guard below never sees an array
    # (which would make `pd.isna` return an array and the truth test ambiguous).
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, np.ndarray)):
        return [_json_safe(v) for v in value]

    if isinstance(value, (pd.Timestamp, datetime)):
        return pd.Timestamp(value).isoformat()
    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        value = float(value)
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, (bool, int, str)):
        return value

    # A stray scalar (e.g. numpy datetime64, or an object cell): treat a pandas
    # "missing" as null, else fall back to its string form so JSON never breaks.
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return str(value)


def _frame_to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Convert a DataFrame to a list of JSON-safe row dicts (column order kept).

    Extracts each column with :meth:`Series.tolist` (which yields Python objects
    and ``pd.NA`` for nullable/extension dtypes such as ``Int64``) rather than
    ``DataFrame.to_dict``, whose whole-frame numpy coercion raises on a masked
    column with missing values. :func:`_json_safe` then normalizes each cell.
    """
    columns = list(frame.columns)
    col_values = {col: frame[col].tolist() for col in columns}
    return [
        {col: _json_safe(col_values[col][i]) for col in columns}
        for i in range(len(frame))
    ]


# --------------------------------------------------------------------------- #
#  Deep-link templates                                                         #
# --------------------------------------------------------------------------- #
#: Default Retell dashboard host used when no override is supplied. Mirrors
#: :attr:`retell_sync.config.RetellConfig.dashboard_url`.
_DEFAULT_RETELL_DASHBOARD = "https://dashboard.retellai.com"


def build_links(
    *,
    retell_dashboard_url: str | None = _DEFAULT_RETELL_DASHBOARD,
    odoo_web_url: str | None = None,
    retell_call_template: str | None = None,
    odoo_lead_template: str | None = None,
) -> dict[str, str | None]:
    """Build the click-through URL *templates* the dashboard fills per row.

    Each template carries a single ``{call_id}`` / ``{lead_id}`` placeholder the
    frontend substitutes; keeping them as templates (not per-row URLs) avoids
    bloating ``by_call`` with two more string columns and keeps the URL scheme in
    one place.

    * ``retell_call`` — link to a call's transcript in the Retell dashboard.
      Always available (defaults to ``{dashboard_url}/call-history?history={call_id}``).
    * ``odoo_lead`` — link to a lead's form in the Odoo web UI, using the modern
      ``{web_url}/odoo/crm/{lead_id}`` path. ``None`` unless ``odoo_web_url`` is
      configured (we can't guess the customer's Odoo domain), in which case the
      dashboard simply omits the Odoo button.

    A full ``*_template`` (with the matching placeholder) overrides the
    base-URL-derived default — the escape hatch when a dashboard's per-call or
    per-lead path doesn't match the assumed shape.
    """
    if retell_call_template:
        retell_call: str | None = retell_call_template
    else:
        retell_base = (retell_dashboard_url or "").rstrip("/")
        # Retell's dashboard opens a call from its history view via a `history`
        # query param (confirmed against the live dashboard) — not a path segment.
        retell_call = f"{retell_base}/call-history?history={{call_id}}" if retell_base else None

    if odoo_lead_template:
        odoo_lead: str | None = odoo_lead_template
    else:
        odoo_base = (odoo_web_url or "").rstrip("/")
        odoo_lead = f"{odoo_base}/odoo/crm/{{lead_id}}" if odoo_base else None

    return {"retell_call": retell_call, "odoo_lead": odoo_lead}


# --------------------------------------------------------------------------- #
#  Payload                                                                     #
# --------------------------------------------------------------------------- #
def build_payload(
    result: ConversionResult,
    *,
    since: datetime | date | str | None = None,
    generated_at: datetime | None = None,
    links: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Assemble the JSON-safe ``conversion.json`` payload from a result.

    Pure (no IO): the same result and metadata always yield the same dict, so it
    can be asserted on directly in tests. The shape is::

        {
          "generated_at": "<ISO-8601 UTC>",
          "window": {"since": "<ISO-8601 or None>"},
          "links":  {"retell_call": "<template or None>", "odoo_lead": ...},
          "kpis":   { ... },
          "funnel": [ { ...FUNNEL_FIELDS... }, ... ],
          "by_call":[ { ...BY_CALL_FIELDS... }, ... ]
        }

    ``generated_at`` defaults to "now" in UTC; pass it explicitly for a
    deterministic payload. ``links`` defaults to templates with no configured
    bases (Retell default host, no Odoo) — see :func:`build_links`.
    """
    stamp = generated_at or datetime.now(UTC)
    payload = {
        "generated_at": _json_safe(stamp),
        "window": {"since": _json_safe(since)},
        "links": _json_safe(links if links is not None else build_links()),
        "kpis": _json_safe(result.kpis),
        "funnel": _frame_to_records(result.funnel),
        "by_call": _frame_to_records(result.by_call),
    }
    return payload


# --------------------------------------------------------------------------- #
#  KPI history (cross-run trends)                                              #
# --------------------------------------------------------------------------- #
def build_history_snapshot(
    result: ConversionResult,
    *,
    since: datetime | date | str | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Build one JSON-safe history row from a result — the curated headline KPIs.

    Pure (no IO). Shape::

        {"date": "<UTC date>", "generated_at": "<ISO>", "since": "<ISO|None>",
         "kpis": { <_HISTORY_KPI_KEYS> }}

    ``date`` is the UTC calendar date of ``generated_at`` (defaulting to now); it
    is the upsert key in :func:`append_history`, so at most one snapshot lands per
    day no matter how often ``run`` fires.
    """
    stamp = generated_at or datetime.now(UTC)
    ts = pd.Timestamp(stamp)
    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
    kpis = {key: result.kpis.get(key) for key in _HISTORY_KPI_KEYS}
    return _json_safe(
        {
            "date": ts.date().isoformat(),
            "generated_at": stamp,
            "since": since,
            "kpis": kpis,
        }
    )


def _read_history(path: Path) -> list[dict[str, Any]]:
    """Read the existing history array, tolerating a missing or corrupt file.

    A missing file, unreadable path, invalid JSON, or a non-list document all
    yield an empty list — a fresh start — rather than raising, so a hand-mangled
    or truncated ``history.json`` never aborts a nightly run.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(raw, list):
        return []
    return [row for row in raw if isinstance(row, dict)]


def append_history(
    result: ConversionResult,
    paths: PathsConfig,
    *,
    since: datetime | date | str | None = None,
    generated_at: datetime | None = None,
) -> Path:
    """Upsert one snapshot into ``output_dir/history.json`` (one row per UTC date).

    Reads the existing array (recovering cleanly from a missing/corrupt file via
    :func:`_read_history`), drops any row for today's date, appends the new
    snapshot, sorts ascending by date, and rewrites the file. Re-running ``run``
    on the same day therefore *replaces* that day's row rather than duplicating
    it, so the series is one point per day. Returns the file path.
    """
    resolved = paths.ensure()
    path = resolved.output_dir / HISTORY_JSON

    snapshot = build_history_snapshot(result, since=since, generated_at=generated_at)
    history = [row for row in _read_history(path) if row.get("date") != snapshot["date"]]
    history.append(snapshot)
    history.sort(key=lambda row: str(row.get("date") or ""))

    path.write_text(json.dumps(history, indent=2), encoding="utf-8")
    log.info("Appended history snapshot for %s -> %s", snapshot["date"], path.name)
    return path


# --------------------------------------------------------------------------- #
#  Write                                                                       #
# --------------------------------------------------------------------------- #
def write_outputs(
    result: ConversionResult,
    paths: PathsConfig,
    *,
    since: datetime | date | str | None = None,
    generated_at: datetime | None = None,
    links: dict[str, str | None] | None = None,
) -> OutputPaths:
    """Write the three deliverables into ``paths.output_dir`` and return their paths.

    ``paths`` is resolved and its directories created first, so the caller need
    not pre-create anything. The two CSVs are written straight from the frames
    (pandas renders ``NaN`` as an empty cell); ``conversion.json`` is written
    from :func:`build_payload`, so it is guaranteed free of ``NaN``, numpy
    scalars, and raw timestamps.
    """
    resolved = paths.ensure()
    out = resolved.output_dir

    by_call_csv = out / BY_CALL_CSV
    funnel_csv = out / FUNNEL_CSV
    conversion_json = out / CONVERSION_JSON

    result.by_call.to_csv(by_call_csv, index=False)
    result.funnel.to_csv(funnel_csv, index=False)

    payload = build_payload(result, since=since, generated_at=generated_at, links=links)
    conversion_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    log.info(
        "Wrote %s, %s, %s", by_call_csv.name, funnel_csv.name, conversion_json.name
    )
    return OutputPaths(
        by_call_csv=by_call_csv,
        funnel_csv=funnel_csv,
        conversion_json=conversion_json,
    )
