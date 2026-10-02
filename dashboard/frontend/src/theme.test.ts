/**
 * Guards on the token layer itself.
 *
 * Two defects motivated these. The dark palette is written twice — once under
 * the OS media query, once under the in-app `[data-theme='dark']` toggle — and
 * the two silently drifted: the soft washes were declared only in the first, so
 * choosing Dark on a light-OS machine rendered the trend fills in light-theme
 * values. And the status badges set text and background to the same hue, which
 * costs contrast rather than adding it, leaving every badge below WCAG AA.
 *
 * Both are invisible to a type-checker and to any test that renders a component,
 * so they are asserted here, against the stylesheet as written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf-8');

/** The declarations inside the block a selector opens, as a token → value map. */
function block(startPattern: RegExp): Record<string, string> {
  const start = css.search(startPattern);
  expect(start, `block not found: ${startPattern}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const light = block(/^:root \{/m);
const darkMedia = block(/:root:where\(:not\(\[data-theme='light'\]\)\) \{/);
const darkToggle = block(/:root\[data-theme='dark'\] \{/);

// ---------------------------------------------------------------------------
// Colour maths (WCAG 2.x relative luminance / contrast ratio)
// ---------------------------------------------------------------------------
type Rgb = [number, number, number];

function parse(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  throw new Error(`cannot parse colour: ${value}`);
}

function alphaOf(value: string): number {
  const m = /rgba\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+[,\s/]+([\d.]+)\s*\)/i.exec(value);
  return m ? Number(m[1]) : 1;
}

const composite = (fg: Rgb, a: number, bg: Rgb): Rgb =>
  fg.map((c, i) => c * a + bg[i] * (1 - a)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the dark palette is declared identically in both places', () => {
  it('the media query and the in-app toggle set the same tokens', () => {
    // The values may differ in formatting; the *set* must not. A token present in
    // one and missing from the other falls back to its light value in that path —
    // exactly the bug that shipped the light washes into the toggled dark theme.
    expect(Object.keys(darkToggle).sort()).toEqual(Object.keys(darkMedia).sort());
  });

  it('sets the same value for every token', () => {
    for (const token of Object.keys(darkMedia)) {
      expect(darkToggle[token], token).toBe(darkMedia[token]);
    }
  });

  it('overrides every colour token the light theme defines', () => {
    const colourish = Object.keys(light).filter(
      (t) => /^#|^rgba?\(/.test(light[t]) || light[t].startsWith('var(--'),
    );
    // --border is an alias of --rule and rides along with it.
    const aliases = new Set(['--border']);
    for (const token of colourish) {
      if (aliases.has(token)) continue;
      expect(darkMedia, `${token} has no dark value`).toHaveProperty(token);
    }
  });
});

describe('the -ink tier clears WCAG AA on the grounds it is used against', () => {
  // Each badge sets `color: var(--x-ink)` over `background: var(--x-soft)`, and
  // that wash sits on a panel, a recessed row, or the page. The text must clear
  // 4.5:1 on all of them, not just the friendliest one.
  const pairs = [
    ['--good-ink', '--good-soft'],
    ['--warning-ink', '--warning-soft'],
    ['--critical-ink', '--critical-soft'],
    ['--series-after-ink', '--series-after-soft'],
    ['--series-business-ink', '--series-business-soft'],
  ] as const;

  for (const [theme, tokens] of [
    ['light', light],
    ['dark', { ...light, ...darkMedia }],
  ] as const) {
    const grounds = (['--surface-1', '--surface-2', '--page'] as const).map((g) =>
      parse(tokens[g]),
    );

    for (const [ink, soft] of pairs) {
      it(`${theme}: ${ink} reads at 4.5:1 or better`, () => {
        const fg = parse(tokens[ink]);
        const wash = parse(tokens[soft]);
        const alpha = alphaOf(tokens[soft]);
        for (const ground of grounds) {
          expect(contrast(fg, ground)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(fg, composite(wash, alpha, ground))).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    it(`${theme}: --accent reads at 4.5:1 as link and sort-key text`, () => {
      for (const ground of grounds) {
        expect(contrast(parse(tokens['--accent']), ground)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: the primary button's label clears 4.5:1 on its accent fill`, () => {
      expect(
        contrast(parse(tokens['--accent-contrast']), parse(tokens['--accent'])),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: --series-neutral clears the 3:1 floor for a data mark`, () => {
      // A chart series is a graphical object required to understand the content
      // (WCAG 1.4.11). --axis, which this replaced, read 2.2:1 light / 1.5:1 dark.
      for (const ground of grounds) {
        expect(contrast(parse(tokens['--series-neutral']), ground)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme}: body and muted text clear 4.5:1`, () => {
      for (const token of ['--text-primary', '--text-secondary', '--text-muted'] as const) {
        for (const ground of grounds) {
          expect(contrast(parse(tokens[token]), ground), `${token}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
