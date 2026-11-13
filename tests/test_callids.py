"""Tests for the optional Retell call id on Odoo leads (``ODOO_CALL_ID_FIELD``).

Covers the config guard, the lead pull carrying the field, the write request,
the exact call → lead join, which leads the backfill plan dares to stamp, and the
two CLI paths (``backfill-call-ids`` and the opt-in write inside ``run``).
"""

from __future__ import annotations

import pandas as pd
import pytest

import retell_sync.config as config_mod
from retell_sync.callids import apply_call_id_writes, plan_call_id_writes
from retell_sync.cli import main
from retell_sync.config import AppConfig, ConfigError, OdooConfig
from retell_sync.conversion import join_calls_to_leads
from retell_sync.odoo import CALL_ID_COLUMN, LEAD_FIELDS, OdooClient, OdooError
from retell_sync.retell import CALL_FIELDS

FIELD = "x_retell_call_id"


# --------------------------------------------------------------------------- #
#  Fakes                                                                       #
# --------------------------------------------------------------------------- #
class FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self):
        return self._payload


class OdooSession:
    """Answers list-calls with ``calls`` (one Retell v3 page), search_read with
    ``leads``, and records every ``crm.lead/write``."""

    def __init__(self, leads=None, *, calls=None, write_status=200):
        self.leads = leads or []
        self.calls = calls or []
        self.write_status = write_status
        self.reads: list[dict] = []
        self.writes: list[dict] = []

    def post(self, url, *, json=None, data=None, headers=None, timeout=None):  # noqa: A002
        if "list-calls" in url:
            return FakeResponse({"items": self.calls, "has_more": False})
        if url.endswith("/crm.lead/search_read"):
            self.reads.append(json)
            return FakeResponse(self.leads)
        if url.endswith("/crm.lead/write"):
            self.writes.append(json)
            return FakeResponse(True, self.write_status)
        return FakeResponse([])


def _odoo(session, field=FIELD) -> OdooClient:
    cfg = OdooConfig(url="https://odoo.example.com/json/2", api_key="k", call_id_field=field)
    return OdooClient(cfg, session=session)


def _raw_lead(lead_id, phone, *, call_id=False, created="2026-08-01 12:00:00",
              written="2026-08-02 12:00:00"):
    return {
        "id": lead_id, "name": f"Lead {lead_id}", "phone": phone, "user_id": False,
        "stage_id": [1, "New"], "probability": 10.0, "type": "opportunity",
        "expected_revenue": 0.0, "date_closed": False, "active": True,
        "create_date": created, "write_date": written, FIELD: call_id,
    }


# --------------------------------------------------------------------------- #
#  Config                                                                      #
# --------------------------------------------------------------------------- #
def test_field_and_write_switch_come_from_env():
    cfg = AppConfig.from_env({"ODOO_CALL_ID_FIELD": FIELD, "RETELL_WRITE_CALL_IDS": "true"})
    assert cfg.odoo.call_id_field == FIELD
    assert cfg.odoo.write_call_ids is True
    assert AppConfig.from_env({}).odoo.write_call_ids is False


@pytest.mark.parametrize("bad", ["", "retell_call_id", "x_Retell", "x_id; drop", "X_ID"])
def test_field_name_must_be_a_custom_field(bad):
    with pytest.raises(ConfigError):
        OdooConfig(call_id_field=bad or None).require_call_id_field()


# --------------------------------------------------------------------------- #
#  Odoo client                                                                 #
# --------------------------------------------------------------------------- #
def test_pull_requests_the_field_and_cleans_empty_values():
    session = OdooSession([_raw_lead(1, "4805550001", call_id="call_a"),
                           _raw_lead(2, "4805550002", call_id=False),
                           _raw_lead(3, "4805550003", call_id="  ")])
    frame = _odoo(session).search_leads(None)
    assert FIELD in session.reads[0]["fields"]
    assert list(frame.columns) == [*LEAD_FIELDS, CALL_ID_COLUMN]
    assert frame[CALL_ID_COLUMN].tolist() == ["call_a", None, None]


def test_pull_without_the_field_is_unchanged():
    session = OdooSession([_raw_lead(1, "4805550001")])
    frame = _odoo(session, field=None).search_leads(None)
    assert FIELD not in session.reads[0]["fields"]
    assert list(frame.columns) == list(LEAD_FIELDS)


