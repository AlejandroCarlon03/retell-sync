#!/usr/bin/env python3
"""
retell_sync.config
==================
Typed configuration for the whole project.

Every tunable lives here so the rest of the package never hard-codes a threshold
or an endpoint. Secrets (API keys, the Odoo URL) come from the environment, never
from source — :meth:`AppConfig.from_env` reads them, optionally after loading a
local ``.env`` file.

Design notes
------------
* Config **construction never fails on missing secrets.** A blank ``RETELL_API_KEY``
  is fine until something actually tries to call Retell; that is when
  :meth:`RetellConfig.require` is invoked. This keeps unit tests and ``--help``
  working with no credentials present.
* :meth:`AppConfig.from_env` accepts an explicit ``env`` mapping (defaulting to
  ``os.environ``) so tests can exercise parsing hermetically, without touching the
  real process environment.

Example
-------
>>> cfg = AppConfig.default()
>>> cfg.business_hours.start_hour
8
>>> cfg.conversion.lookback_days
35
"""

from __future__ import annotations

import dataclasses
import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "BusinessHoursConfig",
    "RetellConfig",
    "OdooConfig",
    "ConversionConfig",
    "AlertConfig",
    "PathsConfig",
    "AppConfig",
    "ConfigError",
    "ALERT_SETTINGS_FILENAME",
    "load_alert_settings",
]

#: Name of the runtime alert-settings file, written by the dashboard's Settings
#: page and read back here. It lives in :attr:`PathsConfig.data_dir` (gitignored,
#: server-local, survives ``git pull``) and is the bridge between the .NET host's
#: ``PUT /api/settings`` and Python's config. It never holds secrets — only the
#: recipient list, the SLA window, and the on/off switch. The Graph credentials
#: stay in the machine environment.
ALERT_SETTINGS_FILENAME = "alert_settings.json"


class ConfigError(RuntimeError):
    """Raised when a required piece of configuration (usually a secret) is absent."""


# --------------------------------------------------------------------------- #
#  Sub-configs                                                                 #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class BusinessHoursConfig:
    """
    What counts as "business hours"; everything else is after-hours.

    At DKB the Retell agent *is* the after-hours line: a call only reaches it when
    the office cannot take it, so **every call Retell receives is an after-hours
    call**, regardless of its clock time. That is what ``all_calls_after_hours``
    (the default) encodes — the classification short-circuits to after-hours for
    every call. The clock-based fields below are only consulted when that flag is
    turned off (e.g. for a phone line that takes calls during business hours too).

    When clock-based: a call is after-hours when it lands outside
    ``[start_hour, end_hour)`` or on a non-workday. ``end_hour`` is exclusive, so
    ``end_hour=17`` means the last in-hours calls start at 16:59.
    ``start_hour``/``end_hour``/``workdays`` are interpreted in ``tz`` — the wall
    clock the business actually runs on. Retell reports call times in UTC, so the
    conversion step converts each timestamp into ``tz`` before deciding. DKB is in
    Arizona, which does not observe DST; ``America/Phoenix`` keeps the boundary
    stable year-round.
    """

    #: When True (the default for the Retell after-hours line), every call is
    #: classified after-hours and the clock fields below are ignored.
    all_calls_after_hours: bool = True
    start_hour: int = 8
    end_hour: int = 17
    workdays: tuple[int, ...] = (0, 1, 2, 3, 4)  # Monday=0 .. Sunday=6
    tz: str = "America/Phoenix"


@dataclass(frozen=True)
class RetellConfig:
    """How to reach the Retell AI API and how much history to pull."""

    api_key: str | None = None
    base_url: str = "https://api.retellai.com"
    page_size: int = 1000
    lookback_days: int = 35
    #: Base URL of the Retell *dashboard* (the web UI), used only to build
    #: click-through links to a call's transcript in :mod:`retell_sync.output`.
    #: This is the human dashboard, distinct from ``base_url`` (the REST API).
    dashboard_url: str = "https://dashboard.retellai.com"
    #: Full override for the call-link template, with a ``{call_id}`` placeholder
    #: (e.g. ``https://dashboard.retellai.com/call-history/{call_id}``). When set,
    #: it wins over ``dashboard_url``; use it when your dashboard's per-call path
    #: differs from the default ``{dashboard_url}/calls/{call_id}``.
    call_url_template: str | None = None

    def require(self) -> RetellConfig:
        """Return self, or raise :class:`ConfigError` if the API key is missing."""
        if not self.api_key:
            raise ConfigError(
                "RETELL_API_KEY is not set. Copy .env.example to .env and fill it in, "
                "or export RETELL_API_KEY in the environment."
            )
        return self


