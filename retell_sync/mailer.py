#!/usr/bin/env python3
"""
retell_sync.mailer
==================
M365 delivery for the lead follow-up SLA digest.

:mod:`retell_sync.sla` *detects* which after-hours callers are overdue for a
callback; this module *sends* that list as an HTML email through Microsoft Graph.
It is the one place in the alert path that does IO.

Delivery uses Graph's **app-only client-credentials flow** — no interactive user,
no delegated token — so a headless nightly task can send unattended:

1. ``POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`` with
   ``grant_type=client_credentials`` and ``scope=https://graph.microsoft.com/.default``
   to mint an application access token, then
2. ``POST https://graph.microsoft.com/v1.0/users/{sender}/sendMail`` with an HTML
   message body.

The app registration holds the **application** permission ``Mail.Send`` (admin
consented), scoped down to the single sender mailbox by an *Application Access
Policy* so the app can't mail as anyone else in the tenant. See ``SETUP.md``.

No new dependency
-----------------
This talks HTTP with :mod:`requests` (already a dependency for the Retell/Odoo
clients) rather than pulling in ``msal`` or the Graph SDK — the client-credentials
flow is two plain POSTs. The ``session`` is injectable so tests exercise the token
+ send handshake against a fake without touching the network.

Purity boundary
---------------
:func:`build_digest_html` is pure — an overdue frame plus the link templates in,
an HTML string out — so the rendered digest can be asserted in tests with no
network. Only :func:`send_digest` (and its two helpers) touch HTTP.
"""

from __future__ import annotations

import html
import logging
from collections.abc import Sequence
from datetime import UTC, datetime

import pandas as pd
import requests

from .config import AlertConfig

log = logging.getLogger("retell_sync.mailer")

__all__ = [
    "MailerError",
    "TOKEN_URL_TEMPLATE",
    "SENDMAIL_URL_TEMPLATE",
    "GRAPH_SCOPE",
    "build_digest_subject",
    "build_rep_digest_subject",
    "build_digest_html",
    "build_scorecard_subject",
    "build_scorecard_html",
    "send_digest",
]

#: Azure AD v2 token endpoint (client-credentials). ``{tenant}`` -> tenant id.
TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

#: Graph sendMail endpoint. ``{sender}`` -> the ``ALERT_FROM`` mailbox UPN/address.
SENDMAIL_URL_TEMPLATE = "https://graph.microsoft.com/v1.0/users/{sender}/sendMail"

#: The ``.default`` scope: "every application permission already consented for
#: this app" — the client-credentials equivalent of naming scopes explicitly.
GRAPH_SCOPE = "https://graph.microsoft.com/.default"


class MailerError(RuntimeError):
    """Raised when the Graph token or sendMail request fails."""


# --------------------------------------------------------------------------- #
#  Digest rendering (pure)                                                     #
# --------------------------------------------------------------------------- #
def build_digest_subject(overdue: pd.DataFrame, sla_hours: float) -> str:
    """A short, scannable subject line carrying the overdue count."""
    n = len(overdue)
    caller = "caller" if n == 1 else "callers"
    return f"[retell-sync] {n} after-hours {caller} overdue past {sla_hours:.0f}h"


def build_rep_digest_subject(overdue: pd.DataFrame, sla_hours: float) -> str:
    """Subject for a single salesperson's own overdue-lead digest ("Your N …")."""
    n = len(overdue)
    caller = "caller" if n == 1 else "callers"
    return f"[retell-sync] Your {n} after-hours {caller} overdue past {sla_hours:.0f}h"


def build_digest_html(
    overdue: pd.DataFrame,
    links: dict[str, str | None],
    sla_hours: float,
    *,
    generated_at: datetime | None = None,
) -> str:
    """Render the overdue frame as a single self-contained HTML digest.

    ``overdue`` is the :data:`~retell_sync.sla.OVERDUE_FIELDS` frame; ``links`` is
    the :func:`~retell_sync.output.build_links` mapping whose ``retell_call`` /
    ``odoo_lead`` templates carry a ``{call_id}`` / ``{lead_id}`` placeholder each.
    Every cell is HTML-escaped; a row's Odoo/Retell link is emitted only when both
    the template and the row's id are present, so a missing Odoo base (or a row with
    no call id) simply drops that one anchor instead of breaking the table.

    Pure: no IO, no clock read unless ``generated_at`` is omitted (then "now" is
    stamped into the footer). Styling is inline because email clients strip
    ``<style>`` blocks.
    """
    stamp = generated_at or datetime.now(UTC)
    rows = "".join(_digest_row(row, links) for _, row in overdue.iterrows())
    count = len(overdue)
    caller = "caller" if count == 1 else "callers"

    th = (
        'style="text-align:left;padding:8px 12px;border-bottom:2px solid #d0d0d0;'
        'font-size:13px;color:#444;"'
    )
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;color:#222;max-width:820px;">'
        f'<h2 style="margin:0 0 4px;">After-hours callback SLA digest</h2>'
        f'<p style="margin:0 0 16px;color:#555;">'
        f"<strong>{count}</strong> after-hours {caller} overdue for a callback past "
        f"{sla_hours:.0f}h. Most overdue first."
        "</p>"
        '<table style="border-collapse:collapse;width:100%;font-size:14px;">'
        "<thead><tr>"
        f"<th {th}>Overdue</th>"
        f"<th {th}>Client</th>"
        f"<th {th}>Phone</th>"
        f"<th {th}>Sales rep</th>"
        f"<th {th}>Stage</th>"
        f"<th {th}>Links</th>"
        "</tr></thead>"
        f"<tbody>{rows}</tbody>"
        "</table>"
        f'<p style="margin:16px 0 0;color:#999;font-size:12px;">'
        f"Generated {html.escape(pd.Timestamp(stamp).isoformat())} by retell-sync."
        "</p>"
        "</div>"
    )