def test_set_lead_call_id_posts_an_odoo_write():
    session = OdooSession()
    _odoo(session).set_lead_call_id(42, "call_abc")
    assert session.writes == [{"ids": [42], "vals": {FIELD: "call_abc"}}]


# --------------------------------------------------------------------------- #
#  Exact join                                                                  #
# --------------------------------------------------------------------------- #
def _calls(*rows):
    base = []
    for call_id, phone, ts in rows:
        row = {f: None for f in CALL_FIELDS}
        row.update(call_id=call_id, from_number=phone, ts=pd.Timestamp(ts), duration=60.0)
        base.append(row)
    return pd.DataFrame(base, columns=list(CALL_FIELDS))


def _leads(*rows):
    frame = pd.DataFrame([{k: r[k] for k in LEAD_FIELDS} for r in rows], columns=list(LEAD_FIELDS))
    frame[CALL_ID_COLUMN] = [r[FIELD] or None for r in rows]
    return frame


def test_stored_call_id_beats_the_phone_tiebreak_and_keeps_row_order():
    calls = _calls(("c0", "4805550009", "2026-08-01T05:00:00Z"),
                   ("c1", "4805550001", "2026-08-01T05:00:00Z"),
                   ("c2", "4805550001", "2026-08-02T05:00:00Z"))
    leads = _leads(
        _raw_lead(1, "4805550001", call_id="c1", written="2026-07-01 00:00:00"),  # older
        _raw_lead(2, "4805550001", written="2026-08-05 00:00:00"),  # newest -> phone winner
    )
    joined = join_calls_to_leads(calls, leads)
    assert joined["call_id"].tolist() == ["c0", "c1", "c2"]
    assert pd.isna(joined.iloc[0]["id"])
    assert joined.iloc[1]["id"] == 1  # exact match on the stored call id
    assert joined.iloc[2]["id"] == 2  # everyone else still joins on the phone


def test_no_stored_ids_means_plain_phone_join():
    calls = _calls(("c1", "4805550001", "2026-08-01T05:00:00Z"))
    joined = join_calls_to_leads(calls, _leads(_raw_lead(1, "4805550001")))
    assert joined.iloc[0]["id"] == 1


# --------------------------------------------------------------------------- #
#  Plan                                                                        #
# --------------------------------------------------------------------------- #
def _by_call(*rows):
    cols = ["call_id", "phone_key", "ts", "matched", "lead_id", "lead_name", "lead_created"]
    return pd.DataFrame(
        [dict(zip(cols, (cid, phone, ts, lid is not None, lid, f"Lead {lid}", created),
                  strict=True))
         for cid, phone, ts, lid, created in rows],
        columns=cols,
    )


def test_plan_stamps_a_new_lead_with_its_first_call():
    leads = _leads(_raw_lead(1, "4805550001", created="2026-08-01 12:30:00"))
    by_call = _by_call(
        ("later", "4805550001", "2026-08-03T05:00:00Z", 1, "2026-08-01 12:30:00"),
        ("first", "4805550001", "2026-08-01T12:00:00Z", 1, "2026-08-01 12:30:00"),
    )
    plan = plan_call_id_writes(by_call, leads, grace_hours=12)
    assert plan[["lead_id", "call_id"]].values.tolist() == [[1, "first"]]


@pytest.mark.parametrize(
    ("leads", "why"),
    [
        ([_raw_lead(1, "4805550001", call_id="already")], "field already set"),
        ([_raw_lead(1, "4805550001"), _raw_lead(2, "4805550001")], "phone has two leads"),
        ([_raw_lead(1, "4805550001", created="2026-01-01 00:00:00")], "lead predates call"),
        ([_raw_lead(1, "4805550001"), _raw_lead(9, "4805559999", call_id="first")],
         "call id already on another lead"),
    ],
)
def test_plan_skips_anything_it_cant_stand_behind(leads, why):
    frame = _leads(*leads)
    created = frame.loc[frame["id"] == 1, "create_date"].iloc[0]
    by_call = _by_call(("first", "4805550001", "2026-08-01T12:00:00Z", 1, created))
    assert plan_call_id_writes(by_call, frame, grace_hours=12).empty, why


def test_plan_is_empty_without_the_field():
    leads = _leads(_raw_lead(1, "4805550001")).drop(columns=CALL_ID_COLUMN)
    by_call = _by_call(("first", "4805550001", "2026-08-01T12:00:00Z", 1, "2026-08-01 12:30:00"))
    assert plan_call_id_writes(by_call, leads, grace_hours=12).empty


