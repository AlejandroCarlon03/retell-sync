"""
Tests for :mod:`retell_sync.retell`.

All HTTP is mocked — nothing here touches live Retell. Coverage:

* raw call -> normalized record mapping (units: ms->UTC ts, cents->$, ms->s),
* tolerance of missing / malformed fields (no raise, NaN/NaT/None),
* v3 pagination: ``pagination_key`` round-trip, ``has_more`` stop condition,
* the cursor-can't-advance safety stop,
* dedup on ``call_id`` (idempotent re-normalization, first-occurrence wins),
* the v3 ``{"items": ...}`` envelope, and loud failure on any other body,
* stable DataFrame schema (including the empty-result case),
* bearer auth + endpoint, and error surfacing on non-2xx / non-JSON.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pandas as pd
import pytest

from retell_sync.config import ConfigError, RetellConfig
from retell_sync.retell import (
    CALL_FIELDS,
    RetellClient,
    RetellError,
    calls_to_frame,
    normalize_call,
)

# --------------------------------------------------------------------------- #
#  Fakes                                                                       #
# --------------------------------------------------------------------------- #
_NO_JSON = object()


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


class FakeSession:
    """Returns queued responses in order and records every POST."""

    def __init__(self, responses):
        # Accept a single response or a list; each POST pops the next one.
        self._responses = list(responses) if isinstance(responses, list) else [responses]
        self.posts: list[dict] = []

    def post(self, url, *, json=None, headers=None, timeout=None):  # noqa: A002
        self.posts.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        resp = self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]
        return resp


def _page(calls, *, next_key: str | None = None) -> FakeResponse:
    """A v3 ``list-calls`` response: ``has_more`` iff a ``next_key`` is given."""
    body: dict = {"items": calls, "has_more": next_key is not None}
    if next_key is not None:
        body["pagination_key"] = next_key
    return FakeResponse(body)


def _client(responses) -> tuple[RetellClient, FakeSession]:
    session = FakeSession(responses)
    cfg = RetellConfig(api_key="secret", base_url="https://api.retellai.com", page_size=2)
    return RetellClient(cfg, session=session), session


def _call(**over):
    base = {
        "call_id": "call_1",
        "from_number": "+1 (480) 555-1234",
        "start_timestamp": 1_753_000_000_000,
        "end_timestamp": 1_753_000_042_000,
        "duration_ms": 42_000,
        "call_cost": {"combined_cost": 275},
        "direction": "inbound",
        "disconnection_reason": "user_hangup",
        "call_analysis": {"user_sentiment": "Positive"},
    }
    base.update(over)
    return base


# --------------------------------------------------------------------------- #
#  normalize_call                                                             #
# --------------------------------------------------------------------------- #
def test_normalize_call_maps_all_fields():
    rec = normalize_call(_call())
    assert rec["call_id"] == "call_1"
    assert rec["from_number"] == "+1 (480) 555-1234"
    assert rec["direction"] == "inbound"
    assert rec["disconnection_reason"] == "user_hangup"
    assert rec["sentiment"] == "Positive"


def test_normalize_call_converts_units():
    rec = normalize_call(_call())
    assert rec["ts"] == pd.Timestamp("2025-07-20 08:26:40", tz="UTC")
    assert rec["duration"] == 42.0            # ms -> seconds
    assert rec["cost"] == 2.75               # cents -> dollars


def test_normalize_call_derives_duration_from_timestamps():
    rec = normalize_call(_call(duration_ms=None))
    assert rec["duration"] == 42.0           # (end - start) / 1000


def test_normalize_call_tolerates_missing_fields():
    rec = normalize_call({"call_id": "bare"})
    assert rec["call_id"] == "bare"
    assert rec["from_number"] is None
    assert rec["ts"] is pd.NaT
    assert pd.isna(rec["duration"])
    assert pd.isna(rec["cost"])
    assert rec["direction"] is None
    assert rec["sentiment"] is None


def test_normalize_call_handles_missing_cost_and_bad_timestamp():
    rec = normalize_call(_call(call_cost={}, start_timestamp="not-a-number"))
    assert pd.isna(rec["cost"])
    assert rec["ts"] is pd.NaT


def test_normalize_call_is_idempotent_via_frame():
    raw = [_call(call_id="a"), _call(call_id="b")]
    first = calls_to_frame(raw)
    second = calls_to_frame(raw)
    pd.testing.assert_frame_equal(first, second)


# --------------------------------------------------------------------------- #
#  calls_to_frame schema + dedup                                              #
# --------------------------------------------------------------------------- #
def test_frame_has_full_schema_when_empty():
    df = calls_to_frame([])
    assert df.empty
    assert list(df.columns) == list(CALL_FIELDS)


def test_frame_columns_are_ordered_schema_with_data():
    df = calls_to_frame([_call()])
    assert list(df.columns) == list(CALL_FIELDS)


def test_dedup_keeps_first_occurrence():
    # Same id twice with different cost; first (newest) wins.
    raw = [
        _call(call_id="dup", call_cost={"combined_cost": 100}),
        _call(call_id="dup", call_cost={"combined_cost": 999}),
        _call(call_id="other"),
    ]
    df = calls_to_frame(raw)
    assert list(df["call_id"]) == ["dup", "other"]
    assert df[df["call_id"] == "dup"].iloc[0]["cost"] == 1.0


def test_dedup_is_idempotent():
    raw = [_call(call_id="dup"), _call(call_id="dup")]
    once = calls_to_frame(raw)
    twice = calls_to_frame(once.to_dict(orient="records"))
    assert len(once) == 1
    assert len(twice) == 1


def test_dedup_disabled_keeps_duplicates():
    raw = [_call(call_id="dup"), _call(call_id="dup")]
    df = calls_to_frame(raw, dedup=False)
    assert len(df) == 2


def test_rows_without_call_id_are_not_dropped():
    raw = [_call(call_id=None), _call(call_id=None), _call(call_id="x")]
    df = calls_to_frame(raw)
    assert len(df) == 3  # nothing to dedup on for the id-less rows


# --------------------------------------------------------------------------- #
#  Client construction / auth                                                 #
# --------------------------------------------------------------------------- #
def test_client_requires_api_key():
    with pytest.raises(ConfigError):
        RetellClient(RetellConfig())  # no api_key


def test_request_sends_bearer_auth_and_hits_list_calls():
    client, session = _client(_page([]))
    client.fetch_calls(since=None)
    post = session.posts[0]
    assert post["url"] == "https://api.retellai.com/v3/list-calls"
    assert post["headers"]["Authorization"] == "Bearer secret"
    assert post["headers"]["Content-Type"] == "application/json"


def test_base_url_trailing_slash_is_normalized():
    session = FakeSession(_page([]))
    cfg = RetellConfig(api_key="secret", base_url="https://api.retellai.com/", page_size=2)
    RetellClient(cfg, session=session).fetch_calls(since=None)
    assert session.posts[0]["url"] == "https://api.retellai.com/v3/list-calls"


def test_since_becomes_ge_number_filter():
    client, session = _client(_page([]))
    client.fetch_calls(since=datetime(2026, 7, 1, tzinfo=UTC))
    body = session.posts[0]["json"]
    expected_ms = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
    assert body["filter_criteria"]["start_timestamp"] == {
        "type": "number",
        "op": "ge",
        "value": expected_ms,
    }
    assert body["sort_order"] == "descending"


def test_since_accepts_bare_date():
    client, session = _client(_page([]))
    client.fetch_calls(since=date(2026, 7, 1))
    body = session.posts[0]["json"]
    expected_ms = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
    assert body["filter_criteria"]["start_timestamp"] == {
        "type": "number",
        "op": "ge",
        "value": expected_ms,
    }


def test_no_since_omits_filter_criteria():
    client, session = _client(_page([]))
    client.fetch_calls(since=None)
    assert "filter_criteria" not in session.posts[0]["json"]


# --------------------------------------------------------------------------- #
#  Pagination                                                                 #
# --------------------------------------------------------------------------- #
def test_pagination_follows_pagination_key_until_has_more_is_false():
    page1 = _page([_call(call_id="a"), _call(call_id="b")], next_key="cursor-1")
    page2 = _page([_call(call_id="c")])
    client, session = _client([page1, page2])
    df = client.fetch_calls(since=None)

    assert list(df["call_id"]) == ["a", "b", "c"]
    assert len(session.posts) == 2
    assert "pagination_key" not in session.posts[0]["json"]
    # Second request sends back the opaque cursor Retell gave us, not a call_id.
    assert session.posts[1]["json"]["pagination_key"] == "cursor-1"


def test_pagination_keeps_filter_on_later_pages():
    page1 = _page([_call(call_id="a"), _call(call_id="b")], next_key="cursor-1")
    page2 = _page([])
    client, session = _client([page1, page2])
    client.fetch_calls(since=date(2026, 7, 1))
    first, second = (p["json"]["filter_criteria"] for p in session.posts)
    assert first == second


def test_full_page_without_has_more_stops():
    # A full page is not a reason to keep going in v3; has_more decides.
    client, session = _client(_page([_call(call_id="a"), _call(call_id="b")]))
    df = client.fetch_calls(since=None)
    assert len(session.posts) == 1
    assert list(df["call_id"]) == ["a", "b"]


def test_has_more_without_key_stops():
    client, session = _client(FakeResponse({"items": [_call(call_id="a")], "has_more": True}))
    client.fetch_calls(since=None)
    assert len(session.posts) == 1


def test_pagination_stops_when_cursor_cannot_advance():
    # Retell hands back the same cursor twice -> stop rather than loop forever.
    page = _page([_call(call_id="a"), _call(call_id="b")], next_key="stuck")
    client, session = _client(page)
    df = client.fetch_calls(since=None)
    assert len(session.posts) == 2
    assert len(df) == 2  # same calls twice, deduped


def test_pagination_dedups_overlap_across_pages():
    # Overlapping id "b" appears on both pages; only one row survives.
    page1 = _page([_call(call_id="a"), _call(call_id="b")], next_key="k1")
    page2 = _page([_call(call_id="b"), _call(call_id="c")], next_key="k2")
    page3 = _page([_call(call_id="d")])
    client, _ = _client([page1, page2, page3])
    df = client.fetch_calls(since=None)
    assert list(df["call_id"]) == ["a", "b", "c", "d"]


# --------------------------------------------------------------------------- #
#  Envelope handling                                                          #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "body",
    [
        [{"call_id": "legacy"}],            # the old v2 bare array
        {"calls": [{"call_id": "z"}]},      # some other wrapper
        {"unexpected": "shape"},
        {"items": "not-a-list"},
    ],
)
def test_unexpected_body_raises_instead_of_returning_nothing(body):
    client, _ = _client(FakeResponse(body))
    with pytest.raises(RetellError, match="unexpected body"):
        client.fetch_calls(since=None)


def test_empty_items_is_an_empty_frame_with_schema():
    client, _ = _client(_page([]))
    df = client.fetch_calls(since=None)
    assert df.empty
    assert list(df.columns) == list(CALL_FIELDS)


# --------------------------------------------------------------------------- #
#  Errors                                                                     #
# --------------------------------------------------------------------------- #
def test_non_2xx_raises_retell_error_with_status_and_body():
    client, _ = _client(FakeResponse(None, status_code=401, text="unauthorized"))
    with pytest.raises(RetellError, match="401.*unauthorized"):
        client.fetch_calls(since=None)


def test_non_json_body_raises_retell_error():
    client, _ = _client(FakeResponse(_NO_JSON, status_code=200, text="<html>oops</html>"))
    with pytest.raises(RetellError, match="non-JSON"):
        client.fetch_calls(since=None)
