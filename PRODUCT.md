# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Diamond Kitchen and Bath (DKB) leadership/ownership checking whether the
after-hours AI phone agent is paying for itself — ROI and dollar-value-per-call at a
glance. Secondary: the IT admin who runs the tool and reads it directly (internal
tool, not distributed to broader DKB staff). Both open it on a Windows desktop via a
Photino window.

## Product Purpose

Answer the one question the after-hours AI phone agent exists to answer: *does an
after-hours call become a customer, and what is it worth?* The dashboard visualizes
`conversion.json` — Retell AI call logs joined to Odoo CRM leads by caller phone
number — showing the conversion funnel (lead → quote → won/lost), the after-hours vs
business-hours split, dollar value per after-hours call, and a sortable per-call
table with deep links to each Retell transcript and Odoo lead. Success is a DKB
decision-maker seeing, in seconds, whether after-hours coverage earns its cost.

## Positioning

The value is the *join*: neither Retell nor Odoo alone can say whether a specific
after-hours call turned into revenue. Phone-number matching plus after-hours tagging
plus the CRM funnel is what makes "dollars per after-hours call" a real, defensible
number rather than a call-volume vanity metric.

## Operating Context

- Read-only dashboard: it only ever reads a local `conversion.json` produced by
  `python -m retell_sync run`. It never calls Retell/Odoo, writes files, or touches
  secrets.
- Everyday workflow is one click: `Retell-Dashboard.cmd` pulls fresh data and opens
  the window. With no real data it falls back to `samples/conversion.sample.json`.
- Runs as a Photino.NET (.NET 10) host + ASP.NET Core minimal `/api/*` layer serving a
  Vite + React + TypeScript frontend, matching sibling DKB dashboards (Cosmos Audit,
  EntraSecurityWatcher).
- Analysis surfaces/routes: After-Hours, Trends Over Time, All Calls, Call
  Quality, Clients, Follow-up Gaps, Cost/Volume, Heatmaps — plus the Admin tools
  (Email Log, Settings). Trends reads the cross-run `history.json`; Call Quality
  reads the per-call sentiment + disconnection signal.

## Capabilities and Constraints

- Data shape is fixed by `conversion.json` (metadata + KPIs + `conversion_by_call`
  and `conversion_funnel` frames); the UI must render whatever that payload contains
  and degrade cleanly when frames are empty or a link base is unset.
- Theme-aware (light/dark): dark is *selected*, declared under both the OS media query
  and an in-app `[data-theme]` toggle that wins either way.
- Categorical color carries meaning: after-hours vs business-hours is a fixed
  identity pair; won/lost and KPI-health status hues always travel with an icon +
  label, never color alone.
- Responsive within a desktop window (WebView2 on Windows 11).
- Terminology: after-hours vs business-hours; funnel stages lead → quote → won/lost;
  KPI "dollar value per after-hours call."

## Brand Commitments

No hard brand rules. There are no mandated DKB colors, logo, or fonts the dashboard
must reflect; the redesign is free to establish its own visual world. (Confirmed with
the user 2026-08-07.)

## Evidence on Hand

- `dashboard/frontend/src/theme.css` — the current design-token system (page/surface
  roles, UI accent kept distinct from data-series hues, status hues, radius, shadows).
- `samples/conversion.sample.json` — schema-perfect fixture; the dashboard renders a
  populated view from it out of the box.
- `dashboard/design-reference/impeccable.style.html` — reference snapshot only;
  nothing imports from it.
- No customer testimonials, benchmarks, or external proof exist for this internal
  tool — future work must not fabricate any.

## Product Principles

- **The number must be trustworthy.** Every headline figure traces to the join and
  the funnel; never imply precision the data doesn't support (e.g. unmatched calls).
- **Read-only, always.** The dashboard observes; it never mutates Retell, Odoo, or
  local data.
- **Decision-first hierarchy.** Dollar-value-per-after-hours-call and the funnel
  outcome outrank everything else on the surface; supporting detail recedes.
- **Meaning before decoration.** Color and emphasis encode data identity and status,
  not ornament.
- **Degrade cleanly.** Empty frames, unmatched callers, and unset link bases are
  normal states with clear, honest empty/disabled treatments.

## Accessibility & Inclusion

No color-only meaning: status and categorical hues always pair with an icon and text
label. Maintain legible contrast in both light and dark themes.
