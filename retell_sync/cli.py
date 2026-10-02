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
    Detect after-hours callers overdue for a callback and email the SLA digest as an
    M365 message (Microsoft Graph). ``--dry-run`` prints the overdue table and sends
    nothing. *(Phase 3, PR A detection; PR B delivery.)*

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
    # Cache/debug pull mirrors the dashboard: every call on record by default.
    since = _since_from_args(cfg, args, default_days=None)

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


def _since_from_args(
    cfg: AppConfig, args: argparse.Namespace, *, default_days: int | None
) -> datetime | None:
    """Resolve the pull-window start from --since/--days.

    Returns a UTC datetime, or ``None`` for "all history" (no lower bound). An
    explicit ``--since`` always wins; otherwise ``--days`` (or ``default_days``
    when the flag is absent) sets the look-back, and a value of ``0`` or less
    means pull everything. The whole pipeline already treats ``since=None`` as
    unbounded — the Retell filter, the Odoo domain, and the JSON window all
    accept it — so the dashboard commands pass ``default_days=None`` to fetch
    every call on record, while the digest commands keep a recent window.
    """
    if args.since:
        dt = datetime.fromisoformat(args.since)
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    days = args.days if args.days is not None else default_days
    if days is None or days <= 0:
        return None
    return datetime.now(UTC) - timedelta(days=days)


def _span_label(since: datetime | None) -> str:
    """Human phrase for the pull window: an ISO start, or all-history."""
    return f"since {since.isoformat()}" if since is not None else "across all history"


def _print_calls_summary(calls: pd.DataFrame, since: datetime | None) -> None:
    """Emit a short human-readable summary of a normalized call pull."""
    print(f"pulled {len(calls)} call(s) {_span_label(since)}")
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
    from .output import append_history, write_outputs
    from .retell import RetellClient, RetellError

    cfg = AppConfig.from_env()
    # The dashboard shows every call on record by default (no lower bound). Pass
    # `--days N` or `--since ISO` to narrow it. Digest commands (alert/scorecard)
    # keep their recent window below; only the dashboard build is unbounded.
    since = _since_from_args(cfg, args, default_days=None)

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
    links = _links_for(cfg)
    written = write_outputs(result, cfg.paths, since=since, links=links)

    # Append today's headline KPIs to the cross-run history that backs the
    # dashboard's Trends page. Best-effort: a history-write hiccup is reported but
    # never fails the run — the three deliverables above already landed.
    try:
        history_path = append_history(result, cfg.paths, since=since)
    except OSError as exc:
        print(f"run: history not updated: {exc}", file=sys.stderr)
        history_path = None

    _print_run_summary(result, since, written)
    if history_path is not None:
        print(f"updated -> {history_path}")

    # The nightly task runs `run`; sending the SLA digest here (when enabled) means
    # the same schedule that refreshes the dashboard also delivers the callback
    # alert — no second scheduled task. A delivery failure is reported but does not
    # fail the run, since the data outputs above already landed successfully.
    if cfg.alert.enabled:
        _send_run_digest(result, cfg, links)

    return 0


def _links_for(cfg: AppConfig) -> dict[str, str | None]:
    """Build the Retell/Odoo click-through link templates from config (see build_links)."""
    from .output import build_links

    return build_links(
        retell_dashboard_url=cfg.retell.dashboard_url,
        odoo_web_url=cfg.odoo.web_url,
        retell_call_template=cfg.retell.call_url_template,
        odoo_lead_template=cfg.odoo.lead_url_template,
    )


