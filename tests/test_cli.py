"""
Tests for :mod:`retell_sync.cli` — orchestration of the ``run`` command (PR 5).

The end-to-end tests drive ``main(["run", ...])`` with **both** external APIs
mocked at the HTTP layer (a fake ``requests.Session`` that dispatches on URL:
``list-calls`` → Retell calls, ``search_read`` → Odoo leads). This exercises the
real clients, the real join/funnel, and the real writers — only the network is
faked — and asserts the three deliverables land on disk.

The guard tests confirm the master-plan requirement that *one* API outage (or a
missing credential) yields a clear, attributable error and a non-zero exit code
rather than a traceback.

Hermetic env: ``_maybe_load_dotenv`` is neutered and credentials are set per test,
so a developer's real ``.env`` can never leak in.
"""

from __future__ import annotations

import json

import pytest

import retell_sync.config as config_mod
from retell_sync.cli import main
from retell_sync.output import BY_CALL_CSV, CONVERSION_JSON, FUNNEL_CSV


# --------------------------------------------------------------------------- #
#  HTTP fakes                                                                  #
# --------------------------------------------------------------------------- #
class FakeResponse:
    def __init__(self, payload, *, status_code: int = 200, text: str | None = None):
        self._payload = payload
        self.status_code = status_code
        self.text = text if text is not None else json.dumps(payload)

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self):
        return self._payload


class DispatchSession:
    """Fake session routing POSTs to a Retell/Odoo payload — or the Graph send flow.

    ``list-calls`` → Retell calls, ``search_read`` → Odoo leads, the Azure token
    endpoint → an access token, and ``sendMail`` → a ``202`` (recorded in ``sent``),
    so one fake can back the whole ``run``/``alert`` path including email delivery.
    """

    def __init__(self, *, calls_response, leads_response):
        self._calls = calls_response
        self._leads = leads_response
        self.urls: list[str] = []
        self.sent: list[dict] = []

    def post(self, url, *, json=None, data=None, headers=None, timeout=None):  # noqa: A002
        self.urls.append(url)
        if "list-calls" in url:
            return self._calls
        if "search_read" in url:
            return self._leads
        if "oauth2/v2.0/token" in url:
            return FakeResponse({"access_token": "graph-token"})
        if "sendMail" in url:
            self.sent.append(json)
            return FakeResponse(None, status_code=202, text="")
        return FakeResponse([])


_CALL = {
    "call_id": "c1",
    "from_number": "+1 (480) 555-0001",
    "start_timestamp": 1_753_000_000_000,
    "duration_ms": 60_000,
    "call_cost": {"combined_cost": 25},
    "direction": "inbound",
}
_LEAD = {
    "id": 1,
    "name": "Acme Reno",
    "phone": "480-555-0001",
    "stage_id": [4, "Won"],
    "probability": 100.0,
    "expected_revenue": 5000.0,
    "active": True,
    "write_date": "2026-08-01 12:00:00",
    "create_date": "2026-08-01 12:00:00",
    "type": "opportunity",
}


@pytest.fixture
def creds(monkeypatch):
    """Set the three secrets and stop any real ``.env`` from loading."""
    monkeypatch.setattr(config_mod, "_maybe_load_dotenv", lambda: None)
    monkeypatch.setenv("RETELL_API_KEY", "retell-secret")
    monkeypatch.setenv("ODOO_URL", "https://odoo.example.com")
    monkeypatch.setenv("ODOO_API_KEY", "odoo-secret")


def _install_session(monkeypatch, session):
    """Point every client's ``requests.Session()`` (Retell, Odoo, mailer) at the fake."""
    import retell_sync.mailer as mailer_mod
    import retell_sync.odoo as odoo_mod
    import retell_sync.retell as retell_mod

    monkeypatch.setattr(retell_mod.requests, "Session", lambda: session)
    monkeypatch.setattr(odoo_mod.requests, "Session", lambda: session)
    monkeypatch.setattr(mailer_mod.requests, "Session", lambda: session)


def _graph_creds(monkeypatch):
    """Set the M365 send secrets + a recipient so ``require_graph`` passes."""
    monkeypatch.setenv("GRAPH_TENANT_ID", "tenant-123")
    monkeypatch.setenv("GRAPH_CLIENT_ID", "client-123")
    monkeypatch.setenv("GRAPH_CLIENT_SECRET", "shh")
    monkeypatch.setenv("ALERT_FROM", "afterhours@dkbinc.co")
    monkeypatch.setenv("ALERT_TO", "alex@dkbinc.co")


