# Design reference — impeccable.style

`impeccable.style.html` is a local snapshot of <https://impeccable.style/>
(downloaded 2026-08-06), kept as the design reference for the dashboard's
"modern" KPI/graph refresh.

Impeccable is a design vocabulary for spotting and removing "AI slop" — the
predictable tells of machine-generated UI. The KPI row and charts follow its
principles:

- **No slop decoration.** Dropped the tile drop-shadows, the hover-lift motion,
  and the heavy white bar separators — all flagged tells (drop shadow,
  image-on-hover motion, ghost-cards).
- **Hierarchy by type, not color.** The lead metric ($/after-hours call) is the
  only accented tile (a single top rule); everything else earns emphasis from
  the numeral scale and tabular figures.
- **One continuous surface.** KPI tiles share hairline seams instead of floating
  as separate rounded cards (avoids "cards in cards").
- **System respect.** The existing theme tokens (`theme.css`) are reused, not
  overwritten — the amber-neutral palette impeccable itself favours is noted but
  the project's own accent/series roles are kept.

The snapshot is a reference only; nothing imports from it.