def _print_run_summary(result: Any, since: datetime | None, written: Any) -> None:
    """Emit a short human-readable summary of a completed run."""
    k = result.kpis
    print(f"run complete — {k['total_calls']} call(s) {_span_label(since)}")
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
    """Detect after-hours callers overdue for a callback and email the SLA digest.

    Pulls calls + leads, runs the conversion join, finds the overdue set with
    :func:`retell_sync.sla.find_overdue`, and prints it. With ``--dry-run`` it stops
    there (a read-only preview that ignores the ``enabled`` switch, so an operator can
    inspect the digest before wiring up delivery); otherwise it sends the digest as an
    M365 email via :func:`retell_sync.mailer.send_digest`. Nothing is sent when nothing
    is overdue.
    """
    from .conversion import analyze
    from .mailer import MailerError
    from .odoo import OdooClient, OdooError
    from .retell import RetellClient, RetellError
    from .sla import find_overdue

    cfg = AppConfig.from_env()
    # The SLA digest is about the recent window, not all history — keep the
    # configured look-back unless the caller overrides it with --days/--since.
    since = _since_from_args(cfg, args, default_days=cfg.retell.lookback_days)

    try:
        calls = RetellClient(cfg.retell).fetch_calls(since)
    except ConfigError as exc:
        print(f"alert: {exc}", file=sys.stderr)
        return 2
    except RetellError as exc:
        print(f"alert: Retell API error: {exc}", file=sys.stderr)
        return 1

    try:
        odoo = OdooClient(cfg.odoo)
        leads = odoo.search_leads(since)
    except ConfigError as exc:
        print(f"alert: {exc}", file=sys.stderr)
        return 2
    except OdooError as exc:
        print(f"alert: Odoo API error: {exc}", file=sys.stderr)
        return 1

    result = analyze(calls, leads, cfg)
    overdue = find_overdue(result.by_call, cfg.alert, datetime.now(UTC))
    _print_overdue(overdue, cfg.alert.sla_hours)

    if args.dry_run or overdue.empty:
        # Dry-run stops at the preview; an empty set has nothing to deliver (the
        # "nothing to send" line was already printed by _print_overdue). Still show
        # how the digest would fan out per rep, so the routing can be inspected first.
        if args.dry_run and cfg.alert.per_rep_enabled and not overdue.empty:
            _print_per_rep_breakdown(overdue, cfg, odoo)
        return 0

    links = _links_for(cfg)
    try:
        cfg.alert.require_graph()
        _send_digest(overdue, cfg.alert, links, cfg.paths)
    except ConfigError as exc:
        print(f"alert: {exc}", file=sys.stderr)
        return 2
    except MailerError as exc:
        print(f"alert: email delivery failed: {exc}", file=sys.stderr)
        return 1

    print(f"sent SLA digest to {', '.join(cfg.alert.alert_recipients)}.")

    # Per-rep digests are best-effort: the manager digest above already delivered,
    # so a per-rep hiccup is reported but doesn't fail the command.
    if cfg.alert.per_rep_enabled:
        _send_per_rep_digests(overdue, cfg, odoo, links)

    return 0


def _send_digest(
    overdue: pd.DataFrame, alert_cfg: Any, links: dict[str, str | None], paths: Any
) -> None:
    """Render and send the manager digest. Raises MailerError on a delivery failure.

    Records the send to the email log (best-effort) only after Graph accepts it, so
    the log reflects mail that truly went out.
    """
    from .mailer import build_digest_html, build_digest_subject, send_digest
    from .sendlog import record_send

    subject = build_digest_subject(overdue, alert_cfg.sla_hours)
    html_body = build_digest_html(overdue, links, alert_cfg.sla_hours)
    send_digest(alert_cfg, subject=subject, html_body=html_body)
    record_send(
        paths,
        kind="manager",
        recipients=alert_cfg.alert_recipients,
        subject=subject,
        lead_count=len(overdue),
        html=html_body,
    )


def _send_run_digest(result: Any, cfg: AppConfig, links: dict[str, str | None]) -> None:
    """Detect + email the SLA digest as part of ``run`` (best-effort, never fatal).

    A missing credential or a Graph failure is reported to stderr but does not change
    ``run``'s exit code: the conversion outputs already wrote successfully, so a bounced
    email shouldn't mark the nightly data refresh as failed.
    """
    from .mailer import MailerError
    from .sla import find_overdue

    overdue = find_overdue(result.by_call, cfg.alert, datetime.now(UTC))
    if overdue.empty:
        print(f"SLA digest: nothing overdue past {cfg.alert.sla_hours:.0f}h — no email sent.")
        return
    try:
        cfg.alert.require_graph()
        _send_digest(overdue, cfg.alert, links, cfg.paths)
    except (ConfigError, MailerError) as exc:
        print(f"run: SLA digest not sent: {exc}", file=sys.stderr)
        return
    print(
        f"SLA digest: emailed {len(overdue)} overdue caller(s) to "
        f"{', '.join(cfg.alert.alert_recipients)}."
    )

    # Per-rep digests, when enabled — best-effort, never fails the run.
    if cfg.alert.per_rep_enabled:
        from .odoo import OdooClient, OdooError

        try:
            _send_per_rep_digests(overdue, cfg, OdooClient(cfg.odoo), links)
        except (ConfigError, OdooError) as exc:
            print(f"run: per-rep digests not sent: {exc}", file=sys.stderr)


