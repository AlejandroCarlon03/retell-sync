---
name: Retell-Sync Dashboard
description: A calibrated instrument bench for measuring whether after-hours calls pay.
colors:
  ink: "#1e2024"
  ink-secondary: "#4d4f53"
  ink-muted: "#83857f"
  page: "#e6e5df"
  panel: "#f5f4ef"
  recessed: "#edece6"
  scribe-red: "#b23122"
  scribe-red-soft: "rgba(178, 49, 34, 0.1)"
  brass: "#9a7833"
  brass-soft: "rgba(154, 120, 51, 0.12)"
  series-after: "#2f6a92"
  series-business: "#b07a2e"
  series-after-soft: "rgba(47, 106, 146, 0.16)"
  series-business-soft: "rgba(176, 122, 46, 0.18)"
  good: "#3f7a3a"
  warning: "#a9781f"
  critical: "#bb3a2a"
  good-ink: "#33632f"
  warning-ink: "#745215"
  critical-ink: "#9d3123"
  series-after-ink: "#28597b"
  series-business-ink: "#74501e"
  series-neutral: "#7d7f79"
  grid: "#d4d3cb"
  axis: "#a8a79d"
  rule: "rgba(30, 32, 36, 0.14)"
  tick: "rgba(30, 32, 36, 0.28)"
typography:
  headline:
    fontFamily: "Segoe UI, system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "1.9rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Segoe UI, system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 640
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Segoe UI, system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI, system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "0.77rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
  readout:
    fontFamily: "Consolas, ui-monospace, SF Mono, Roboto Mono, monospace"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
rounded:
  sm: "4px"
  md: "6px"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "1.375rem"
components:
  button-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
  button-primary:
    backgroundColor: "{colors.scribe-red}"
    textColor: "{colors.panel}"
    rounded: "{rounded.sm}"
    padding: "0.4rem 0.85rem"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "1.25rem 1.38rem 1.4rem"
  nav-link-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.58rem 0.68rem 0.58rem 0.8rem"
  input-field:
    backgroundColor: "{colors.recessed}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.7rem"
---

# Design System: Retell-Sync Dashboard

## Overview

**Creative North Star: "The Measured Bench"**

The dashboard is a tradesperson's calibrated instrument bench, not a SaaS chart deck. Its job is to *measure* one thing — whether the after-hours phone agent earns its cost — and to report that measurement with the trustworthy, unshowy precision of a steel rule, a dial gauge, and a scribed story pole. Everything reads as satin steel and graphite: crisp hairline rules instead of floating drop shadows, squared corners instead of soft pills, and numerals set in a tabular monospace so a figure reads like an instrument's output. The world is deliberately quiet; the one warm signal in it is a single scribe-red witness mark, and it is spent sparingly.

This world is a *replacement* for the previous look — the generic analytics dashboard of indigo-accented, drop-shadowed KPI cards floating over a funnel bar chart and a table. That arrangement is the explicit anti-reference. Emphasis here comes from the numeral scale, the tabular figures, and position on a scribed rule, never from decorative color or elevation.

The data keeps its meaning: after-hours and business-hours are a fixed categorical pair, retuned to the bench's own metals — steel-blue for the night channel, brass-amber for business hours. Status (won/lost, KPI health) always travels with an icon and a word; color is never the sole signal.

**Key Characteristics:**
- Satin steel & graphite ground; one scribe-red witness accent; brass secondary.
- Scribed hairline rules and crisp, squared corners — depth by line, not by shadow.
- Measured numerals: readouts and data cells set in a tabular monospace.
- Calm by default; the accent earns attention because it is rare.
- Theme is *selected* (light/dark), never auto-flipped silently.

## Colors

A cool machinist neutral base — satin steel and graphite — carrying exactly one warm accent and one warm secondary, with a fixed steel-blue/brass data pair.

