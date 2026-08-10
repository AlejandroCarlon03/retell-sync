"""
Tests for :mod:`retell_sync.mailer` — the M365 SLA-digest delivery.

Two halves, matching the module's purity boundary:

* :func:`build_digest_html` / :func:`build_digest_subject` are pure, so they are
  asserted directly over a synthetic overdue frame — no network. We check the row
  content, that cells are HTML-escaped, and that a missing link template or id drops
  just that one anchor.
* :func:`send_digest` is exercised against a fake ``requests`` session that records
  the two POSTs (token, then sendMail), so the client-credentials handshake and the
  Graph message body are asserted without touching the network. The failure paths
  (bad token, non-2xx sendMail, tokenless response) map to :class:`MailerError`.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd
import pytest

from retell_sync.config import AlertConfig
from retell_sync.mailer import (
    MailerError,
    build_digest_html,
    build_digest_subject,
    send_digest,
)
from retell_sync.output import build_links
from retell_sync.sla import OVERDUE_FIELDS

GEN_AT = datetime(2026, 8, 10, 12, 0, 0, tzinfo=UTC)

LINKS = build_links(
    retell_dashboard_url="https://dashboard.retellai.com",
    odoo_web_url="https://dkbinc.co",
)


def _overdue(rows: list[dict]) -> pd.DataFrame:
    """Build an OVERDUE_FIELDS frame from partial row dicts (missing cols -> None)."""
    filled = [{f: r.get(f) for f in OVERDUE_FIELDS} for r in rows]
    return pd.DataFrame(filled, columns=list(OVERDUE_FIELDS))


# --------------------------------------------------------------------------- #
#  Digest rendering (pure)                                                     #
# --------------------------------------------------------------------------- #
def test_build_digest_html_renders_rows_and_links():
    overdue = _overdue(
        [
            {"lead_id": 1, "lead_name": "Acme Reno", "phone_key": "4805550001",
             "sales_rep": "Jane Doe", "stage_label": "New Customer / Need Info",
             "call_id": "c1", "hours_overdue": 60.0},
        ]
    )
    html = build_digest_html(overdue, LINKS, 48.0, generated_at=GEN_AT)

    assert "Acme Reno" in html
    assert "Jane Doe" in html
    assert "60.0h" in html
    assert "1</strong>" in html  # the overdue count in the summary line
    # Per-row deep links filled from the templates.
    assert 'href="https://dkbinc.co/odoo/crm/1"' in html
    assert 'href="https://dashboard.retellai.com/call-history?history=c1"' in html


def test_build_digest_html_escapes_cell_content():
    overdue = _overdue(
        [{"lead_id": 1, "lead_name": "<script>alert(1)</script>",
          "phone_key": "480", "sales_rep": "A&B", "stage_label": "New",
          "call_id": "c1", "hours_overdue": 50.0}]
    )
    html = build_digest_html(overdue, LINKS, 48.0, generated_at=GEN_AT)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "A&amp;B" in html


def test_build_digest_html_omits_absent_links():
    # No Odoo base configured -> no odoo_lead template; a row with no call_id -> no
    # Retell anchor. The row still renders, just without those buttons.
    links = build_links(retell_dashboard_url="https://dashboard.retellai.com", odoo_web_url=None)
    overdue = _overdue(
        [{"lead_id": 1, "lead_name": "No Links", "phone_key": "480",
          "sales_rep": "Jane", "stage_label": "New", "call_id": None,
          "hours_overdue": 50.0}]
    )
    html = build_digest_html(overdue, links, 48.0, generated_at=GEN_AT)
    assert "No Links" in html
    assert "odoo/crm" not in html
    assert "call-history" not in html


def test_build_digest_subject_singular_and_plural():
    one = _overdue([{"lead_id": 1, "hours_overdue": 60.0}])
    two = _overdue([{"lead_id": 1, "hours_overdue": 60.0},
                    {"lead_id": 2, "hours_overdue": 50.0}])
    assert build_digest_subject(one, 48.0) == "[retell-sync] 1 after-hours caller overdue past 48h"
    assert build_digest_subject(two, 48.0) == "[retell-sync] 2 after-hours callers overdue past 48h"


# --------------------------------------------------------------------------- #
#  Send handshake (IO, faked)                                                  #
# --------------------------------------------------------------------------- #
class FakeResponse:
    def __init__(self, payload, *, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class RecordingSession:
    """Fake session capturing the token + sendMail POSTs, with tunable responses."""

    def __init__(self, *, token_resp=None, mail_resp=None):
        self._token_resp = token_resp or FakeResponse({"access_token": "graph-token"})
        self._mail_resp = mail_resp or FakeResponse(None, status_code=202)
        self.token_calls: list[dict] = []
        self.mail_calls: list[dict] = []

    def post(self, url, *, json=None, data=None, headers=None, timeout=None):  # noqa: A002
        if "oauth2/v2.0/token" in url:
            self.token_calls.append({"url": url, "data": data})
            return self._token_resp
        if "sendMail" in url:
            self.mail_calls.append({"url": url, "json": json, "headers": headers})
            return self._mail_resp
        raise AssertionError(f"unexpected POST to {url}")


CFG = AlertConfig(
    graph_tenant_id="tenant-123",
    graph_client_id="client-123",
    graph_client_secret="shh",
    alert_from="afterhours@dkbinc.co",
    alert_recipients=("alex@dkbinc.co", "sam@dkbinc.co"),
)


def test_send_digest_posts_token_then_sendmail():
    session = RecordingSession()
    send_digest(CFG, subject="Subj", html_body="<b>hi</b>", session=session)

    # Token: client-credentials grant with the .default scope.
    assert len(session.token_calls) == 1
    tok = session.token_calls[0]
    assert "tenant-123" in tok["url"]
    assert tok["data"]["grant_type"] == "client_credentials"
    assert tok["data"]["client_secret"] == "shh"
    assert tok["data"]["scope"].endswith("/.default")

    # sendMail: as the configured sender, bearer of the minted token, both recipients.
    assert len(session.mail_calls) == 1
    mail = session.mail_calls[0]
    assert "afterhours@dkbinc.co" in mail["url"]
    assert mail["headers"]["Authorization"] == "Bearer graph-token"
    msg = mail["json"]["message"]
    assert msg["subject"] == "Subj"
    assert msg["body"] == {"contentType": "HTML", "content": "<b>hi</b>"}
    assert [r["emailAddress"]["address"] for r in msg["toRecipients"]] == [
        "alex@dkbinc.co", "sam@dkbinc.co"
    ]


def test_send_digest_token_failure_raises():
    session = RecordingSession(token_resp=FakeResponse(None, status_code=401, text="bad creds"))
    with pytest.raises(MailerError, match="token 401"):
        send_digest(CFG, subject="s", html_body="h", session=session)
    assert not session.mail_calls  # never got to sendMail


def test_send_digest_missing_access_token_raises():
    session = RecordingSession(token_resp=FakeResponse({"not_a_token": "x"}))
    with pytest.raises(MailerError, match="no access_token"):
        send_digest(CFG, subject="s", html_body="h", session=session)


def test_send_digest_sendmail_failure_raises():
    session = RecordingSession(mail_resp=FakeResponse(None, status_code=403, text="denied"))
    with pytest.raises(MailerError, match="sendMail 403"):
        send_digest(CFG, subject="s", html_body="h", session=session)