@dataclass(frozen=True)
class OdooConfig:
    """How to reach the Odoo CRM REST API. Same variables the Zapier steps use."""

    url: str | None = None
    api_key: str | None = None
    #: Base URL of the Odoo *web UI* (e.g. ``https://dkbinc.co``), used only to
    #: build click-through links to a lead's form in :mod:`retell_sync.output`.
    #: Distinct from ``url``, which is the REST endpoint the Zapier steps hit and
    #: may be a proxy. When unset, no Odoo lead links are emitted. The link uses
    #: the modern ``{web_url}/odoo/crm/{lead_id}`` path.
    web_url: str | None = None
    #: Full override for the lead-link template, with a ``{lead_id}`` placeholder
    #: (e.g. ``https://dkbinc.co/odoo/crm/{lead_id}``). When set, it wins over
    #: ``web_url``; use it if your Odoo lead path differs from the default.
    lead_url_template: str | None = None

    def require(self) -> OdooConfig:
        """Return self, or raise :class:`ConfigError` if URL/key are missing."""
        pairs = (("ODOO_URL", self.url), ("ODOO_API_KEY", self.api_key))
        missing = [name for name, val in pairs if not val]
        if missing:
            raise ConfigError(
                f"{', '.join(missing)} not set. Copy .env.example to .env and fill it in, "
                "or export the variable(s) in the environment."
            )
        return self


@dataclass(frozen=True)
class ConversionConfig:
    """Funnel definition and join settings for the conversion analysis."""

    #: How many days back to pull calls and leads for the join.
    lookback_days: int = 35

    #: Grace window, in hours, for attributing a *new* client to an after-hours
    #: call. A matched lead counts as "new from after-hours" when its Odoo
    #: ``create_date`` is no earlier than the caller's first after-hours call
    #: minus this window — i.e. the lead did not exist before they called, so the
    #: after-hours call is what brought them in. The window absorbs the small lag
    #: between the call landing and the Zapier inbound-call step creating the lead
    #: (and any clock skew between Retell and Odoo). Widen it if genuine new
    #: callers are being missed; tighten it if pre-existing clients leak in.
    new_client_grace_hours: float = 12.0

    #: Ordered canonical funnel positions. ``"won"`` is the terminal success
    #: stage (kept last); ``"lost"`` is terminal-failure and lives *off* this
    #: ordering. A lead's raw Odoo stage is mapped onto one of these via
    #: :attr:`stage_rules`, so this stays a clean, presentation-friendly funnel
    #: even when the CRM's own stage names are messy.
    funnel_stage_order: tuple[str, ...] = (
        "new",
        "qualified",
        "proposition",
        "won",
    )

    #: Ordered ``(substring, category)`` rules mapping a raw Odoo stage name onto
    #: a canonical category. The **first** rule whose (lower-cased) substring
    #: appears in the stage name wins, so list the most specific / terminal rules
    #: first. ``category`` is either ``"lost"`` (terminal failure) or one of
    #: :attr:`funnel_stage_order` (``"won"`` being terminal success). A stage that
    #: matches no rule is left unclassified (off the funnel, neither won nor lost).
    #:
    #: Classification is by **stage name only** — DKB's Odoo sets high win
    #: probabilities on dead leads (e.g. "Bad Lead"/"Lost" sit at 96–100%), so
    #: probability is not a usable success signal here.
    #:
    #: The defaults below cover both generic Odoo stages (new/qualified/
    #: proposition/won) and DKB's live taxonomy (Bad Lead, Junk, Measure
    #: Scheduled, Quoted Customer, Finalized - Submitted Order, Completed, Lost).
    #: Add or reorder rules here when the CRM's stages change.
    stage_rules: tuple[tuple[str, str], ...] = (
        # Terminal failure — checked first so a dead lead never falls through.
        ("junk", "lost"),
        ("bad lead", "lost"),
        ("lost", "lost"),
        # Terminal success.
        ("submitted order", "won"),
        ("finalized", "won"),
        ("completed", "won"),
        ("won", "won"),
        # Open funnel, latest → earliest.
        ("proposition", "proposition"),
        ("quoted", "proposition"),
        ("qualified", "qualified"),
        ("measure", "qualified"),
        ("new", "new"),
        ("need info", "new"),
        ("imported", "new"),
        ("assign", "new"),
    )


