#!/usr/bin/env python3
"""
retell_sync.digest
==================
Per-salesperson routing of the overdue-caller digest — pure planning, no IO.

:mod:`retell_sync.sla` produces one overdue frame for the whole business, and
:mod:`retell_sync.mailer` sends the manager digest of it. This module turns that
single frame plus a rep→email source into a **per-rep send plan**: each
salesperson gets a digest of only their own overdue leads, on top of the manager
digest.

Everything here is pure — grouping, name→email merging, and resolution are
deterministic transforms — so the routing logic is unit-tested with no network.
The Odoo user read and the actual send stay in :mod:`retell_sync.odoo` /
:mod:`retell_sync.mailer`; the CLI wires them together.

Matching is by the salesperson **display name** (the lead's ``sales_rep`` column,
which is the Odoo ``user_id`` label), compared case-insensitively. An operator
override (``ALERT_REP_EMAILS``) always wins over the Odoo lookup, and the
:data:`~retell_sync.sla.UNASSIGNED` bucket is never routed — those leads have no
owner to email and remain only in the manager digest.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

from .sla import UNASSIGNED

log = logging.getLogger("retell_sync.digest")

__all__ = [
    "RepDigest",
    "group_overdue_by_rep",
    "build_rep_email_map",
    "plan_rep_digests",
]


@dataclass(frozen=True)
class RepDigest:
    """One salesperson's own slice of the overdue set, with a resolved recipient."""

    #: The salesperson display name (as it appears in the ``sales_rep`` column).
    rep: str
    #: The resolved email address to send this rep's digest to.
    email: str
    #: The overdue rows owned by this rep, most-overdue first (a slice of the frame).
    overdue: pd.DataFrame


def _norm(name: object) -> str:
    """Case-folded, trimmed key for matching a rep name across sources."""
    return str(name).strip().lower()


def group_overdue_by_rep(overdue: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Split the overdue frame into ``{sales_rep: sub-frame}``, order preserved.

    Group order follows first appearance in ``overdue`` (which is sorted most-overdue
    first), and rows within each group keep that order. The
    :data:`~retell_sync.sla.UNASSIGNED` bucket, if present, is returned like any other
    — callers decide whether to route it (:func:`plan_rep_digests` skips it).
    """
    if overdue.empty:
        return {}
    groups: dict[str, pd.DataFrame] = {}
    for rep, sub in overdue.groupby("sales_rep", sort=False):
        groups[str(rep)] = sub.reset_index(drop=True)
    return groups


def build_rep_email_map(
    odoo_emails: dict[str, str],
    overrides: tuple[tuple[str, str], ...] = (),
) -> dict[str, str]:
    """Merge Odoo user emails with manual overrides into a normalized name→email map.

    Keys are case-folded rep names; blank names/emails are dropped. Overrides are
    applied last so an operator-supplied address always wins over the Odoo lookup —
    the escape hatch for a rep whose Odoo user has no (or a wrong) email.
    """
    merged: dict[str, str] = {}
    for name, email in (odoo_emails or {}).items():
        key, addr = _norm(name), str(email).strip()
        if key and addr:
            merged[key] = addr
    for name, email in overrides:
        key, addr = _norm(name), str(email).strip()
        if key and addr:
            merged[key] = addr
    return merged


def plan_rep_digests(
    overdue: pd.DataFrame,
    email_map: dict[str, str],
) -> tuple[list[RepDigest], list[str]]:
    """Resolve the overdue set into per-rep digests plus the reps with no email.

    Returns ``(plans, unresolved)``: ``plans`` is one :class:`RepDigest` per rep with
    a known email (each carrying only that rep's rows), and ``unresolved`` is the list
    of rep names present in the overdue set but missing from ``email_map`` — their
    leads still appear in the manager digest, so the caller should surface them so an
    ``ALERT_REP_EMAILS`` override can be added. The
    :data:`~retell_sync.sla.UNASSIGNED` bucket is skipped entirely (no owner to mail).
    """
    plans: list[RepDigest] = []
    unresolved: list[str] = []
    for rep, sub in group_overdue_by_rep(overdue).items():
        if rep == UNASSIGNED:
            continue
        email = email_map.get(_norm(rep))
        if email:
            plans.append(RepDigest(rep=rep, email=email, overdue=sub))
        else:
            unresolved.append(rep)
    return plans, unresolved
