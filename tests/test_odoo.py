"""
Tests for :mod:`retell_sync.odoo`.

All HTTP is mocked — nothing here touches live Odoo. Coverage:

* ``normalize_phone`` edge cases (formatting, country code, short/empty/None),
* ``build_leads_payload`` domain + ``active_test`` context construction,
* ``{"result": ...}`` envelope unwrapping,
* archived-lead inclusion (a lead with ``active = False`` survives into the frame),
* error surfacing on non-2xx responses,
* stable DataFrame schema (including the empty-result case).
"""

from __future__ import annotations

import json
from datetime import date, datetime

import pytest

from retell_sync.config import ConfigError, OdooConfig
from retell_sync.odoo import (
    LEAD_FIELDS,
    OdooClient,
    OdooError,
    normalize_phone,
)


# --------------------------------------------------------------------------- #
#  Fakes                                                                       #
# --------------------------------------------------------------------------- #
class FakeResponse:
    """Minimal stand-in for ``requests.Response``."""

    def __init__(self, payload, *, status_code: int = 200, text: str | None = None):
        self._payload = payload
        self.status_code = status_code
        self.text = text if text is not None else json.dumps(payload)

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self):
        if self._payload is _NO_JSON:
            raise ValueError("no json")
        return self._payload


_NO_JSON = object()


class FakeSession:
    """Records the last POST and returns a queued response."""

    def __init__(self, response: FakeResponse):
        self._response = response
        self.last_url: str | None = None
        self.last_json = None
        self.last_headers = None
        self.calls = 0

    def post(self, url, *, json=None, headers=None, timeout=None):  # noqa: A002
        self.calls += 1
        self.last_url = url
        self.last_json = json
        self.last_headers = headers
        self.last_timeout = timeout
        return self._response


def _client(response: FakeResponse) -> tuple[OdooClient, FakeSession]:
    session = FakeSession(response)
    cfg = OdooConfig(url="https://odoo.example.com/api/", api_key="secret")
    return OdooClient(cfg, session=session), session


# --------------------------------------------------------------------------- #
#  normalize_phone                                                            #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+1 (480) 555-1234", "4805551234"),
        ("480-555-1234", "4805551234"),
        ("480.555.1234", "4805551234"),
        ("14805551234", "4805551234"),      # 11 digits: leading country code dropped
        ("1-480-555-1234", "4805551234"),
        (4805551234, "4805551234"),          # non-string coerced
        ("  4805551234  ", "4805551234"),    # surrounding whitespace
        ("555-1234", "5551234"),             # <10 digits returned in full, not padded
        ("ext. 42", "42"),
        ("", ""),
        (None, ""),
        ("n/a", ""),
        ("+44 20 7946 0958", "2079460958"),  # last 10 of a longer intl number
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_normalize_phone_is_idempotent():
    once = normalize_phone("+1 (480) 555-1234")
    assert normalize_phone(once) == once


# --------------------------------------------------------------------------- #
#  Client construction / auth                                                 #
# --------------------------------------------------------------------------- #
def test_client_requires_credentials():
    with pytest.raises(ConfigError):
        OdooClient(OdooConfig())  # no url/key


def test_request_sends_bearer_auth_and_hits_search_read():
    client, session = _client(FakeResponse([]))
    client.search_leads(since=None)

    assert session.last_url == "https://odoo.example.com/api/crm.lead/search_read"
    assert session.last_headers["Authorization"] == "Bearer secret"
    assert session.last_headers["Content-Type"] == "application/json"


def test_base_url_trailing_slash_is_normalized():
    client, session = _client(FakeResponse([]))
    client.search_read("res.users", domain=[], fields=["id"])
    # single, non-doubled slash before the model path
    assert session.last_url == "https://odoo.example.com/api/res.users/search_read"


# --------------------------------------------------------------------------- #
#  Domain / context construction                                              #
# --------------------------------------------------------------------------- #
def test_build_leads_payload_disables_active_test():
    client, _ = _client(FakeResponse([]))
    payload = client.build_leads_payload(since=None)
    assert payload["context"] == {"active_test": False}
    # No active constraint in the domain — inclusion relies on active_test off.
    assert not any("active" in str(term) for term in payload["domain"])


def test_build_leads_payload_orders_by_write_date_desc():
    client, _ = _client(FakeResponse([]))
    payload = client.build_leads_payload(since=None)
    assert payload["order"] == "write_date desc"
    assert list(payload["fields"]) == list(LEAD_FIELDS)


def test_build_leads_payload_since_datetime_becomes_domain_term():
    client, _ = _client(FakeResponse([]))
    payload = client.build_leads_payload(since=datetime(2026, 7, 1, 9, 30, 0))
    assert payload["domain"] == [["write_date", ">=", "2026-07-01 09:30:00"]]