def _send_per_rep_digests(
    overdue: pd.DataFrame, cfg: AppConfig, odoo: Any, links: dict[str, str | None]
) -> None:
    """Email each salesperson their own overdue leads (best-effort, per-rep isolated).

    Reads rep emails from Odoo, merges the ``ALERT_REP_EMAILS`` overrides, and sends
    one digest per resolvable rep. A single rep's send failure is logged and skipped
    so it never blocks the others; reps with no email are reported (their leads are
    already in the manager digest). Assumes the Graph secrets are present — the
    manager digest send that precedes this validated them.
    """
    from .digest import build_rep_email_map, plan_rep_digests
    from .mailer import MailerError, build_digest_html, build_rep_digest_subject, send_digest
    from .odoo import OdooError
    from .sendlog import record_send

    try:
        odoo_emails = odoo.fetch_user_emails()
    except OdooError as exc:
        print(f"  per-rep: skipped — could not read Odoo users: {exc}", file=sys.stderr)
        return

    email_map = build_rep_email_map(odoo_emails, cfg.alert.rep_email_overrides)
    plans, unresolved = plan_rep_digests(overdue, email_map)

    sent = 0
    for plan in plans:
        subject = build_rep_digest_subject(plan.overdue, cfg.alert.sla_hours)
        html_body = build_digest_html(plan.overdue, links, cfg.alert.sla_hours)
        try:
            send_digest(cfg.alert, subject=subject, html_body=html_body, recipients=[plan.email])
        except MailerError as exc:
            print(f"  per-rep: {plan.rep} <{plan.email}> failed: {exc}", file=sys.stderr)
            continue
        record_send(
            cfg.paths,
            kind="per_rep",
            rep=plan.rep,
            recipients=[plan.email],
            subject=subject,
            lead_count=len(plan.overdue),
            html=html_body,
        )
        sent += 1
        print(f"  per-rep: {len(plan.overdue)} lead(s) -> {plan.rep} <{plan.email}>")

    if unresolved:
        print(
            f"  per-rep: no email for {len(unresolved)} rep(s): "
            f"{', '.join(sorted(unresolved))} — add ALERT_REP_EMAILS overrides "
            "(their leads are in the manager digest).",
            file=sys.stderr,
        )
    print(f"sent {sent} per-rep digest(s).")


def _print_per_rep_breakdown(overdue: pd.DataFrame, cfg: AppConfig, odoo: Any) -> None:
    """Dry-run preview: show how the digest would fan out to each rep, no send."""
    from .digest import build_rep_email_map, group_overdue_by_rep, plan_rep_digests
    from .odoo import OdooError

    try:
        odoo_emails = odoo.fetch_user_emails()
    except OdooError as exc:
        print(f"  (per-rep preview unavailable — could not read Odoo users: {exc})")
        odoo_emails = {}

    email_map = build_rep_email_map(odoo_emails, cfg.alert.rep_email_overrides)
    groups = group_overdue_by_rep(overdue)
    plans, unresolved = plan_rep_digests(overdue, email_map)

    print("per-rep routing (dry-run):")
    for plan in plans:
        print(f"  {len(plan.overdue):>3} lead(s) -> {plan.rep} <{plan.email}>")
    for rep in sorted(unresolved):
        print(f"  {len(groups[rep]):>3} lead(s) -> {rep} (NO EMAIL — add ALERT_REP_EMAILS)")


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


