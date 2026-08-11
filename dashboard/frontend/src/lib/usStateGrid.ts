/**
 * A tile-grid cartogram of the US: every state (+ DC) placed as one cell in a
 * roughly US-shaped grid. This is deliberately NOT a pixel-accurate map — accurate
 * state geometry would mean bundling tens of KB of SVG path data, which we can't
 * fetch offline. A tile grid gives every state equal, legible area (small states
 * don't vanish) and still reads as "west / midwest / south / east" at a glance —
 * the right trade for an at-a-glance heatmap.
 *
 * Coordinates are 0-indexed [row, col]; row 0 is the north edge, col 0 the west.
 */
export const GRID_ROWS = 7;
export const GRID_COLS = 11;

export interface StateCell {
  row: number;
  col: number;
  name: string;
}

export const STATE_GRID: Record<string, StateCell> = {
  WA: { row: 0, col: 0, name: 'Washington' },
  MT: { row: 0, col: 2, name: 'Montana' },
  ND: { row: 0, col: 3, name: 'North Dakota' },
  MN: { row: 0, col: 4, name: 'Minnesota' },
  WI: { row: 0, col: 6, name: 'Wisconsin' },
  MI: { row: 0, col: 7, name: 'Michigan' },
  NY: { row: 0, col: 8, name: 'New York' },
  VT: { row: 0, col: 9, name: 'Vermont' },
  ME: { row: 0, col: 10, name: 'Maine' },

  ID: { row: 1, col: 1, name: 'Idaho' },
  SD: { row: 1, col: 3, name: 'South Dakota' },
  IA: { row: 1, col: 4, name: 'Iowa' },
  IL: { row: 1, col: 5, name: 'Illinois' },
  IN: { row: 1, col: 6, name: 'Indiana' },
  OH: { row: 1, col: 7, name: 'Ohio' },
  PA: { row: 1, col: 8, name: 'Pennsylvania' },
  NH: { row: 1, col: 9, name: 'New Hampshire' },
  MA: { row: 1, col: 10, name: 'Massachusetts' },

  OR: { row: 2, col: 0, name: 'Oregon' },
  NV: { row: 2, col: 1, name: 'Nevada' },
  WY: { row: 2, col: 2, name: 'Wyoming' },
  NE: { row: 2, col: 3, name: 'Nebraska' },
  MO: { row: 2, col: 4, name: 'Missouri' },
  KY: { row: 2, col: 5, name: 'Kentucky' },
  WV: { row: 2, col: 6, name: 'West Virginia' },
  VA: { row: 2, col: 7, name: 'Virginia' },
  NJ: { row: 2, col: 8, name: 'New Jersey' },
  CT: { row: 2, col: 9, name: 'Connecticut' },
  RI: { row: 2, col: 10, name: 'Rhode Island' },

  CA: { row: 3, col: 0, name: 'California' },
  UT: { row: 3, col: 1, name: 'Utah' },
  CO: { row: 3, col: 2, name: 'Colorado' },
  KS: { row: 3, col: 3, name: 'Kansas' },
  AR: { row: 3, col: 4, name: 'Arkansas' },
  TN: { row: 3, col: 5, name: 'Tennessee' },
  NC: { row: 3, col: 6, name: 'North Carolina' },
  MD: { row: 3, col: 7, name: 'Maryland' },
  DE: { row: 3, col: 8, name: 'Delaware' },

  AZ: { row: 4, col: 1, name: 'Arizona' },
  NM: { row: 4, col: 2, name: 'New Mexico' },
  OK: { row: 4, col: 3, name: 'Oklahoma' },
  LA: { row: 4, col: 4, name: 'Louisiana' },
  MS: { row: 4, col: 5, name: 'Mississippi' },
  AL: { row: 4, col: 6, name: 'Alabama' },
  SC: { row: 4, col: 7, name: 'South Carolina' },
  DC: { row: 4, col: 8, name: 'District of Columbia' },

  TX: { row: 5, col: 3, name: 'Texas' },
  GA: { row: 5, col: 6, name: 'Georgia' },

  HI: { row: 6, col: 0, name: 'Hawaii' },
  AK: { row: 6, col: 1, name: 'Alaska' },
  FL: { row: 6, col: 7, name: 'Florida' },
};

/** Full state name for a 2-letter code, or the code itself if unknown. */
export function stateName(code: string): string {
  return STATE_GRID[code]?.name ?? code;
}