def test_build_leads_payload_since_date_starts_at_midnight():
    client, _ = _client(FakeResponse([]))
    payload = client.build_leads_payload(since=date(2026, 7, 1))
    assert payload["domain"] == [["write_date", ">=", "2026-07-01 00:00:00"]]


def test_build_leads_payload_since_string_passthrough():
    client, _ = _client(FakeResponse([]))
    payload = client.build_leads_payload(since="2026-07-01 00:00:00")
    assert payload["domain"] == [["write_date", ">=", "2026-07-01 00:00:00"]]


def test_build_leads_payload_none_since_has_empty_domain():
    client, _ = _client(FakeResponse([]))
    assert client.build_leads_payload(since=None)["domain"] == []


# --------------------------------------------------------------------------- #
#  Response handling                                                          #
# --------------------------------------------------------------------------- #
def _lead(**over):
    base = {
        "id": 1,
        "name": "Kitchen remodel",
        "phone": "480-555-1234",
        "user_id": [7, "Sales Rep"],
        "stage_id": [3, "Proposition"],
        "probability": 40.0,
        "type": "opportunity",
        "expected_revenue": 12000.0,
        "date_closed": False,
        "active": True,
        "create_date": "2026-07-01 12:00:00",
        "write_date": "2026-07-15 08:30:00",
    }
    base.update(over)
    return base


def test_result_envelope_is_unwrapped():
    # Odoo proxy wraps the record list in {"result": [...]}.
    client, _ = _client(FakeResponse({"result": [_lead()]}))
    df = client.search_leads(since=None)
    assert len(df) == 1
    assert df.iloc[0]["name"] == "Kitchen remodel"


def test_plain_list_body_is_accepted():
    client, _ = _client(FakeResponse([_lead(), _lead(id=2)]))
    df = client.search_leads(since=None)
    assert list(df["id"]) == [1, 2]


def test_archived_lost_lead_is_included():
    """The whole point of disabling active_test: a lost lead (active=False) stays."""
    won = _lead(id=1, active=True, stage_id=[4, "Won"], probability=100.0)
    lost = _lead(
        id=2,
        active=False,
        stage_id=[5, "Lost"],
        probability=0.0,
        date_closed="2026-07-20 17:00:00",
    )
    client, _ = _client(FakeResponse({"result": [won, lost]}))
    df = client.search_leads(since=None)

    assert set(df["id"]) == {1, 2}
    archived = df[df["id"] == 2].iloc[0]
    assert bool(archived["active"]) is False
    assert archived["date_closed"] == "2026-07-20 17:00:00"


def test_frame_has_full_schema_when_empty():
    client, _ = _client(FakeResponse({"result": []}))
    df = client.search_leads(since=None)
    assert df.empty
    assert list(df.columns) == list(LEAD_FIELDS)


def test_frame_columns_are_ordered_schema_even_with_data():
    client, _ = _client(FakeResponse([_lead()]))
    df = client.search_leads(since=None)
    assert list(df.columns) == list(LEAD_FIELDS)


def test_non_list_result_becomes_empty_frame():
    # Odoo returns False (not a list) when nothing matches.
    client, _ = _client(FakeResponse({"result": False}))
    df = client.search_leads(since=None)
    assert df.empty
    assert list(df.columns) == list(LEAD_FIELDS)


# --------------------------------------------------------------------------- #
#  Errors                                                                     #
# --------------------------------------------------------------------------- #
def test_non_2xx_raises_odoo_error_with_status_and_body():
    client, _ = _client(FakeResponse(None, status_code=401, text="unauthorized"))
    with pytest.raises(OdooError, match="401.*unauthorized"):
        client.search_leads(since=None)


def test_non_json_body_raises_odoo_error():
    client, _ = _client(FakeResponse(_NO_JSON, status_code=200, text="<html>oops</html>"))
    with pytest.raises(OdooError, match="non-JSON"):
        client.search_leads(since=None)


# --------------------------------------------------------------------------- #
#  fetch_user_emails (per-rep routing)                                        #
# --------------------------------------------------------------------------- #
def test_fetch_user_emails_maps_name_to_email_and_excludes_shared():
    records = [
        {"id": 1, "name": "Jane Doe", "email": "jane@dkb.co"},
        {"id": 2, "name": "No Email", "email": False},  # Odoo empty -> dropped
        {"id": 3, "name": "Rob Roe", "email": "rob@dkb.co"},
    ]
    client, session = _client(FakeResponse(records))
    emails = client.fetch_user_emails()

    assert emails == {"Jane Doe": "jane@dkb.co", "Rob Roe": "rob@dkb.co"}
    # Reads res.users, restricted to internal users (share = False).
    assert session.last_url.endswith("/res.users/search_read")
    assert ["share", "=", False] in session.last_json["domain"]


def test_fetch_user_emails_empty_when_no_users():
    client, _ = _client(FakeResponse({"result": False}))
    assert client.fetch_user_emails() == {}