def cmd_scorecard(args: argparse.Namespace) -> int:
    """Build the per-rep performance leaderboard and email it to managers.

    Pulls calls + leads, runs the conversion join, computes the scorecard with
    :func:`retell_sync.scorecard.build_rep_scorecard` (joined to the current overdue
    set), and prints it. With ``--dry-run`` it stops there; otherwise it emails the
    ranked table to the scorecard recipients (``RETELL_SCORECARD_TO``, falling back to
    ``ALERT_TO``). Intended to run weekly from Task Scheduler.
    """
    from .conversion import analyze
    from .mailer import MailerError
    from .odoo import OdooClient, OdooError
    from .retell import RetellClient, RetellError
    from .scorecard import build_rep_scorecard
    from .sla import find_overdue

    cfg = AppConfig.from_env()
    # The per-rep scorecard covers the recent window — keep the configured
    # look-back unless the caller overrides it with --days/--since.
    since = _since_from_args(cfg, args, default_days=cfg.retell.lookback_days)

    try:
        calls = RetellClient(cfg.retell).fetch_calls(since)
    except ConfigError as exc:
        print(f"scorecard: {exc}", file=sys.stderr)
        return 2
    except RetellError as exc:
        print(f"scorecard: Retell API error: {exc}", file=sys.stderr)
        return 1

    try:
        leads = OdooClient(cfg.odoo).search_leads(since)
    except ConfigError as exc:
        print(f"scorecard: {exc}", file=sys.stderr)
        return 2
    except OdooError as exc:
        print(f"scorecard: Odoo API error: {exc}", file=sys.stderr)
        return 1

    result = analyze(calls, leads, cfg)
    overdue = find_overdue(result.by_call, cfg.alert, datetime.now(UTC))
    scorecard = build_rep_scorecard(result.by_call, overdue)
    _print_scorecard(scorecard)

    if args.dry_run or scorecard.empty:
        return 0

    recipients = cfg.alert.scorecard_to()
    try:
        cfg.alert.require_graph(recipients, "RETELL_SCORECARD_TO or ALERT_TO")
        _send_scorecard(
            scorecard,
            cfg.alert,
            recipients,
            window_label=f"since {since.date()}" if since is not None else "all history",
            paths=cfg.paths,
        )
    except ConfigError as exc:
        print(f"scorecard: {exc}", file=sys.stderr)
        return 2
    except MailerError as exc:
        print(f"scorecard: email delivery failed: {exc}", file=sys.stderr)
        return 1

    print(f"sent rep scorecard to {', '.join(recipients)}.")
    return 0


def _send_scorecard(
    scorecard: pd.DataFrame,
    alert_cfg: Any,
    recipients: tuple[str, ...],
    *,
    window_label: str,
    paths: Any,
) -> None:
    """Render and send the rep scorecard. Raises MailerError on a delivery failure.

    Records the send to the email log (best-effort) only after Graph accepts it.
    """
    from .mailer import build_scorecard_html, build_scorecard_subject, send_digest
    from .sendlog import record_send

    subject = build_scorecard_subject(scorecard)
    html_body = build_scorecard_html(scorecard, window_label=window_label)
    send_digest(alert_cfg, subject=subject, html_body=html_body, recipients=recipients)
    record_send(
        paths,
        kind="scorecard",
        recipients=recipients,
        subject=subject,
        lead_count=len(scorecard),
        html=html_body,
    )


def _print_scorecard(scorecard: pd.DataFrame) -> None:
    """Print the ranked scorecard table (a dry-run preview of the email)."""
    if scorecard.empty:
        print("no calls in this window — scorecard is empty, nothing to send.")
        return

    print(f"rep scorecard ({len(scorecard)} salesperson row(s)), ranked by won revenue:")
    print(f"  {'#':>2}  {'salesperson':<22.22}  {'calls':>5}  {'leads':>5}  "
          f"{'won':>4}  {'won $':>10}  {'win%':>6}  {'overdue':>7}")
    for rank, (_, row) in enumerate(scorecard.iterrows(), start=1):
        print(
            f"  {rank:>2}  {str(row['rep']):<22.22}  {int(row['calls']):>5}  "
            f"{int(row['matched_leads']):>5}  {int(row['won_deals']):>4}  "
            f"${float(row['won_revenue']):>9,.0f}  {float(row['win_rate']) * 100:>5.1f}%  "
            f"{int(row['overdue_now']):>7}"
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
            "  python -m retell_sync scorecard --dry-run\n"
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
        help="print the overdue callers and stop, without sending the email digest",
    )
    alert.set_defaults(func=cmd_alert)

    scorecard = sub.add_parser(
        "scorecard", parents=[common],
        help="email the weekly per-rep performance leaderboard",
    )
    _add_window_args(scorecard)
    scorecard.add_argument(
        "--dry-run", action="store_true",
        help="print the rep scorecard and stop, without sending the email",
    )
    scorecard.set_defaults(func=cmd_scorecard)

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