def build_scorecard_subject(scorecard: pd.DataFrame) -> str:
    """A short subject line carrying the rep count for the weekly scorecard."""
    n = len(scorecard)
    rep = "salesperson" if n == 1 else "salespeople"
    return f"[retell-sync] Weekly rep scorecard — {n} {rep}"


def build_scorecard_html(
    scorecard: pd.DataFrame,
    *,
    window_label: str | None = None,
    generated_at: datetime | None = None,
) -> str:
    """Render the per-rep scorecard frame as a self-contained ranked HTML table.

    ``scorecard`` is the :data:`~retell_sync.scorecard.SCORE_FIELDS` frame (already
    ranked). ``window_label`` names the reporting window in the header when given.
    Pure: no IO, no clock read unless ``generated_at`` is omitted. Inline-styled
    because email clients strip ``<style>`` blocks; every cell is escaped.
    """
    stamp = generated_at or datetime.now(UTC)
    rows = "".join(
        _scorecard_row(rank, row) for rank, (_, row) in enumerate(scorecard.iterrows(), start=1)
    )
    scope = f" for {html.escape(window_label)}" if window_label else ""

    th = (
        'style="text-align:left;padding:8px 12px;border-bottom:2px solid #d0d0d0;'
        'font-size:13px;color:#444;"'
    )
    thnum = th.replace("text-align:left", "text-align:right")
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;color:#222;max-width:820px;">'
        '<h2 style="margin:0 0 4px;">Weekly rep scorecard</h2>'
        f'<p style="margin:0 0 16px;color:#555;">'
        f"After-hours performance by salesperson{scope}, ranked by won revenue."
        "</p>"
        '<table style="border-collapse:collapse;width:100%;font-size:14px;">'
        "<thead><tr>"
        f"<th {th}>#</th>"
        f"<th {th}>Salesperson</th>"
        f"<th {thnum}>Calls</th>"
        f"<th {thnum}>Leads</th>"
        f"<th {thnum}>Won</th>"
        f"<th {thnum}>Won revenue</th>"
        f"<th {thnum}>Win rate</th>"
        f"<th {thnum}>Overdue now</th>"
        "</tr></thead>"
        f"<tbody>{rows}</tbody>"
        "</table>"
        f'<p style="margin:16px 0 0;color:#999;font-size:12px;">'
        f"Generated {html.escape(pd.Timestamp(stamp).isoformat())} by retell-sync."
        "</p>"
        "</div>"
    )


def _scorecard_row(rank: int, row: pd.Series) -> str:
    """Render one salesperson as a ranked ``<tr>`` (all cells escaped)."""
    td = 'style="padding:8px 12px;border-bottom:1px solid #eee;"'
    tdnum = td.replace("padding:8px 12px;", "padding:8px 12px;text-align:right;")

    rep = _text(row.get("rep")) or "—"
    calls = _int_text(row.get("calls"))
    leads = _int_text(row.get("matched_leads"))
    won = _int_text(row.get("won_deals"))
    revenue = _money_text(row.get("won_revenue"))
    win_rate = _pct_text(row.get("win_rate"))
    overdue = _int_text(row.get("overdue_now"))

    return (
        "<tr>"
        f'<td {td}><strong>{rank}</strong></td>'
        f"<td {td}>{html.escape(rep)}</td>"
        f"<td {tdnum}>{html.escape(calls)}</td>"
        f"<td {tdnum}>{html.escape(leads)}</td>"
        f"<td {tdnum}>{html.escape(won)}</td>"
        f"<td {tdnum}>{html.escape(revenue)}</td>"
        f"<td {tdnum}>{html.escape(win_rate)}</td>"
        f"<td {tdnum}>{html.escape(overdue)}</td>"
        "</tr>"
    )


def _int_text(value: object) -> str:
    """Integer cell with thousands separators, or ``"0"`` for missing."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or value is pd.NA:
        return "0"
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return "0"


def _money_text(value: object) -> str:
    """Whole-dollar cell (e.g. ``$3,849``), or ``"$0"`` for missing."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or value is pd.NA:
        return "$0"
    try:
        return f"${float(value):,.0f}"
    except (TypeError, ValueError):
        return "$0"


