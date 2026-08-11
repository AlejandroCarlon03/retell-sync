#!/usr/bin/env python3
"""
retell_sync.odoo
================
Odoo CRM read client — pulls ``crm.lead`` records for the conversion join.

This is a faithful Python port of the request shape used by the production
Zapier "inbound call enrichment" Code step
(``RetellAI/odoo-crm-inbound-call-enrichment.js``):

* ``POST {ODOO_URL}/<model>/search_read`` with a ``Bearer`` token,
* responses optionally wrapped as ``{"result": ...}`` are unwrapped,
* phones are compared on their **last 10 digits**.

Two deliberate differences from the JS, both required by the analytics use case
(see ``master_plan.md`` gotchas):

* **Archived leads are included.** A *lost* opportunity is archived in Odoo
  (``active = false``); the JS filters ``["active", "=", true]`` and so never
  sees losses. Here we disable ``active_test`` (via request ``context`` *and*
  by never constraining ``active`` in the domain) so the "lost" arm of the
  funnel is not silently dropped.
* **We select by time window, not by a single phone.** ``search_leads(since)``
  pulls every lead touched since ``since`` into a DataFrame; the phone join
  happens later, in ``conversion.py``, against the Retell call set.

Read-only: this module only ever issues ``search_read``. It never writes to
Odoo.

Secrets come from :class:`retell_sync.config.OdooConfig` (env-backed); nothing
is hard-coded here.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

import pandas as pd
import requests

from .config import OdooConfig

log = logging.getLogger("retell_sync.odoo")

__all__ = [
    "normalize_phone",
    "OdooClient",
    "OdooError",
    "LEAD_FIELDS",
    "USER_FIELDS",
]

#: Fields requested for every ``crm.lead`` row, and the exact column order of the
#: DataFrame returned by :meth:`OdooClient.search_leads`. ``user_id`` and
#: ``stage_id`` come back as Odoo many2one pairs (``[id, display_name]``) or
#: ``False`` when empty; they are stored raw so the conversion step can use
#: either the id or the label.
#:
#: NB: the master plan also lists ``mobile``, but this Odoo instance's
#: ``crm.lead`` has no ``mobile`` field (verified via ``fields_get`` against live
#: prod, 2026-08-04) — requesting it 500s. Leads carry a single ``phone``, so the
#: phone join runs on ``phone`` alone.
LEAD_FIELDS: tuple[str, ...] = (
    "id",
    "name",
    "phone",
    "user_id",
    "stage_id",
    "probability",
    "type",
    "expected_revenue",
    "date_closed",
    "active",
    "create_date",
    "write_date",
)

#: Fields requested from ``res.users`` for per-rep alert routing — the salesperson
#: display ``name`` (which matches a lead's ``user_id`` label, i.e. the ``sales_rep``
#: column) and their ``email``.
USER_FIELDS: tuple[str, ...] = ("id", "name", "email")

#: Odoo serializes datetimes in this (UTC, naive) format for domain comparisons.
_ODOO_DT_FMT = "%Y-%m-%d %H:%M:%S"

_NON_DIGITS = re.compile(r"\D")


class OdooError(RuntimeError):
    """Raised when an Odoo request fails (non-2xx) or returns an unusable body."""


# --------------------------------------------------------------------------- #
#  Phone normalization                                                         #
# --------------------------------------------------------------------------- #
def normalize_phone(value: Any) -> str:
    """
    Reduce any phone-ish value to its **last 10 digits**.

    This is the join key for both sides of the analysis (Retell ``from_number``
    and Odoo ``phone``). Taking the last 10 digits makes a US number match
    regardless of formatting or a leading country code:

    >>> normalize_phone("+1 (480) 555-1234")
    '4805551234'
    >>> normalize_phone("480-555-1234")
    '4805551234'
    >>> normalize_phone("14805551234")     # leading country code dropped
    '4805551234'
    >>> normalize_phone(4805551234)        # non-string input is coerced
    '4805551234'

    Values with no digits (``None``, ``""``, ``"n/a"``) yield ``""``. Numbers
    with fewer than 10 digits are returned in full rather than padded, so short
    or malformed entries can't accidentally collide on a 10-digit key:

    >>> normalize_phone(None)
    ''
    >>> normalize_phone("555-1234")
    '5551234'
    """
    if value is None:
        return ""
    digits = _NON_DIGITS.sub("", str(value))
    return digits[-10:]


# --------------------------------------------------------------------------- #
#  Client                                                                      #
# --------------------------------------------------------------------------- #
def _format_since(since: datetime | date | str | None) -> str | None:
    """Coerce ``since`` into the ``YYYY-MM-DD HH:MM:SS`` string Odoo expects."""
    if since is None:
        return None
    if isinstance(since, str):
        return since
    if isinstance(since, datetime):
        return since.strftime(_ODOO_DT_FMT)
    if isinstance(since, date):
        # A bare date means "from the very start of that day".
        return datetime(since.year, since.month, since.day).strftime(_ODOO_DT_FMT)
    raise TypeError(f"since must be datetime, date, str, or None; got {type(since)!r}")


class OdooClient:
    """
    Thin, read-only client over the Odoo REST ``search_read`` endpoint.

    Parameters
    ----------
    config:
        Odoo connection config. Its URL and API key are validated
        (:meth:`OdooConfig.require`) on construction, so a client always has
        usable credentials.
    session:
        Optional :class:`requests.Session` (injected in tests). A fresh session
        is created if omitted.
    timeout:
        Per-request timeout in seconds.
    """

    def __init__(
        self,
        config: OdooConfig,
        *,
        session: requests.Session | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._config = config.require()
        self._base_url = str(self._config.url).rstrip("/")
        self._session = session or requests.Session()
        self._timeout = timeout

    # -- low-level -------------------------------------------------------- #
    def _post(self, path: str, payload: dict[str, Any]) -> Any:
        """
        POST ``payload`` to ``{base}/{path}`` and return the unwrapped body.

        Mirrors the reference JS ``odoo()`` helper: bearer auth, raise on
        non-2xx with the response text, and unwrap a ``{"result": ...}``
        envelope when the proxy adds one.
        """
        url = f"{self._base_url}/{path.lstrip('/')}"
        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = self._session.post(url, json=payload, headers=headers, timeout=self._timeout)
        except requests.RequestException as exc:  # network-level failure
            raise OdooError(f"Odoo {path} request failed: {exc}") from exc

        if not resp.ok:
            body = (resp.text or "")[:500]
            raise OdooError(f"Odoo {path} {resp.status_code}: {body}")

        try:
            data = resp.json()
        except ValueError as exc:
            raise OdooError(f"Odoo {path} returned non-JSON body: {resp.text[:200]!r}") from exc

        # Some Odoo proxies wrap responses as {"result": ...}; normalize.
        if isinstance(data, dict) and "result" in data:
            return data["result"]
        return data

    def search_read(
        self,
        model: str,
        *,
        domain: Sequence[Any],
        fields: Sequence[str],
        order: str | None = None,
        limit: int | None = None,
        context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Call ``<model>/search_read`` and return the record list.

        Always returns a list: a non-list body (``False``/``None`` from Odoo on
        an empty match) is coerced to ``[]`` so callers never branch on type.
        """
        payload: dict[str, Any] = {"domain": list(domain), "fields": list(fields)}
        if order is not None:
            payload["order"] = order
        if limit is not None:
            payload["limit"] = limit
        if context is not None:
            payload["context"] = context

        records = self._post(f"{model}/search_read", payload)
        if not isinstance(records, list):
            return []
        return records

    # -- leads ------------------------------------------------------------ #
    def build_leads_payload(self, since: datetime | date | str | None = None) -> dict[str, Any]:
        """
        Construct the ``crm.lead/search_read`` request payload.

        Split out from :meth:`search_leads` so the domain/context construction is
        directly unit-testable without any HTTP.

        The domain filters by ``write_date >= since`` (leads *touched* in the
        window) and — critically — does **not** constrain ``active``. Combined
        with ``context={"active_test": False}``, archived (lost) leads are
        returned. Ordering by ``write_date desc`` matches the JS multi-match
        tie-break (most-recently-touched wins).
        """
        domain: list[Any] = []
        since_str = _format_since(since)
        if since_str is not None:
            domain.append(["write_date", ">=", since_str])

        return {
            "domain": domain,
            "fields": list(LEAD_FIELDS),
            "order": "write_date desc",
            "context": {"active_test": False},
        }

    def search_leads(self, since: datetime | date | str | None = None) -> pd.DataFrame:
        """
        Pull ``crm.lead`` rows touched since ``since`` into a DataFrame.

        Returns a DataFrame whose columns are exactly :data:`LEAD_FIELDS`, in
        that order, even when no leads match (empty frame with the right
        schema). Lost/archived leads are included — see
        :meth:`build_leads_payload`.

        Read-only. Issues a single ``search_read`` (no pagination: the analytics
        window is small and Odoo returns the full match set).
        """
        payload = self.build_leads_payload(since)
        records = self.search_read(
            "crm.lead",
            domain=payload["domain"],
            fields=payload["fields"],
            order=payload["order"],
            context=payload["context"],
        )
        log.info("Fetched %d Odoo lead(s) since %s", len(records), since)
        return _leads_to_frame(records)

    # -- users ------------------------------------------------------------ #
    def fetch_user_emails(self) -> dict[str, str]:
        """Return a ``{salesperson display name: email}`` map from ``res.users``.

        Used for per-rep alert routing: a lead's ``sales_rep`` is the ``user_id``
        display name, and this maps that name to the user's email. Only *internal*
        users are read (``share = False`` excludes portal/public users), and users
        with no email are omitted, so the map contains only usable routes. On a name
        collision the last record wins (rare among internal salespeople). Read-only.
        """
        records = self.search_read(
            "res.users",
            domain=[["share", "=", False]],
            fields=list(USER_FIELDS),
        )
        emails: dict[str, str] = {}
        for rec in records:
            name = rec.get("name")
            email = rec.get("email")
            if isinstance(name, str) and isinstance(email, str) and name.strip() and email.strip():
                emails[name.strip()] = email.strip()
        log.info("Fetched %d Odoo user email(s)", len(emails))
        return emails


def _leads_to_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    """
    Build a leads DataFrame with a stable :data:`LEAD_FIELDS` schema.

    Guarantees the full column set and order regardless of what the API omitted,
    so downstream code can rely on the columns existing even for an empty pull.
    """
    frame = pd.DataFrame(records, columns=list(LEAD_FIELDS))
    return frame