@dataclass(frozen=True)
class AlertConfig:
    """Lead follow-up SLA digest — when an after-hours caller hasn't been called back.

    A matched after-hours caller is *overdue* when their call is older than
    :attr:`sla_hours` and the rep hasn't yet advanced the lead's stage (the callback
    signal): the lead is still at the funnel's entry level **or** its raw stage name
    is one of :attr:`unactioned_stages`, and it is not won/lost. Detection
    (:mod:`retell_sync.sla`) uses only columns already produced by the conversion
    join — no new Odoo pull.

    Delivery (PR B) sends the digest as an M365 email through Microsoft Graph with
    the app-only client-credentials flow. The Graph app-registration **secrets**
    (:attr:`graph_tenant_id`/:attr:`graph_client_id`/:attr:`graph_client_secret`),
    the sender mailbox (:attr:`alert_from`), and the recipients
    (:attr:`alert_recipients`, env ``ALERT_TO``) come from machine environment
    variables — read by :meth:`AppConfig.from_env`, never hard-coded. Nothing is
    required until a send is actually attempted, which is what :meth:`require_graph`
    guards; a dry-run preview and the detection tests stay credential-free.
    """

    #: Master on/off switch for the digest. Off by default so the feature is inert
    #: until an operator turns it on (and sets a recipient via ``ALERT_TO``).
    enabled: bool = False

    #: Age, in hours, past which an un-actioned after-hours caller is overdue.
    sla_hours: float = 48.0

    #: Raw Odoo stage names that count as *not yet actioned* even if they don't map
    #: to the funnel's entry level. The entry level (funnel position 0) is always
    #: treated as un-actioned; this is the env-overridable backstop for DKB's
    #: freshly-created stages, so the signal survives a change to the funnel rules.
    #: Matched case-insensitively against the whole stage label.
    unactioned_stages: tuple[str, ...] = (
        "Imported - Need to Assign Stage",
        "New Customer / Need Info",
    )

    # --- M365 / Microsoft Graph send (client-credentials flow) --------------- #
    #: The Entra tenant the Graph app registration lives in (env ``GRAPH_TENANT_ID``).
    graph_tenant_id: str | None = None
    #: The Graph app registration's application (client) id (env ``GRAPH_CLIENT_ID``).
    graph_client_id: str | None = None
    #: The app registration's client secret (env ``GRAPH_CLIENT_SECRET``). App-only
    #: ``Mail.Send`` is scoped to the sender mailbox via an Application Access Policy.
    graph_client_secret: str | None = None
    #: The mailbox the digest is sent *from* (env ``ALERT_FROM``) — a UPN/address in
    #: the tenant the Application Access Policy grants the app access to.
    alert_from: str | None = None
    #: Recipients of the digest. Seeded from env ``ALERT_TO`` (comma-separated) and
    #: overridable at runtime by the in-app recipient editor, which writes
    #: ``<data_dir>/alert_settings.json`` (see :data:`ALERT_SETTINGS_FILENAME` and
    #: :func:`load_alert_settings`). Precedence: settings file > env > default.
    alert_recipients: tuple[str, ...] = ()

    # --- Per-salesperson routing --------------------------------------------- #
    #: When on, *in addition to* the manager digest sent to :attr:`alert_recipients`,
    #: each salesperson is emailed a digest of only their own overdue leads (env
    #: ``RETELL_ALERT_PER_REP``). Off by default. Rep→email comes from Odoo
    #: ``res.users`` (matched on the salesperson display name), with
    #: :attr:`rep_email_overrides` filling any gaps.
    per_rep_enabled: bool = False

    #: Manual salesperson-name → email overrides for reps whose Odoo user has no
    #: email (or a wrong one). Parsed from env ``ALERT_REP_EMAILS`` as
    #: ``"Name=addr;Other Name=addr2"``. An override always wins over the Odoo
    #: lookup. Names are matched case-insensitively against the lead's ``sales_rep``.
    rep_email_overrides: tuple[tuple[str, str], ...] = ()

    # --- Weekly rep scorecard (manager leaderboard) -------------------------- #
    #: Master on/off for the weekly per-rep scorecard email (env
    #: ``RETELL_SCORECARD_ENABLED``). Independent of :attr:`enabled` (the overdue
    #: digest), so a site can run one without the other.
    scorecard_enabled: bool = False

    #: Recipients of the scorecard (env ``RETELL_SCORECARD_TO``, comma-separated).
    #: When empty, the scorecard falls back to :attr:`alert_recipients` (``ALERT_TO``)
    #: — managers typically want both, so the default shares one recipient list.
    scorecard_recipients: tuple[str, ...] = ()

    def scorecard_to(self) -> tuple[str, ...]:
        """Resolved scorecard recipients: the dedicated list, else the digest's."""
        return self.scorecard_recipients or self.alert_recipients

    def require_graph(
        self,
        recipients: tuple[str, ...] | None = None,
        recipient_var: str = "ALERT_TO",
    ) -> AlertConfig:
        """Return self, or raise :class:`ConfigError` if any M365 send field is absent.

        Called only when a send is actually attempted (``alert``/``scorecard`` without
        ``--dry-run``, or a ``run`` with the digest enabled), so ``--help``, dry-run
        previews, and the detection tests never need the Graph credentials.

        By default the required recipient list is :attr:`alert_recipients` (``ALERT_TO``).
        A caller with its own recipients — e.g. the scorecard — passes them (and the env
        var name for the error message) so the right list is validated.
        """
        pairs = (
            ("GRAPH_TENANT_ID", self.graph_tenant_id),
            ("GRAPH_CLIENT_ID", self.graph_client_id),
            ("GRAPH_CLIENT_SECRET", self.graph_client_secret),
            ("ALERT_FROM", self.alert_from),
        )
        to = self.alert_recipients if recipients is None else recipients
        missing = [name for name, val in pairs if not val]
        if not to:
            missing.append(recipient_var)
        if missing:
            raise ConfigError(
                f"{', '.join(missing)} not set. The SLA digest needs the Microsoft Graph "
                "app-registration secrets and a recipient; set them as machine environment "
                "variables (see SETUP.md)."
            )
        return self


