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
    "OutputPaths",
    "build_payload",
    "write_outputs",
]

#: Deliverable filenames (written into :attr:`PathsConfig.output_dir`).
BY_CALL_CSV = "conversion_by_call.csv"
FUNNEL_CSV = "conversion_funnel.csv"
CONVERSION_JSON = "conversion.json"


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
#  Payload                                                                     #
# --------------------------------------------------------------------------- #
def build_payload(
    result: ConversionResult,
    *,
    since: datetime | date | str | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble the JSON-safe ``conversion.json`` payload from a result.

    Pure (no IO): the same result and metadata always yield the same dict, so it
    can be asserted on directly in tests. The shape is::

        {
          "generated_at": "<ISO-8601 UTC>",
          "window": {"since": "<ISO-8601 or None>"},
          "kpis":   { ... },
          "funnel": [ { ...FUNNEL_FIELDS... }, ... ],
          "by_call":[ { ...BY_CALL_FIELDS... }, ... ]
        }

    ``generated_at`` defaults to "now" in UTC; pass it explicitly for a
    deterministic payload.
    """
    stamp = generated_at or datetime.now(UTC)
    payload = {
        "generated_at": _json_safe(stamp),
        "window": {"since": _json_safe(since)},
        "kpis": _json_safe(result.kpis),
        "funnel": _frame_to_records(result.funnel),
        "by_call": _frame_to_records(result.by_call),
    }
    return payload


# --------------------------------------------------------------------------- #
#  Write                                                                       #
# --------------------------------------------------------------------------- #
def write_outputs(
    result: ConversionResult,
    paths: PathsConfig,
    *,
    since: datetime | date | str | None = None,
    generated_at: datetime | None = None,
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

    payload = build_payload(result, since=since, generated_at=generated_at)
    conversion_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    log.info(
        "Wrote %s, %s, %s", by_call_csv.name, funnel_csv.name, conversion_json.name
    )
    return OutputPaths(
        by_call_csv=by_call_csv,
        funnel_csv=funnel_csv,
        conversion_json=conversion_json,
    )
