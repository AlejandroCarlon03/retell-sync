"""
Tests for :mod:`retell_sync.sendlog` — the persisted email send-log.

:func:`build_record` is pure and asserted directly; :func:`append_record` and
:func:`record_send` touch only ``tmp_path``, so no network or Graph is involved.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from retell_sync.config import PathsConfig
from retell_sync.sendlog import (
    EMAIL_LOG_FILENAME,
    append_record,
    build_record,
    record_send,
)


# --------------------------------------------------------------------------- #
#  build_record (pure)                                                         #
# --------------------------------------------------------------------------- #
def test_build_record_shape_is_json_safe():
    at = datetime(2026, 8, 11, 15, 30, tzinfo=UTC)
    rec = build_record(
        kind="per_rep",
        rep="Jane Doe",
        recipients=["jane@dkbinc.co"],
        subject="Your 2 after-hours callers overdue past 48h",
        lead_count=2,
        html="<div>body</div>",
        sent_at=at,
    )
    # Round-trips through strict JSON (no NaN, no non-native types).
    assert json.loads(json.dumps(rec)) == rec
    assert rec["sent_at"] == "2026-08-11T15:30:00+00:00"
    assert rec["kind"] == "per_rep"
    assert rec["rep"] == "Jane Doe"
    assert rec["recipients"] == ["jane@dkbinc.co"]
    assert rec["lead_count"] == 2
    assert rec["html"] == "<div>body</div>"


def test_build_record_blank_rep_becomes_none():
    rec = build_record(
        kind="manager", rep=None, recipients=("a@x.co",), subject="s", lead_count=1, html="h"
    )
    assert rec["rep"] is None
    assert rec["recipients"] == ["a@x.co"]  # tuple coerced to list


def test_build_record_defaults_sent_at_to_now():
    before = datetime.now(UTC)
    rec = build_record(kind="manager", recipients=[], subject="s", lead_count=0, html="h")
    parsed = datetime.fromisoformat(rec["sent_at"])
    assert parsed >= before


# --------------------------------------------------------------------------- #
#  append_record (IO)                                                          #
# --------------------------------------------------------------------------- #
def test_append_creates_and_grows_the_array(tmp_path):
    out = tmp_path / "outputs"
    r1 = build_record(kind="manager", recipients=["a@x.co"], subject="one", lead_count=1, html="h1")
    r2 = build_record(kind="manager", recipients=["b@x.co"], subject="two", lead_count=2, html="h2")

    path = append_record(out, r1)
    append_record(out, r2)

    assert path == out / EMAIL_LOG_FILENAME
    records = json.loads(path.read_text(encoding="utf-8"))
    assert [r["subject"] for r in records] == ["one", "two"]  # append order kept


def test_append_caps_to_newest_n(tmp_path):
    out = tmp_path / "outputs"
    for i in range(5):
        append_record(
            out,
            build_record(kind="manager", recipients=[], subject=f"s{i}", lead_count=0, html="h"),
            cap=3,
        )
    records = json.loads((out / EMAIL_LOG_FILENAME).read_text(encoding="utf-8"))
    assert [r["subject"] for r in records] == ["s2", "s3", "s4"]  # oldest two dropped


def test_append_tolerates_corrupt_existing_file(tmp_path):
    out = tmp_path / "outputs"
    out.mkdir()
    (out / EMAIL_LOG_FILENAME).write_text("{not json", encoding="utf-8")

    append_record(
        out, build_record(kind="manager", recipients=[], subject="fresh", lead_count=0, html="h")
    )
    records = json.loads((out / EMAIL_LOG_FILENAME).read_text(encoding="utf-8"))
    assert [r["subject"] for r in records] == ["fresh"]  # corrupt file treated as empty


# --------------------------------------------------------------------------- #
#  record_send (best-effort convenience)                                       #
# --------------------------------------------------------------------------- #
def test_record_send_writes_under_paths_output_dir(tmp_path):
    paths = PathsConfig(root=tmp_path)
    record_send(
        paths,
        kind="scorecard",
        recipients=["mgr@dkbinc.co"],
        subject="Weekly rep scorecard — 3 salespeople",
        lead_count=3,
        html="<table>…</table>",
    )
    records = json.loads((tmp_path / "outputs" / EMAIL_LOG_FILENAME).read_text(encoding="utf-8"))
    assert records[0]["kind"] == "scorecard"
    assert records[0]["lead_count"] == 3


def test_record_send_swallows_io_errors(tmp_path, monkeypatch):
    # Force the writer to raise; record_send must not propagate (mail already sent).
    import retell_sync.sendlog as sendlog_mod

    def _boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(sendlog_mod, "append_record", _boom)
    # No exception escapes.
    record_send(
        PathsConfig(root=tmp_path),
        kind="manager",
        recipients=["a@x.co"],
        subject="s",
        lead_count=1,
        html="h",
    )