@dataclass(frozen=True)
class PathsConfig:
    """Filesystem layout. All paths are resolved relative to ``root``."""

    root: Path = Path(".")
    data_dir: Path = Path("data")
    output_dir: Path = Path("outputs")

    def resolved(self) -> PathsConfig:
        """Return a copy with every path made absolute against ``root``."""
        root = Path(self.root).expanduser().resolve()

        def _abs(p: Path) -> Path:
            p = Path(p).expanduser()
            return p if p.is_absolute() else root / p

        return dataclasses.replace(
            self,
            root=root,
            data_dir=_abs(self.data_dir),
            output_dir=_abs(self.output_dir),
        )

    def ensure(self) -> PathsConfig:
        """Create every output directory and return the resolved config."""
        r = self.resolved()
        for p in (r.data_dir, r.output_dir):
            p.mkdir(parents=True, exist_ok=True)
        return r


# --------------------------------------------------------------------------- #
#  Root config                                                                 #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class AppConfig:
    """Root configuration object passed through the whole package."""

    paths: PathsConfig = field(default_factory=PathsConfig)
    business_hours: BusinessHoursConfig = field(default_factory=BusinessHoursConfig)
    retell: RetellConfig = field(default_factory=RetellConfig)
    odoo: OdooConfig = field(default_factory=OdooConfig)
    conversion: ConversionConfig = field(default_factory=ConversionConfig)
    alert: AlertConfig = field(default_factory=AlertConfig)

    @classmethod
    def default(cls) -> AppConfig:
        """Configuration with every default applied and no secrets loaded."""
        return cls()

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
        *,
        load_dotenv: bool = True,
        settings_path: Path | None = None,
    ) -> AppConfig:
        """
        Build a config, pulling secrets from the environment.

        Parameters
        ----------
        env:
            Environment mapping to read. Defaults to ``os.environ``. Passing an
            explicit dict lets tests parse a fixed environment without mutating
            the real one.
        load_dotenv:
            When ``True`` (and ``env`` is not supplied), load a local ``.env`` into
            ``os.environ`` first, so a developer's ``.env`` is honoured. Never
            overrides variables already set in the real environment.
        settings_path:
            Path to the runtime alert-settings JSON. Defaults to
            ``<data_dir>/alert_settings.json`` under the resolved paths. Values
            present in this file override the env-seeded alert recipient / SLA /
            enabled fields (precedence: settings file > env > default). Passing an
            explicit path keeps tests hermetic, off the real data directory.
        """
        if env is None:
            if load_dotenv:
                _maybe_load_dotenv()
            env = os.environ

        retell = RetellConfig(
            api_key=env.get("RETELL_API_KEY") or None,
            base_url=env.get("RETELL_BASE_URL") or RetellConfig.base_url,
            dashboard_url=env.get("RETELL_DASHBOARD_URL") or RetellConfig.dashboard_url,
            call_url_template=env.get("RETELL_CALL_URL_TEMPLATE") or None,
        )
        odoo = OdooConfig(
            url=env.get("ODOO_URL") or None,
            api_key=env.get("ODOO_API_KEY") or None,
            web_url=env.get("ODOO_WEB_URL") or None,
            lead_url_template=env.get("ODOO_LEAD_URL_TEMPLATE") or None,
        )
        conversion = ConversionConfig(
            new_client_grace_hours=_float_env(
                env.get("RETELL_NEW_CLIENT_GRACE_HOURS"),
                ConversionConfig.new_client_grace_hours,
            ),
        )
        alert = AlertConfig(
            enabled=_bool_env(env.get("RETELL_ALERT_ENABLED"), AlertConfig.enabled),
            sla_hours=_float_env(env.get("RETELL_ALERT_SLA_HOURS"), AlertConfig.sla_hours),
            unactioned_stages=_tuple_env(
                env.get("RETELL_ALERT_UNACTIONED_STAGES"), AlertConfig.unactioned_stages
            ),
            graph_tenant_id=env.get("GRAPH_TENANT_ID") or None,
            graph_client_id=env.get("GRAPH_CLIENT_ID") or None,
            graph_client_secret=env.get("GRAPH_CLIENT_SECRET") or None,
            alert_from=env.get("ALERT_FROM") or None,
            alert_recipients=_tuple_env(env.get("ALERT_TO"), AlertConfig.alert_recipients),
            per_rep_enabled=_bool_env(env.get("RETELL_ALERT_PER_REP"), AlertConfig.per_rep_enabled),
            rep_email_overrides=_pairs_env(
                env.get("ALERT_REP_EMAILS"), AlertConfig.rep_email_overrides
            ),
            scorecard_enabled=_bool_env(
                env.get("RETELL_SCORECARD_ENABLED"), AlertConfig.scorecard_enabled
            ),
            scorecard_recipients=_tuple_env(
                env.get("RETELL_SCORECARD_TO"), AlertConfig.scorecard_recipients
            ),
        )

        paths = PathsConfig()
        if settings_path is None:
            settings_path = paths.resolved().data_dir / ALERT_SETTINGS_FILENAME
        alert = load_alert_settings(settings_path, alert)

        return cls(paths=paths, retell=retell, odoo=odoo, conversion=conversion, alert=alert)


