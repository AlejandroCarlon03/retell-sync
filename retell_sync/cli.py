#!/usr/bin/env python3
"""
retell_sync.cli
===============
Command-line entry point.

Commands
--------
``pull``
    Fetch recent Retell calls and Odoo leads. *(Implemented in PR 2 / PR 3.)*
``run``
    Full flow: pull, join, and write the conversion funnel + dollar-value
    outputs. *(Implemented in PR 5.)*

In PR 1 the commands are wired up and documented, but the pull/join logic does
not exist yet, so invoking them exits with a clear "not implemented" message and
a non-zero status. ``--help`` and ``--version`` work fully.

Run ``python -m retell_sync --help`` for the full option list.
"""

from __future__ import annotations

import argparse
import logging
import sys

from . import __version__

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
def _not_implemented(command: str, lands_in: str) -> int:
    """Uniform stub response for commands whose logic ships in a later PR."""
    print(
        f"`{command}` is not implemented yet — it lands in {lands_in}. "
        "PR 1 ships only the project scaffolding (config, CLI skeleton, CI).",
        file=sys.stderr,
    )
    return 2


def cmd_pull(args: argparse.Namespace) -> int:
    """Fetch recent Retell calls and Odoo leads (PR 2 / PR 3)."""
    return _not_implemented("pull", "PR 2 (Odoo) and PR 3 (Retell)")


def cmd_run(args: argparse.Namespace) -> int:
    """Pull, join, and write the conversion outputs (PR 5)."""
    return _not_implemented("run", "PR 5 (orchestration + outputs)")


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
        ),
    )
    parser.add_argument("--version", action="version", version=f"retell-sync {__version__}")

    sub = parser.add_subparsers(dest="command", required=True)

    pull = sub.add_parser("pull", parents=[common], help="fetch recent Retell calls and Odoo leads")
    pull.set_defaults(func=cmd_pull)

    run = sub.add_parser("run", parents=[common], help="pull, join, and write conversion outputs")
    run.set_defaults(func=cmd_run)

    return parser


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