# --------------------------------------------------------------------------- #
#  End-to-end happy path                                                      #
# --------------------------------------------------------------------------- #
def test_run_writes_three_deliverables(tmp_path, monkeypatch, creds, capsys):
    session = DispatchSession(
        calls_response=FakeResponse([_CALL]),          # short page -> pagination stops
        leads_response=FakeResponse([_LEAD]),
    )
    _install_session(monkeypatch, session)
    monkeypatch.chdir(tmp_path)  # cfg.paths default root="." -> outputs land here

    rc = main(["run", "--days", "7"])
    assert rc == 0

    out = tmp_path / "outputs"
    assert (out / BY_CALL_CSV).is_file()
    assert (out / FUNNEL_CSV).is_file()
    assert (out / CONVERSION_JSON).is_file()

    data = json.loads((out / CONVERSION_JSON).read_text(encoding="utf-8"))
    assert data["kpis"]["total_calls"] == 1
    assert data["kpis"]["won_calls"] == 1
    # The call joined to the won lead worth $5000.
    assert data["kpis"]["won_revenue"] == 5000.0
    assert "run complete" in capsys.readouterr().out


def test_run_json_is_strict_nan_free(tmp_path, monkeypatch, creds):
    # A call with no cost and no matching lead exercises the NaN/None paths.
    bare_call = {"call_id": "c9", "from_number": "4805559999",
                 "start_timestamp": 1_753_000_000_000}
    session = DispatchSession(
        calls_response=FakeResponse([bare_call]),
        leads_response=FakeResponse([]),
    )
    _install_session(monkeypatch, session)
    monkeypatch.chdir(tmp_path)

    assert main(["run"]) == 0
    text = (tmp_path / "outputs" / CONVERSION_JSON).read_text(encoding="utf-8")
    assert "NaN" not in text
    json.loads(text)  # strict parse must not raise


def test_run_sends_digest_when_alerts_enabled(tmp_path, monkeypatch, creds, capsys):
    # With RETELL_ALERT_ENABLED + Graph creds, `run` also emails the SLA digest for
    # an overdue caller — the nightly refresh delivers the alert without a 2nd task.
    from datetime import UTC, datetime, timedelta

    old_ms = int((datetime.now(UTC) - timedelta(hours=60)).timestamp() * 1000)
    call = {"call_id": "c1", "from_number": "+1 (480) 555-0001",
            "start_timestamp": old_ms, "duration_ms": 60_000,
            "call_cost": {"combined_cost": 25}, "direction": "inbound"}
    lead = {**_LEAD, "stage_id": [1, "New Customer / Need Info"],
            "user_id": [9, "Jane Doe"], "probability": 10.0, "expected_revenue": 0.0}
    session = DispatchSession(
        calls_response=FakeResponse([call]), leads_response=FakeResponse([lead])
    )
    _install_session(monkeypatch, session)
    _graph_creds(monkeypatch)
    monkeypatch.setenv("RETELL_ALERT_ENABLED", "true")
    monkeypatch.chdir(tmp_path)

    assert main(["run"]) == 0
    assert len(session.sent) == 1
    assert "SLA digest: emailed 1 overdue caller(s)" in capsys.readouterr().out


def test_run_digest_disabled_by_default(tmp_path, monkeypatch, creds, capsys):
    # No RETELL_ALERT_ENABLED -> run never touches the mail path, even with creds set.
    call, lead = _overdue_call_and_lead()
    session = DispatchSession(
        calls_response=FakeResponse([call]), leads_response=FakeResponse([lead])
    )
    _install_session(monkeypatch, session)
    _graph_creds(monkeypatch)
    monkeypatch.chdir(tmp_path)

    assert main(["run"]) == 0
    assert not session.sent


# --------------------------------------------------------------------------- #
#  Guards: one outage != a crash                                              #
# --------------------------------------------------------------------------- #
def test_run_reports_retell_api_error(tmp_path, monkeypatch, creds, capsys):
    session = DispatchSession(
        calls_response=FakeResponse(None, status_code=503, text="upstream down"),
        leads_response=FakeResponse([_LEAD]),
    )
    _install_session(monkeypatch, session)
    monkeypatch.chdir(tmp_path)

    rc = main(["run"])
    assert rc == 1
    err = capsys.readouterr().err
    assert "Retell API error" in err and "503" in err
    assert not (tmp_path / "outputs").exists()  # nothing written on failure


def test_run_reports_odoo_api_error(tmp_path, monkeypatch, creds, capsys):
    session = DispatchSession(
        calls_response=FakeResponse([_CALL]),
        leads_response=FakeResponse(None, status_code=500, text="odoo boom"),
    )
    _install_session(monkeypatch, session)
    monkeypatch.chdir(tmp_path)

    rc = main(["run"])
    assert rc == 1
    assert "Odoo API error" in capsys.readouterr().err


