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
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "BusinessHoursConfig",
    "RetellConfig",
    "OdooConfig",
    "ConversionConfig",
    "PathsConfig",
    "AppConfig",
    "ConfigError",
]


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
        return cls(retell=retell, odoo=odoo, conversion=conversion)


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


def _maybe_load_dotenv() -> None:
    """Load a local ``.env`` if python-dotenv is installed; a no-op otherwise."""
    try:
        from dotenv import load_dotenv as _load
    except ImportError:  # pragma: no cover - dotenv is a declared dependency
        return
    # override=False: a real exported variable always beats the .env file.
    _load(override=False)