# --------------------------------------------------------------------------- #
#  Runtime alert-settings file (the dashboard ↔ config bridge)                 #
# --------------------------------------------------------------------------- #
def load_alert_settings(path: Path, alert: AlertConfig) -> AlertConfig:
    """Overlay ``path``'s ``alert_settings.json`` onto ``alert``, if it exists.

    The file is written by the dashboard's Settings page and holds only the three
    operator-tunable fields — ``recipients`` (list of strings), ``sla_hours``
    (positive number), and ``enabled`` (bool). A present, valid field overrides the
    env-seeded value on ``alert``; anything missing, blank, or malformed is ignored
    so a partial or hand-mangled file degrades to the env defaults rather than
    crashing a run. A missing file is a no-op — ``alert`` is returned unchanged.

    No secrets ever live here: the Graph credentials and sender mailbox stay in the
    machine environment, untouched by this overlay.
    """
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # Missing file, unreadable, or invalid JSON: fall back to the env config.
        return alert
    if not isinstance(raw, dict):
        return alert

    updates: dict[str, object] = {}

    recipients = raw.get("recipients")
    if isinstance(recipients, list):
        cleaned = tuple(
            str(r).strip() for r in recipients if isinstance(r, str) and str(r).strip()
        )
        # An empty/all-blank list means "not configured here" — keep the env seed
        # rather than silently disabling delivery by wiping the recipient list.
        if cleaned:
            updates["alert_recipients"] = cleaned

    sla_hours = raw.get("sla_hours")
    # bool is a subclass of int/float; exclude it so ``true`` isn't read as 1 hour.
    if isinstance(sla_hours, (int, float)) and not isinstance(sla_hours, bool) and sla_hours > 0:
        updates["sla_hours"] = float(sla_hours)

    enabled = raw.get("enabled")
    if isinstance(enabled, bool):
        updates["enabled"] = enabled

    return dataclasses.replace(alert, **updates) if updates else alert