### Primary
- **Scribe Red** (#b23122; dark: #d76e59): the witness mark. Chrome only — active-nav index tick, focus rings, links, and the single primary action button. Never used as a data-series hue.

### Secondary
- **Brass** (#9a7833; dark: #c79a4e): warm secondary highlight — the brand-chip numeral, occasional emphasis. Also the business-hours data hue's family.

### Tertiary (data pair)
- **Steel-Blue / Series After** (#2f6a92; dark: #4a90c2): the after-hours "night channel" in every chart, meter, tag, and legend.
- **Brass-Amber / Series Business** (#b07a2e; dark: #cf9a4a): the business-hours channel, the categorical partner to steel-blue.
- **Soft washes** (`--series-after-soft` / `--series-business-soft`): low-alpha fills of the pair — trend-area fills and dimensioned measure bars only. Never used for text, lines, or needles, which take the full-strength hue.

### Neutral
- **Graphite Ink** (#1e2024; dark: #e8e7e1): primary text and the brand-chip panel.
- **Ink Secondary** (#4d4f53; dark: #b0b1ab): supporting text, secondary labels.
- **Ink Muted** (#83857f; dark: #7e807a): captions, help glyphs, disabled text.
- **Page / Panel / Recessed** (#e6e5df / #f5f4ef / #edece6): bench ground, panel face, recessed chrome (sidebar, inputs). Panels sit *lighter* than the ground, like a lit instrument face.
- **Grid / Axis / Rule / Tick** (#d4d3cb / #a8a79d / rgba(30,32,36,.14) / rgba(30,32,36,.28)): the scribed line vocabulary — chart graticule, axis, hairline borders, and the darker tick for index marks.

### The ink tier (text)
- **`--good-ink` / `--warning-ink` / `--critical-ink` / `--series-after-ink` / `--series-business-ink`**: the same five hues, darkened (light) or lifted (dark) until they clear 4.5:1. Used **only** where a hue has to carry a *word* — the health badge, the channel tag, the outcome stamp, a KPI delta. The base hue stays the fill, needle, border and chart-stroke value.
- **Series Neutral** (#7d7f79; dark: #8a8c85): the neutral remainder in a chart — the unmatched-caller band, the neutral-sentiment bar. Deliberately off the identity pair, but still a data series, so it clears the 3:1 floor for graphical objects. `--axis` (2.2:1 light, 1.5:1 dark) is a graticule value and must never carry a series.

### Named Rules
**The Ink-For-Words Rule.** A status or categorical hue never colours text directly — its `-ink` pair does. The soft washes are tinted with the *same* hue as the text they sit under, so the base hue reads at 2.8–4.3:1 on its own badge; the ink tier is what makes the word legible. Fills, needles, borders and chart strokes keep the base hue. `theme.test.ts` asserts every pair on every ground.

**The One Witness Rule.** Scribe-red appears on a screen only as a witness mark — the active nav tick, a focus ring, a link, or the single primary action. If two red elements compete for attention on one view, one of them is wrong.

**The Metals-Not-Moods Rule.** After-hours is steel-blue and business-hours is brass-amber, always, everywhere. These hues are identity, not decoration; do not recolor them per surface.

## Typography

**Display / UI Font:** Segoe UI (with system-ui, -apple-system, Roboto fallback) — the workhorse UI voice, appropriate to an Operate surface.
**Readout Font:** Consolas (with ui-monospace, SF Mono, Roboto Mono fallback) — the measured numeral, used for readouts and data cells.

**Character:** A precise, unshowy pairing. The sans carries all prose, labels, and headings; the monospace is reserved for numbers that behave like instrument output — big KPI values, table figures, meter values, the brand chip.

### Hierarchy
- **Headline** (650, 1.9rem, 1.15): page title in the header.
- **Title** (640, 1.2rem, -0.01em): card/section headings.
- **Body** (400, 1rem, 1.5): prose, the executive-summary lede (max ~71ch).
- **Label** (600, 0.77rem, 0.06em, UPPERCASE): KPI labels, field labels, filter labels — the engraved caps of the bench.
- **Readout** (600, 2.25rem mono, tabular): the lead KPI value and every measured numeral; hero KPI steps to 2.5rem.

### Named Rules
**The Measured-Numeral Rule.** Any figure a user would compare, scan a column of, or trust as a measurement is set in the readout monospace with `tabular-nums`. Prose figures inside sentences stay in the sans.

**The Engraved-Label Rule.** Labels are uppercase, 0.06em tracked, muted — read as scribed captions on an instrument, never as body text.

## Layout

A fixed 236px sidebar rail plus a fluid main column (`max-width: 1440px`, padded 2rem). Content stacks in full-width sections; wide content (charts, tables) scrolls inside its own `overflow-x` container so the page body never scrolls horizontally. Spacing rhythm is generous between sections (1.375rem) and tight within groups; more space sits above a heading than below it. Below 820px the rail collapses to a horizontal top bar and readouts step down in scale. Reach is keyed off input method rather than width: under `(pointer: coarse)` every key — nav link, button, segmented key, sort key, row link — clears a 44px touch floor, and the deliberately small marks (the 16px InfoTip dot) keep their drawn size while an invisible 44px pad grows beneath them, so a touchscreen laptop gets the reach at any width and a mouse-driven small window never pays for it.

## Elevation & Depth

**Flat by rule.** The bench conveys depth with crisp hairline rules and tonal layering (page → panel → recessed), not floating shadows. `--shadow-1` is a near-invisible 1px seat (`0 1px 0 rgba(30,32,36,.05)`); real elevation is reserved for transient popovers only.

### Shadow Vocabulary
- **Seat** (`box-shadow: 0 1px 0 rgba(30,32,36,0.05)`): the barely-there rest state on cards and selected segments.
- **Popover** (`box-shadow: 0 6px 22px rgba(20,22,26,0.14)`): tooltips and floating panels only.

### Named Rules
**The Line-Not-Shadow Rule.** Structure is drawn with 1px scribed rules and tonal steps. If a surface needs to feel distinct, change its tone or give it a hairline — do not lift it on a shadow.

## Shapes

Squared and precise. Corners are small and uniform: `--radius-sm` (4px) for controls, `--radius` (6px) for cards and panels; only true pills (status badges, tags, counts) use 999px. Borders are 1px scribed hairlines (`--rule`); the darker `--tick` marks index details like the brand chip's edge and the nav witness tick.

## Components

### Buttons
- **Shape:** squared (4px, `--radius-sm`).
- **Default:** panel background, graphite text, 1px scribed border, padding 0.5rem 0.9rem. Hover shifts the border to scribe-red.
- **Primary:** scribe-red fill, panel-colored text, padding 0.4rem 0.85rem — the one loud control, used for a single confirming action (e.g. save thresholds).
- **Focus:** scribe-red ring/border shift; never a glow.

### Cards / Containers
- **Corner:** 6px (`--radius`).
- **Background:** panel (#f5f4ef); page ground behind.
- **Elevation:** Seat only (see Elevation).
- **Border:** 1px scribed rule.
- **Padding:** 1.25rem 1.38rem 1.4rem.

### Inputs / Fields
- **Style:** recessed background, 1px scribed border, 4px corners — sits *into* the panel like a milled slot.
- **Focus:** border shifts to scribe-red (search adds a soft scribe-red ring).

### App shell (PR 10)
- **Sidebar — the control panel.** A nameplate (brass-numeral chip, wordmark, and an engraved `Retell × Odoo` join designation in readout caps) is seated above the keys by a scribed hairline; the theme switch sits in its own bay below a second hairline. Depth is tone + rule, never shadow.
- **Header — the instrument label plate.** Page title and its fine-print reading, seated on a scribed bottom rule that spans the plate; the meta line is engraved muted fine-print.
- **Nav glyphs.** One consistent stroke/weight (1.7, round) drawn in the bench's grammar: a dial gauge (After-Hours), a surveyor's ruled log (All Calls), measured columns on a baseline (Cost & Volume), surveyed figures (Clients).

### Navigation
- **Style:** plain `#/path` anchors, sans, secondary ink at rest.
- **Hover:** panel background, ink brightens, and a faint graphite index nub (`--tick`) previews the key.
- **Active (selected key):** inset panel with a 1px rule; the graphite nub seats into a full scribe-red index tick on the rail edge — a depressed, indexed instrument key. Only the active key wears red, so the screen keeps its single witness mark.
- **Focus:** inset scribe-red hairline ring; never a glow.
- **Mobile:** rail becomes a horizontal top bar; the nameplate divides the keys with a vertical scribe and its designation caption is dropped.

### Theme switch
- A labelled control, not a coloured dot: a state glyph (system half-disc / light sun / dark moon) names the choice, an engraved `Theme` key, and the value in readout figures. It carries no accent red — the active-nav witness owns the screen's single red.

### Status Badge
- Pill with a dot **and** a word (Healthy / Warning / Critical), tinted from good/warning/critical. Color is never the only signal.

### Headline readouts (PR 11)
- **Executive summary — the plate that reads first.** The plain-English verdict leads the surface. It earns primacy by position, a scribed hairline under its heading, and calm panel tone — never by a witness-red edge (that red belongs to the active nav key). In-sentence figures stay in the sans per the Measured-Numeral Rule.
- **Dial-gauge readout (signature).** The lead KPI ($/after-hours call) is a semicircular scribed tick scale with a graphite needle and hub. The value sweep is drawn in the after-hours identity hue (steel-blue); the reading itself is shown as a tabular readout in the face beside the dial, with its health status named by the badge. When the metric carries a health rule, the warning and healthy lines are struck onto the scale as small `--warning` / `--good` witness ticks — the same thresholds the badge names in words, so colour is never the sole signal. The scale auto-ranges to a clean instrument max above the reading and its thresholds. Purely presentational: the SVG is `aria-hidden` since the value is real text.
- **The bench (one continuous surface).** The remaining KPIs are instrument readouts seated on a single scribed surface — one bordered panel whose interior is divided by 1px hairline rules (a `--rule` ground showing through a 1px grid gap), never separate floating cards. Depth is line, not shadow.
- **Scribed trace.** The KPI sparkline is a thin trace in the after-hours steel-blue, drawn on a hairline baseline rule with a witness tick at the latest reading — a measurement scribed onto the bench, not a decorative swoosh. It carries no witness red.

### Data visualizations (PR 12)
- **Story-pole funnel (signature).** The after-hours conversion funnel is a vertical scribed story pole: one continuous 2px graphite rule with each stage struck onto it as a graduation node, and a steel-blue (after-hours identity) measure bar dimensioned off every node with its cumulative after-hours count and expected dollars in tabular readouts. Because counts are cumulative, the increments shrink down the pole like a real measuring stick. Not a bar chart and not Recharts — the bars are `aria-hidden`; every figure is real text, so the reading survives without the graphic. Empty windows degrade to an honest one-line note.
- **Two-needle split (signature).** A two-category comparison drawn as two needles reading against one shared scribed rule: the after-hours needle drops from above, its partner rises from below, both pointing at their value on the same 0→instrument-max graduation (auto-ranged with the dial's `niceCeil` vocabulary). The rule and needles are `aria-hidden`; the tabular readouts beneath — engraved label, count, share — carry the accessible figures. Its canonical pairing is after-hours vs business-hours; it also draws the matched-vs-unmatched caller split on the Clients surface, keeping each channel's fixed identity hue.
- **Trend graticule.** The daily-volume trend is drawn in the bench's line grammar: a dashed `--grid` graticule under a hairline `--axis`, axis figures set in the tabular readout numerals, the matched channel traced in after-hours steel-blue over a soft wash, and the unmatched remainder in `--series-neutral` graphite (it is not a business-hours category, so it stays off the identity hues). The cursor is a dashed `--tick` scribe; the tooltip is the one sanctioned popover (real elevation via `--shadow-2`).
- **The reading behind the chart.** The three library-drawn surfaces (daily volume, won revenue, the trends metrics) cannot carry their figures as text the way the hand-drawn instruments do, so each marks its graphic `aria-hidden` and ships a `ChartDataTable` — the same series as a plain, visually-hidden table. Same rule as the story pole and the dial: the measurement survives without the drawing. The scroll container around each chart is a labelled keyboard stop, so the columns past the fold are reachable without a pointer.

### Field-measure log (PR 13)
- **The calls table as a surveyor's ruled log (signature).** The per-call table is read as a field-measure log: engraved uppercase column captions struck onto a darker `--tick` datum line, each call a ruled observation separated by a 1px `--rule` hairline, and the row lightening to recessed tone under the reading eye on hover. Depth is line and tone — never a lifted row or shadow.
- **Measured figures in the readout numerals.** The three columns a user scans as measurements — the reading time, the caller's phone number, and the expected revenue — are set in the readout monospace with `tabular-nums`; the name/stage/rep captions stay in the sans. Revenue right-aligns so a column of dollars scans down a common edge.
- **Sortable captions.** Time and Revenue captions are quiet sort controls that wear a small `--tick` caret only when they are the active key; the caret brightens and the caption goes graphite on sort, and focus takes the scribe-red witness ring. Nulls always sort last, either direction.
- **Outcome stamp (icon + word).** Won / lost / open is a struck stamp: a drawn mark (check / cross / hollow ring, one 2.2px round stroke, `aria-hidden`) paired with the word, tinted from `--good` / `--critical` for the resolved states and left quiet muted for open — colour is never the sole signal.
- **Milled deep-link tabs.** The Retell and Odoo links are squared milled tabs on the recessed panel; a hovered or focused link takes the scribe-red witness (only one is ever hovered at a time, so the screen keeps its single red mark), and an unavailable destination renders as a dimmed, un-clickable tab with an explaining title.
- **Bench controls.** The search field is a recessed milled slot with a scribe-red focus ring; the All-Calls segmented filter is a set of instrument keys whose selected key depresses into an inset panel with a graphite `--tick` index nub (never the witness red, which the active nav key owns) and a neutral tabular count; the global date-range control is recessed selects with the date inputs set in the readout numerals; the "?" info affordance opens the one sanctioned popover (`--shadow-2`).

### Loading / error / empty states (PR 10)
- **Loading:** a calm graphite calibrating sweep on a `--grid` track — the bench taking a reading. Deliberately not scribe-red; honours reduced-motion by resting filled.
- **Error:** a quiet plate led by a triangular alert glyph in `--critical` + a word, on a muted-critical hairline (`role="alert"`). Critical hue always travels with the icon and text.
- **Empty:** a plate led by an at-rest dial-gauge glyph in `--text-muted` + a word, then an honest recovery line.

### Whole-surface composition (PR 14)
The four surfaces are composed to read as one continuous bench; the signature instruments (dial-gauge readout, story-pole funnel, two-needle split, field-measure log) are all shipped and documented in the sections above.
- **One shared KPI vocabulary.** Every surface seats its headline metrics on the same continuous scribed surface (`.kpi-bench`), four readouts four-up — the After-Hours headline included, since the distill pass cut it from six. Columns are set per cell-count (4-up → 2-up → a single stacked column) rather than `auto-fit`, so a partial last row never leaves an empty track showing as a gray "missing tooth". No surface uses free-standing KPI cards — that is the anti-reference.
- **Section rhythm.** Sections stack in one rhythm with more space above a heading than below it: generous separation between panels (`--space-lg`, 1.375rem), tight spacing from a heading to its note. Wide content (charts, tables) scrolls inside its own container so the page body never scrolls horizontally.
- **The page close (signature).** Every surface ends on one scribed provenance datum — a survey sheet's footer stamp seated below a single hairline with generous space above: an engraved `Read-only` key, the source (`conversion.json`, the Retell × Odoo join), and the calls-in-window count in the readout numerals. It carries no witness red and reinforces the two product truths the figures never state — the dashboard is read-only, and the number is the join.

## Do's and Don'ts

### Do:
- **Do** set every measured figure in the readout monospace with `tabular-nums`; keep in-sentence figures in the sans.
- **Do** convey structure and depth with 1px scribed rules and tonal layering (page → panel → recessed).
- **Do** keep after-hours steel-blue (#2f6a92) and business-hours brass-amber (#b07a2e) fixed across every surface.
- **Do** pair every status/health color with an icon and a word.
- **Do** keep corners small and uniform (4px controls, 6px cards).

### Don't:
- **Don't** spend scribe-red on anything but a witness mark (active nav, focus, link, single primary action).
- **Don't** reintroduce floating drop-shadow cards or the indigo SaaS-dashboard look — that is the anti-reference.
- **Don't** use a colored `border-left` wider than 2px, or a shadow, to signal emphasis; use tone, rule, or type weight.
- **Don't** use the readout monospace for prose — it is for measurement only.
- **Don't** recolor the data pair per chart or invent a third series hue without extending this system.
- **Don't** colour a word with a base status or series hue — that is what the `-ink` tier is for.
- **Don't** draw a data series in `--axis` or `--grid`; those are graticule values and sit below the 3:1 floor.