def _pct_text(value: object) -> str:
    """Fraction (0..1) as a whole-ish percent (e.g. ``12.1%``), or ``"—"``."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or value is pd.NA:
        return "—"
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return "—"


def _digest_row(row: pd.Series, links: dict[str, str | None]) -> str:
    """Render one overdue lead as a ``<tr>`` (all cells escaped)."""
    td = 'style="padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top;"'

    hours = row.get("hours_overdue")
    hours_txt = f"{float(hours):.1f}h" if pd.notna(hours) else "—"
    name = _text(row.get("lead_name")) or "—"
    phone = _text(row.get("phone_key")) or "—"
    rep = _text(row.get("sales_rep")) or "—"
    stage = _text(row.get("stage_label")) or "—"

    anchors = []
    odoo = _fill(links.get("odoo_lead"), "{lead_id}", row.get("lead_id"))
    if odoo:
        anchors.append(f'<a href="{html.escape(odoo, quote=True)}">Odoo lead</a>')
    retell = _fill(links.get("retell_call"), "{call_id}", row.get("call_id"))
    if retell:
        anchors.append(f'<a href="{html.escape(retell, quote=True)}">Retell call</a>')
    link_cell = " &middot; ".join(anchors) if anchors else "—"

    return (
        "<tr>"
        f'<td {td}><strong>{html.escape(hours_txt)}</strong></td>'
        f"<td {td}>{html.escape(name)}</td>"
        f"<td {td}>{html.escape(phone)}</td>"
        f"<td {td}>{html.escape(rep)}</td>"
        f"<td {td}>{html.escape(stage)}</td>"
        f"<td {td}>{link_cell}</td>"
        "</tr>"
    )


def _text(value: object) -> str:
    """Trimmed string form of a cell, or ``""`` for a missing value."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or value is pd.NA:
        return ""
    return str(value).strip()


def _fill(template: str | None, placeholder: str, value: object) -> str | None:
    """Substitute ``placeholder`` in ``template`` with ``value``; ``None`` if unusable.

    Returns ``None`` when there is no template or no id, so the caller can simply
    skip that anchor rather than emit a half-formed URL.
    """
    ident = _text(value)
    if not template or not ident or placeholder not in template:
        return None
    return template.replace(placeholder, ident)


# --------------------------------------------------------------------------- #
#  Send (IO)                                                                   #
# --------------------------------------------------------------------------- #
def send_digest(
    cfg: AlertConfig,
    *,
    subject: str,
    html_body: str,
    recipients: Sequence[str] | None = None,
    session: requests.Session | None = None,
    timeout: float = 30.0,
) -> None:
    """Send ``html_body`` via Graph to ``recipients`` (or ``cfg.alert_recipients``).

    ``cfg`` must already carry the Graph secrets and sender — the caller validates
    them with :meth:`~retell_sync.config.AlertConfig.require_graph` before calling.
    ``recipients`` overrides ``cfg.alert_recipients`` for a targeted send (the
    per-rep digest passes the one salesperson's address); when omitted, the digest
    goes to the configured manager recipients. Mints an app-only token, then POSTs
    ``sendMail``; any network or non-2xx response is wrapped as :class:`MailerError`.
    """
    to = tuple(recipients) if recipients is not None else tuple(cfg.alert_recipients)
    sess = session or requests.Session()
    token = _fetch_token(cfg, sess, timeout)
    _send_mail(cfg, token, subject, html_body, to, sess, timeout)
    log.info("SLA digest sent to %d recipient(s)", len(to))


def _fetch_token(cfg: AlertConfig, session: requests.Session, timeout: float) -> str:
    """Mint an app-only Graph access token via the client-credentials grant."""
    url = TOKEN_URL_TEMPLATE.format(tenant=cfg.graph_tenant_id)
    data = {
        "client_id": cfg.graph_client_id,
        "client_secret": cfg.graph_client_secret,
        "scope": GRAPH_SCOPE,
        "grant_type": "client_credentials",
    }
    try:
        resp = session.post(url, data=data, timeout=timeout)
    except requests.RequestException as exc:  # network-level failure
        raise MailerError(f"Graph token request failed: {exc}") from exc

    if not resp.ok:
        raise MailerError(f"Graph token {resp.status_code}: {(resp.text or '')[:500]}")
    try:
        token = resp.json().get("access_token")
    except ValueError as exc:
        raise MailerError(
            f"Graph token returned non-JSON body: {resp.text[:200]!r}"
        ) from exc
    if not token:
        raise MailerError("Graph token response contained no access_token.")
    return str(token)


def _send_mail(
    cfg: AlertConfig,
    token: str,
    subject: str,
    html_body: str,
    recipients: Sequence[str],
    session: requests.Session,
    timeout: float,
) -> None:
    """POST the HTML message to Graph ``sendMail`` as the configured sender."""
    url = SENDMAIL_URL_TEMPLATE.format(sender=cfg.alert_from)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html_body},
            "toRecipients": [
                {"emailAddress": {"address": addr}} for addr in recipients
            ],
        },
        "saveToSentItems": True,
    }
    try:
        resp = session.post(url, json=payload, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise MailerError(f"Graph sendMail request failed: {exc}") from exc
    if not resp.ok:
        raise MailerError(f"Graph sendMail {resp.status_code}: {(resp.text or '')[:500]}")