# --------------------------------------------------------------------------- #
#  Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _float_env(value: str | None, default: float) -> float:
    """Parse a float from an env string, falling back to ``default``.

    A blank or unparseable value yields the default rather than raising, so a
    typo in ``.env`` degrades to the built-in window instead of crashing the run.
    """
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _bool_env(value: str | None, default: bool) -> bool:
    """Parse a boolean from an env string, falling back to ``default``.

    ``1/true/yes/on`` (any case) are truthy; ``0/false/no/off`` are falsy. A blank
    or unrecognized value yields the default, so a typo can't silently flip a
    feature on — it stays at its built-in setting.
    """
    if value is None or not value.strip():
        return default
    token = value.strip().lower()
    if token in ("1", "true", "yes", "on"):
        return True
    if token in ("0", "false", "no", "off"):
        return False
    return default


def _tuple_env(value: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    """Parse a comma-separated env string into a tuple, falling back to ``default``.

    Each item is stripped; blank items are dropped. A blank/all-blank value yields
    the default rather than an empty tuple, so an accidental ``FOO=`` doesn't wipe
    the built-in list.
    """
    if value is None or not value.strip():
        return default
    items = tuple(part.strip() for part in value.split(",") if part.strip())
    return items or default


def _pairs_env(
    value: str | None, default: tuple[tuple[str, str], ...]
) -> tuple[tuple[str, str], ...]:
    """Parse ``"Name=addr;Other=addr2"`` into a tuple of ``(name, value)`` pairs.

    Pairs are separated by ``;`` and split on the first ``=``; the name and value are
    each stripped. Chunks without an ``=``, or with a blank name/value, are dropped.
    A blank/all-blank string yields ``default`` — so an accidental empty env var
    doesn't wipe any built-in list.
    """
    if value is None or not value.strip():
        return default
    pairs: list[tuple[str, str]] = []
    for chunk in value.split(";"):
        if "=" not in chunk:
            continue
        name, _, val = chunk.partition("=")
        name, val = name.strip(), val.strip()
        if name and val:
            pairs.append((name, val))
    return tuple(pairs) or default


def _maybe_load_dotenv() -> None:
    """Load a local ``.env`` if python-dotenv is installed; a no-op otherwise."""
    try:
        from dotenv import load_dotenv as _load
    except ImportError:  # pragma: no cover - dotenv is a declared dependency
        return
    # override=False: a real exported variable always beats the .env file.
    _load(override=False)