def test_apply_stops_after_repeated_failures():
    class Failing:
        attempts = 0

        def set_lead_call_id(self, lead_id, call_id):
            Failing.attempts += 1
            raise OdooError("crm.lead/write 403: access denied")

    plan = pd.DataFrame({"lead_id": [1, 2, 3, 4, 5], "lead_name": ["x"] * 5,
                         "call_id": list("abcde"), "call_ts": [pd.Timestamp(0)] * 5,
                         "phone_key": ["1"] * 5})
    written, errors = apply_call_id_writes(plan, Failing())
    assert written == 0
    assert Failing.attempts == 3
    assert "stopped after 3 failures" in errors[-1]


# --------------------------------------------------------------------------- #
#  CLI                                                                         #
# --------------------------------------------------------------------------- #
_CALL = {"call_id": "call_1", "from_number": "+1 (480) 555-0001",
         "start_timestamp": 1_785_585_600_000,  # 2026-08-01 12:00 UTC
         "duration_ms": 60_000, "call_cost": {"combined_cost": 25}, "direction": "inbound"}


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setattr(config_mod, "_maybe_load_dotenv", lambda: None)
    monkeypatch.setenv("RETELL_API_KEY", "r")
    monkeypatch.setenv("ODOO_URL", "https://odoo.example.com/json/2")
    monkeypatch.setenv("ODOO_API_KEY", "o")
    monkeypatch.setenv("ODOO_CALL_ID_FIELD", FIELD)
    monkeypatch.delenv("RETELL_WRITE_CALL_IDS", raising=False)
    monkeypatch.chdir(tmp_path)


def _install(monkeypatch, session):
    import retell_sync.odoo as odoo_mod
    import retell_sync.retell as retell_mod

    monkeypatch.setattr(retell_mod.requests, "Session", lambda: session)
    monkeypatch.setattr(odoo_mod.requests, "Session", lambda: session)


def test_backfill_is_a_dry_run_by_default(env, monkeypatch, capsys):
    session = OdooSession([_raw_lead(1, "480-555-0001", created="2026-08-01 12:05:00")],
                          calls=[_CALL])
    _install(monkeypatch, session)
    assert main(["backfill-call-ids"]) == 0
    assert session.writes == []
    out = capsys.readouterr().out
    assert "call_1" in out and "dry run: 1 lead(s) would be updated" in out


def test_backfill_apply_writes_the_planned_ids(env, monkeypatch, capsys):
    session = OdooSession([_raw_lead(1, "480-555-0001", created="2026-08-01 12:05:00")],
                          calls=[_CALL])
    _install(monkeypatch, session)
    assert main(["backfill-call-ids", "--apply"]) == 0
    assert session.writes == [{"ids": [1], "vals": {FIELD: "call_1"}}]
    assert "wrote the call id onto 1 of 1 lead(s)" in capsys.readouterr().out


def test_backfill_needs_the_field(env, monkeypatch, capsys):
    monkeypatch.delenv("ODOO_CALL_ID_FIELD")
    assert main(["backfill-call-ids"]) == 2
    assert "ODOO_CALL_ID_FIELD not set" in capsys.readouterr().err


def test_run_writes_only_when_switched_on(env, monkeypatch, capsys):
    lead = _raw_lead(1, "480-555-0001", created="2026-08-01 12:05:00")
    off = OdooSession([lead], calls=[_CALL])
    _install(monkeypatch, off)
    assert main(["run"]) == 0
    assert off.writes == []

    monkeypatch.setenv("RETELL_WRITE_CALL_IDS", "true")
    on = OdooSession([lead], calls=[_CALL])
    _install(monkeypatch, on)
    assert main(["run"]) == 0
    assert on.writes == [{"ids": [1], "vals": {FIELD: "call_1"}}]
    assert "call ids: stamped 1 of 1 lead(s)" in capsys.readouterr().out


def test_run_never_writes_from_a_windowed_pull(env, monkeypatch, capsys):
    monkeypatch.setenv("RETELL_WRITE_CALL_IDS", "true")
    session = OdooSession([_raw_lead(1, "480-555-0001", created="2026-08-01 12:05:00")],
                          calls=[_CALL])
    _install(monkeypatch, session)
    assert main(["run", "--days", "30"]) == 0
    assert session.writes == []
    assert "skipped (needs the full-history pull" in capsys.readouterr().out