def test_run_missing_credentials_exits_2(tmp_path, monkeypatch, capsys):
    # No creds fixture: RETELL_API_KEY absent -> ConfigError -> exit 2, no traceback.
    monkeypatch.setattr(config_mod, "_maybe_load_dotenv", lambda: None)
    monkeypatch.delenv("RETELL_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    rc = main(["run"])
    assert rc == 2
    assert "RETELL_API_KEY" in capsys.readouterr().err


# --------------------------------------------------------------------------- #
#  Parser wiring                                                              #
# --------------------------------------------------------------------------- #
def test_run_accepts_window_flags():
    from retell_sync.cli import build_parser

    args = build_parser().parse_args(["run", "--since", "2026-07-01"])
    assert args.since == "2026-07-01"
    assert args.command == "run"


# --------------------------------------------------------------------------- #
#  alert (SLA digest, dry-run)                                                #
# --------------------------------------------------------------------------- #
def test_alert_dry_run_lists_overdue_caller(tmp_path, monkeypatch, creds, capsys):
    from datetime import UTC, datetime, timedelta

    # A call ~60h before real "now" (cmd_alert reads the wall clock), still at an
    # entry stage -> overdue.
    old_ms = int((datetime.now(UTC) - timedelta(hours=60)).timestamp() * 1000)
    call = {"call_id": "c1", "from_number": "+1 (480) 555-0001",
            "start_timestamp": old_ms, "duration_ms": 60_000,
            "call_cost": {"combined_cost": 25}, "direction": "inbound"}
    lead = {**_LEAD, "stage_id": [1, "New Customer / Need Info"],
            "user_id": [9, "Jane Doe"], "probability": 10.0, "expected_revenue": 0.0}
    session = DispatchSession(
        calls_response=FakeResponse([call]), leads_response=FakeResponse([lead])
    )
    _install_session(monkeypatch, session)
    monkeypatch.chdir(tmp_path)

    rc = main(["alert", "--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "overdue" in out and "Jane Doe" in out


def _overdue_call_and_lead():
    """A call ~60h before real 'now' still at an entry stage -> one overdue caller."""
    from datetime import UTC, datetime, timedelta

    old_ms = int((datetime.now(UTC) - timedelta(hours=60)).timestamp() * 1000)
    call = {"call_id": "c1", "from_number": "+1 (480) 555-0001",
            "start_timestamp": old_ms, "duration_ms": 60_000,
            "call_cost": {"combined_cost": 25}, "direction": "inbound"}
    lead = {**_LEAD, "stage_id": [1, "New Customer / Need Info"],
            "user_id": [9, "Jane Doe"], "probability": 10.0, "expected_revenue": 0.0}
    return call, lead


def test_alert_sends_digest_when_overdue(tmp_path, monkeypatch, creds, capsys):
    call, lead = _overdue_call_and_lead()
    session = DispatchSession(
        calls_response=FakeResponse([call]), leads_response=FakeResponse([lead])
    )
    _install_session(monkeypatch, session)
    _graph_creds(monkeypatch)
    monkeypatch.chdir(tmp_path)

    rc = main(["alert"])
    assert rc == 0
    assert len(session.sent) == 1  # exactly one sendMail
    message = session.sent[0]["message"]
    assert "Jane Doe" in message["body"]["content"]
    assert message["toRecipients"] == [{"emailAddress": {"address": "alex@dkbinc.co"}}]
    assert "sent SLA digest to alex@dkbinc.co" in capsys.readouterr().out


def test_alert_missing_graph_creds_exits_2(tmp_path, monkeypatch, creds, capsys):
    # Overdue caller but no Graph secrets -> require_graph fails before any send.
    call, lead = _overdue_call_and_lead()
    session = DispatchSession(
        calls_response=FakeResponse([call]), leads_response=FakeResponse([lead])
    )
    _install_session(monkeypatch, session)
    for var in ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET",
                "ALERT_FROM", "ALERT_TO"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(tmp_path)

    rc = main(["alert"])
    assert rc == 2
    assert not session.sent
    assert "GRAPH_TENANT_ID" in capsys.readouterr().err


def test_alert_sends_nothing_when_none_overdue(tmp_path, monkeypatch, creds, capsys):
    # A won lead is never overdue; a non-dry-run alert still sends no email.
    won_call = {"call_id": "c1", "from_number": "+1 (480) 555-0001",
                "start_timestamp": 1_753_000_000_000, "duration_ms": 60_000,
                "call_cost": {"combined_cost": 25}, "direction": "inbound"}
    session = DispatchSession(
        calls_response=FakeResponse([won_call]), leads_response=FakeResponse([_LEAD])
    )
    _install_session(monkeypatch, session)
    _graph_creds(monkeypatch)
    monkeypatch.chdir(tmp_path)

    rc = main(["alert"])
    assert rc == 0
    assert not session.sent
    assert "nothing to send" in capsys.readouterr().out


def test_alert_reports_odoo_api_error(tmp_path, monkeypatch, creds, capsys):
    session = DispatchSession(
        calls_response=FakeResponse([_CALL]),
        leads_response=FakeResponse(None, status_code=500, text="odoo boom"),
    )
    _install_session(monkeypatch, session)
    monkeypatch.chdir(tmp_path)

    rc = main(["alert", "--dry-run"])
    assert rc == 1
    assert "Odoo API error" in capsys.readouterr().err


def test_alert_accepts_window_flags():
    from retell_sync.cli import build_parser

    args = build_parser().parse_args(["alert", "--dry-run", "--days", "7"])
    assert args.dry_run is True
    assert args.days == 7
    assert args.command == "alert"
