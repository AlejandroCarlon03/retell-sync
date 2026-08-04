"""
Tests for :mod:`retell_sync.output` — the write layer.

Two concerns:

* **JSON-safety.** The payload built from the pandas frames must survive a strict
  ``json.dumps``/``json.loads`` round-trip: no ``NaN``, no numpy scalars, no raw
  timestamps. This is the property the dashboard (PR 6) depends on — a browser's
  ``JSON.parse`` rejects bare ``NaN``.
* **The three files.** :func:`write_outputs` writes exactly the three
  deliverables, into ``output_dir``, with the right frame contents.

Everything here is synthetic — no HTTP, no live clock (``generated_at`` is pinned
so the payload is deterministic).
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from retell_sync.config import AppConfig, PathsConfig
from retell_sync.conversion import BY_CALL_FIELDS, FUNNEL_FIELDS, analyze
from retell_sync.odoo import LEAD_FIELDS
from retell_sync.output import (
    BY_CALL_CSV,
    CONVERSION_JSON,
    FUNNEL_CSV,
    _json_safe,
    build_links,
    build_payload,
    write_outputs,
)
from retell_sync.retell import CALL_FIELDS

CFG = AppConfig()
PINNED = datetime(2026, 8, 4, 12, 0, 0, tzinfo=UTC)


# --------------------------------------------------------------------------- #
#  Synthetic frame builders (mirrors test_conversion)                         #
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


def _utc_for_phoenix(year, month, day, hour):
    local = pd.Timestamp(year=year, month=month, day=day, hour=hour, tz="America/Phoenix")
    return local.tz_convert("UTC")


def _sample_result():
    """A result with a match, a miss, an undatable call, and revenue — a bit of
    everything the sanitizer has to handle (NaN cost, NaT ts, <NA> lead_id)."""
    calls = _calls([
        _call("c1", "4805550001", _utc_for_phoenix(2026, 8, 5, 20)),        # AH, won
        _call("c2", "4805559999", _utc_for_phoenix(2026, 8, 5, 10)),        # BH, no lead
        _call("c3", "4805550001", None, cost=float("nan")),                 # undatable, NaN cost
    ])
    leads = _leads([_lead(1, "4805550001", "Won", probability=100.0, revenue=5000.0)])
    return analyze(calls, leads, CFG)


# --------------------------------------------------------------------------- #
#  _json_safe scalars                                                         #
# --------------------------------------------------------------------------- #
def test_json_safe_missing_becomes_none():
    assert _json_safe(None) is None
    assert _json_safe(float("nan")) is None
    assert _json_safe(pd.NaT) is None
    assert _json_safe(pd.NA) is None
    assert _json_safe(np.nan) is None


def test_json_safe_numpy_scalars_become_python():
    assert _json_safe(np.int64(5)) == 5 and isinstance(_json_safe(np.int64(5)), int)
    assert _json_safe(np.float64(2.5)) == 2.5 and isinstance(_json_safe(np.float64(2.5)), float)
    assert _json_safe(np.bool_(True)) is True and isinstance(_json_safe(np.bool_(True)), bool)


def test_json_safe_timestamp_becomes_iso_string():
    out = _json_safe(pd.Timestamp("2026-08-05 20:00", tz="UTC"))
    assert isinstance(out, str) and out.startswith("2026-08-05T20:00:00")


def test_json_safe_inf_becomes_none():
    assert _json_safe(math.inf) is None
    assert _json_safe(-math.inf) is None


def test_json_safe_recurses_containers():
    out = _json_safe({"a": [np.int64(1), float("nan")], "b": (pd.NA, "x")})
    assert out == {"a": [1, None], "b": [None, "x"]}


def test_json_safe_handles_numpy_array():
    assert _json_safe(np.array([1, 2, 3])) == [1, 2, 3]


# --------------------------------------------------------------------------- #
#  build_payload                                                              #
# --------------------------------------------------------------------------- #
def test_payload_is_strict_json_round_trippable():
    payload = build_payload(_sample_result(), since=PINNED, generated_at=PINNED)
    # allow_nan=False makes json.dumps raise on any NaN/inf that slipped through.
    text = json.dumps(payload, allow_nan=False)
    assert "NaN" not in text
    reparsed = json.loads(text)
    assert reparsed["kpis"]["total_calls"] == 3


def test_payload_shape_and_metadata():
    payload = build_payload(_sample_result(), since=PINNED, generated_at=PINNED)
    assert set(payload) == {"generated_at", "window", "links", "kpis", "funnel", "by_call"}
    assert payload["generated_at"].startswith("2026-08-04T12:00:00")
    assert payload["window"]["since"].startswith("2026-08-04T12:00:00")
    assert len(payload["by_call"]) == 3
    assert [r["stage"] for r in payload["funnel"]] == list(CFG.conversion.funnel_stage_order)


def test_build_links_templates():
    # No bases → Retell defaults to the public host, Odoo omitted.
    default = build_links()
    assert default["retell_call"] == "https://dashboard.retellai.com/calls/{call_id}"
    assert default["odoo_lead"] is None

    # Configured bases → both templates, trailing slashes trimmed.
    both = build_links(
        retell_dashboard_url="https://dash.example.com/",
        odoo_web_url="https://acme.odoo.com/",
    )
    assert both["retell_call"] == "https://dash.example.com/calls/{call_id}"
    assert both["odoo_lead"] == (
        "https://acme.odoo.com/web#id={lead_id}&model=crm.lead&view_type=form"
    )


def test_payload_carries_links():
    payload = build_payload(
        _sample_result(),
        since=PINNED,
        generated_at=PINNED,
        links=build_links(odoo_web_url="https://acme.odoo.com"),
    )
    assert "{call_id}" in payload["links"]["retell_call"]
    assert "{lead_id}" in payload["links"]["odoo_lead"]


def test_payload_records_keep_field_order_and_nulls():
    payload = build_payload(_sample_result(), since=None, generated_at=PINNED)
    assert payload["window"]["since"] is None
    assert list(payload["by_call"][0]) == list(BY_CALL_FIELDS)
    assert list(payload["funnel"][0]) == list(FUNNEL_FIELDS)
    # The undatable, unmatched-lead call has null ts / lead_id / after_hours.
    undatable = next(r for r in payload["by_call"] if r["ts"] is None)
    assert undatable["after_hours"] is None


# --------------------------------------------------------------------------- #
#  write_outputs                                                              #
# --------------------------------------------------------------------------- #
def test_write_outputs_creates_three_files(tmp_path):
    paths = PathsConfig(root=tmp_path)
    written = write_outputs(_sample_result(), paths, since=PINNED, generated_at=PINNED)

    out_dir = tmp_path / "outputs"
    assert (out_dir / BY_CALL_CSV).is_file()
    assert (out_dir / FUNNEL_CSV).is_file()
    assert (out_dir / CONVERSION_JSON).is_file()
    assert written.as_list() == [
        out_dir / BY_CALL_CSV,
        out_dir / FUNNEL_CSV,
        out_dir / CONVERSION_JSON,
    ]


def test_written_json_is_valid_and_nan_free(tmp_path):
    paths = PathsConfig(root=tmp_path)
    written = write_outputs(_sample_result(), paths, since=PINNED, generated_at=PINNED)
    text = written.conversion_json.read_text(encoding="utf-8")
    assert "NaN" not in text
    data = json.loads(text)  # strict parse rejects NaN
    assert data["kpis"]["after_hours_won_revenue"] == 5000.0


def test_written_csvs_have_headers_and_rows(tmp_path):
    paths = PathsConfig(root=tmp_path)
    written = write_outputs(_sample_result(), paths, since=PINNED, generated_at=PINNED)

    by_call = pd.read_csv(written.by_call_csv)
    assert list(by_call.columns) == list(BY_CALL_FIELDS)
    assert len(by_call) == 3

    funnel = pd.read_csv(written.funnel_csv)
    assert list(funnel.columns) == list(FUNNEL_FIELDS)
    assert list(funnel["stage"]) == list(CFG.conversion.funnel_stage_order)
