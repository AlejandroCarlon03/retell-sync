"""
retell_sync
===========
Join Retell AI call logs with Odoo CRM leads to answer the question the after-hours
AI phone agent exists to answer: *does an after-hours call become a customer, and
what is it worth?*

This package pulls Retell call logs and Odoo CRM leads, joins them by caller phone
number, tags each call as after-hours or business-hours, and computes a conversion
funnel (lead -> quote -> won/lost) plus dollar value per after-hours call.

PR 1 ships only the scaffolding: configuration, the CLI skeleton, and CI. The data
clients (`retell`, `odoo`), the join/funnel logic (`conversion`), and the output
writers land in later PRs — see ``master_plan.md``.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
