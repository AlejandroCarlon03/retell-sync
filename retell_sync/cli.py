#!/usr/bin/env python3
"""
retell_sync.cli
===============
Command-line entry point.

Commands
--------
``pull``
    Fetch recent Retell calls, normalize + dedup them, print a summary, and
    (unless ``--no-cache``) persist the raw pull and the normalized frame to the
    data directory for reproducibility. *(Retell side implemented in PR 3; the
    Odoo lead pull joins in once PR 2 merges.)*
``run``
    Full flow: pull, join, and write the conversion funnel + dollar-value
    outputs. *(Implemented in PR 5.)*
``alert``
    Detect after-hours callers overdue for a callback and print them
    (``--dry-run``). Email delivery lands in a later PR. *(Phase 3, PR A.)*

``--help`` and ``--version`` work fully.

Run ``python -m retell_sync --help`` for the full option list.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

from . import __version__
from .config import AppConfig, ConfigError

log = logging.getLogger("retell_sync")

__all__ = ["main", "build_parser"]


# --------------------------------------------------------------------------- #
#  Setup                                                                       #
# --------------------------------------------------------------------------- #
def _configure_logging(verbosity: int) -> None:
    """Map -v/-vv onto logging levels with a compact format."""
    level = {0: logging.WARNING, 1: logging.INFO}.get(verbosity, logging.DEBUG)
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


# --------------------------------------------------------------------------- #
#  Commands                                                                    #
# --------------------------------------------------------------------------- #
def cmd_pull(args: argparse.Namespace) -> int:
    """Fetch, normalize, dedup, and (optionally) cache recent Retell calls (PR 3)."""
    # Imported lazily so `--help`/`--version` never pay the pandas/requests import
    # cost, and so a missing dependency only bites the command that needs it.
    from .retell import RetellClient, RetellError

    cfg = AppConfig.from_env()
    since = _since_from_args(cfg, args)

    try:
        client = RetellClient(cfg.retell)
        calls = client.fetch_calls(since)
    except ConfigError as exc:
        print(f"pull: {exc}", file=sys.stderr)
        return 2
    except RetellError as exc:
        print(f"pull: Retell API error: {exc}", file=sys.stderr)
        return 1

    _print_calls_summary(calls, since)

    if not args.no_cache:
        paths = cfg.paths.ensure()
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        raw_path = paths.data_dir / f"retell_calls_raw_{stamp}.json"
        norm_path = paths.data_dir / "retell_calls.csv"
        _write_raw(raw_path, calls)
        calls.to_csv(norm_path, index=False)
        print(f"cached raw pull  -> {raw_path}")
        print(f"cached normalized -> {norm_path}")

    return 0


def _since_from_args(cfg: AppConfig, args: argparse.Namespace) -> datetime:
    """Resolve the pull window start as a UTC datetime from --since/--days."""
    if args.since:
        dt = datetime.fromisoformat(args.since)
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    days = args.days if args.days is not None else cfg.retell.lookback_days
    return datetime.now(UTC) - timedelta(days=days)


def _print_calls_summary(calls: pd.DataFrame, since: datetime) -> None:
    """Emit a short human-readable summary of a normalized call pull."""
    print(f"pulled {len(calls)} call(s) since {since.isoformat()}")
    if calls.empty:
        return
    ts = pd.to_datetime(calls["ts"], utc=True, errors="coerce").dropna()
    if not ts.empty:
        print(f"  window: {ts.min().isoformat()} .. {ts.max().isoformat()}")
    total_cost = pd.to_numeric(calls["cost"], errors="coerce").sum()
    directions = calls["direction"].value_counts(dropna=False).to_dict()
    print(f"  total cost: ${total_cost:,.2f}   directions: {directions}")


def _write_raw(path: Path, calls: pd.DataFrame) -> None:
    """Persist the normalized pull as JSON records (timestamps as ISO strings)."""
    frame = calls.copy()
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce").map(
        lambda t: t.isoformat() if pd.notna(t) else None
    )
    records = frame.where(pd.notna(frame), None).to_dict(orient="records")
    path.write_text(json.dumps(records, indent=2), encoding="utf-8")


def cmd_run(args: argparse.Namespace) -> int:
    """Pull Retell calls + Odoo leads, join them, and write the conversion outputs.

    Each external pull is guarded independently so a single API outage (or a
    missing credential) produces a clear, attributable error and a non-zero exit
    code rather than an unhandled traceback.
    """
    from .conversion import analyze
    from .odoo import OdooClient, OdooError
    from .output import build_links, write_outputs
    from .retell import RetellClient, RetellError

    cfg = AppConfig.from_env()
    since = _since_from_args(cfg, args)

    try:
        calls = RetellClient(cfg.retell).fetch_calls(since)
    except ConfigError as exc:
        print(f"run: {exc}", file=sys.stderr)
        return 2
    except RetellError as exc:
        print(f"run: Retell API error: {exc}", file=sys.stderr)
        return 1

    try:
        leads = OdooClient(cfg.odoo).search_leads(since)
    except ConfigError as exc:
        print(f"run: {exc}", file=sys.stderr)
        return 2
    except OdooError as exc:
        print(f"run: Odoo API error: {exc}", file=sys.stderr)
        return 1

    result = analyze(calls, leads, cfg)
    links = build_links(
        retell_dashboard_url=cfg.retell.dashboard_url,
        odoo_web_url=cfg.odoo.web_url,
        retell_call_template=cfg.retell.call_url_template,
        odoo_lead_template=cfg.odoo.lead_url_template,
    )
    written = write_outputs(result, cfg.paths, since=since, links=links)

    _print_run_summary(result, since, written)
    return 0


def _print_run_summary(result: Any, since: datetime, written: Any) -> None:
    """Emit a short human-readable summary of a completed run."""
    k = result.kpis
    print(f"run complete — {k['total_calls']} call(s) since {since.isoformat()}")
    print(
        f"  after-hours: {k['after_hours_calls']}   matched: {k['matched_calls']}   "
        f"won: {k['won_calls']}   lost: {k['lost_calls']}"
    )
    print(
        f"  $/after-hours call: ${k['dollars_per_after_hours_call']:,.2f}   "
        f"weighted pipeline: ${k['weighted_pipeline']:,.2f}"
    )
    for path in written.as_list():
        print(f"wrote -> {path}")


def cmd_alert(args: argparse.Namespace) -> int:
    """Detect after-hours callers overdue for a callback (SLA digest).

    Pulls calls + leads, runs the conversion join, and finds the overdue set with
    :func:`retell_sync.sla.find_overdue`. In this PR only ``--dry-run`` is wired: it
    prints the overdue table and sends nothing (M365 delivery lands in PR B). The
    dry-run preview is read-only and ignores the ``enabled`` switch, so an operator
    can inspect the digest before turning the feature on.
    """
    from .conversion import analyze
    from .odoo import OdooClient, OdooError
    from .retell import RetellClient, RetellError
    from .sla import find_overdue

    if not args.dry_run:
        print(
            "alert: only --dry-run is supported in this version; email delivery is "
            "not wired up yet. Re-run with --dry-run to preview overdue callers.",
            file=sys.stderr,
        )
        return 2

    cfg = AppConfig.from_env()
    since = _since_from_args(cfg, args)

    try:
        calls = RetellClient(cfg.retell).fetch_calls(since)
    except ConfigError as exc:
        print(f"alert: {exc}", file=sys.stderr)
        return 2
    except RetellError as exc:
        print(f"alert: Retell API error: {exc}", file=sys.stderr)
        return 1

    try:
        leads = OdooClient(cfg.odoo).search_leads(since)
    except ConfigError as exc:
        print(f"alert: {exc}", file=sys.stderr)
        return 2
    except OdooError as exc:
        print(f"alert: Odoo API error: {exc}", file=sys.stderr)
        return 1

    result = analyze(calls, leads, cfg)
    overdue = find_overdue(result.by_call, cfg.alert, datetime.now(UTC))
    _print_overdue(overdue, cfg.alert.sla_hours)
    return 0


def _print_overdue(overdue: pd.DataFrame, sla_hours: float) -> None:
    """Print the overdue table (a dry-run preview of the SLA digest)."""
    if overdue.empty:
        print(f"no after-hours callers overdue past {sla_hours:.0f}h — nothing to send.")
        return

    print(f"{len(overdue)} after-hours caller(s) overdue past {sla_hours:.0f}h:")
    for _, row in overdue.iterrows():
        print(
            f"  {row['hours_overdue']:>6.1f}h  {row['sales_rep']:<20.20}  "
            f"{str(row['lead_name'] or ''):<28.28}  {row['phone_key']!s:<12}  "
            f"[{row['stage_label']}]"
        )


# --------------------------------------------------------------------------- #
#  Parser                                                                      #
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    """Construct the argument parser (kept separate so tests can inspect it)."""
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "-v", "--verbose", action="count", default=0,
        help="-v for progress, -vv for debug",
    )

    parser = argparse.ArgumentParser(
        prog="retell-sync",
        parents=[common],
        description=(
            "Join Retell AI call logs with Odoo CRM to measure after-hours call "
            "conversion and dollar value."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  python -m retell_sync --version\n"
            "  python -m retell_sync pull -v\n"
            "  python -m retell_sync run -v\n"
            "  python -m retell_sync alert --dry-run\n"
        ),
    )
    parser.add_argument("--version", action="version", version=f"retell-sync {__version__}")

    sub = parser.add_subparsers(dest="command", required=True)

    pull = sub.add_parser(
        "pull", parents=[common], help="fetch, normalize, and cache recent Retell calls"
    )
    _add_window_args(pull)
    pull.add_argument(
        "--no-cache", action="store_true",
        help="don't write the raw pull / normalized CSV to the data directory",
    )
    pull.set_defaults(func=cmd_pull)

    run = sub.add_parser("run", parents=[common], help="pull, join, and write conversion outputs")
    _add_window_args(run)
    run.set_defaults(func=cmd_run)

    alert = sub.add_parser(
        "alert", parents=[common],
        help="find after-hours callers overdue for a callback (SLA digest)",
    )
    _add_window_args(alert)
    alert.add_argument(
        "--dry-run", action="store_true",
        help="print the overdue callers instead of sending; required in this version",
    )
    alert.set_defaults(func=cmd_alert)

    return parser


def _add_window_args(sub: argparse.ArgumentParser) -> None:
    """Attach the mutually-exclusive ``--days`` / ``--since`` pull-window options."""
    window = sub.add_mutually_exclusive_group()
    window.add_argument(
        "--days", type=int, default=None,
        help="how many days back to pull (default: RetellConfig.lookback_days)",
    )
    window.add_argument(
        "--since", default=None,
        help="explicit ISO start, e.g. 2026-07-01 or 2026-07-01T00:00:00 (overrides --days)",
    )


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns a process exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:  # pragma: no cover
        print("\nInterrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
