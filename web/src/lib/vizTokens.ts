/**
 * Raw hex mirrors of the canonical design tokens in styles/variables.css for
 * renderers that cannot resolve CSS var(): canvas 2D fillStyle/strokeStyle/
 * shadowColor, three.js Color ints, and d3/SVG presentation attributes.
 *
 * This module is the single source of raw hex in web/src — every other
 * module imports from here. CSS-consumed sites (classes, inline styles)
 * must keep using var(--x) / rgb(var(--x-rgb)/N) / color-mix instead.
 *
 * Values are asserted against variables.css by vizTokens.test.ts, so drift
 * from the stylesheet fails CI.
 */
export const VIZ_TOKEN_HEX = {
  success: '#22e076', // --success
  warning: '#ffb830', // --warning
  error: '#ff3d71', // --error
  info: '#00c8ff', // --info
  accent: '#ff6b35', // --accent
  violet: '#b06cde', // --color-violet
  fgPrimary: '#d4eef4', // --fg-primary
  fgSecondary: '#8cc0cc', // --fg-secondary
  fgMuted: '#5c8a96', // --fg-muted
  bgPrimary: '#060c10', // --bg-primary
  bgSecondary: '#0d161b', // --bg-secondary
  bgTertiary: '#142127', // --bg-tertiary
  bgElevated: '#1b2b33', // --bg-elevated
} as const;

export type VizTokenName = keyof typeof VIZ_TOKEN_HEX;

/**
 * Derived tints with no dedicated CSS token — hover/highlight siblings of
 * canonical colors, kept here so no component carries ad-hoc hex.
 */
export const VIZ_ACCENT_LIGHT = '#ff8c4d'; // hover tint of --accent
export const VIZ_VIOLET_LIGHT = '#d0a7eb'; // edge/highlight tint of --color-violet

/** Categorical series palette — mirrors --viz-1..--viz-8. */
export const VIZ_SERIES_HEX: readonly string[] = [
  '#00c8ff', // --viz-1 cyan
  '#ff8a3d', // --viz-2 orange
  '#2dd4bf', // --viz-3 teal
  '#ffc24d', // --viz-4 amber
  '#b98cff', // --viz-5 violet
  '#9be564', // --viz-6 lime
  '#ff6fae', // --viz-7 pink
  '#5b9cff', // --viz-8 azure
] as const;

/** '#rrggbb' → 0xRRGGBB for three.js Color/material constructors. */
export const hexToInt = (hex: string): number => parseInt(hex.slice(1), 16);

export const tokenHexInt = (name: VizTokenName): number => hexToInt(VIZ_TOKEN_HEX[name]);

/** rgba() string for canvas painters that need a token color at an alpha. */
export const tokenRgba = (name: VizTokenName, alpha: number): string => {
  const int = tokenHexInt(name);
  return `rgba(${(int >> 16) & 0xff}, ${(int >> 8) & 0xff}, ${int & 0xff}, ${alpha})`;
};
