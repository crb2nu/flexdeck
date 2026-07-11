import { describe, expect, it } from 'vitest';
// fs instead of a `?raw` import: vitest's CSS handling replaces .css module
// content (any query) with an empty string, so the stylesheet is read from
// disk to assert the mirror against the real token values.
import { readFileSync } from 'node:fs';
import {
  VIZ_SERIES_HEX,
  VIZ_TOKEN_HEX,
  hexToInt,
  tokenHexInt,
  tokenRgba,
  type VizTokenName,
} from './vizTokens';

// Relative to the vitest root (web/) — import.meta.url is an http:// URL
// under the jsdom environment, so it cannot anchor a filesystem path.
const css = readFileSync('src/styles/variables.css', 'utf-8');

const cssHex = (varName: string): string => {
  const match = css.match(new RegExp(`--${varName}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!match) throw new Error(`token --${varName} not found as hex in variables.css`);
  return match[1].toLowerCase();
};

const cssTripletHex = (varName: string): string => {
  const match = css.match(new RegExp(`--${varName}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  if (!match) throw new Error(`token --${varName} not found as triplet in variables.css`);
  const [r, g, b] = match.slice(1, 4).map(Number);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

const TOKEN_TO_CSS_VAR: Record<VizTokenName, string> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  accent: 'accent',
  violet: 'color-violet',
  fgPrimary: 'fg-primary',
  fgSecondary: 'fg-secondary',
  fgMuted: 'fg-muted',
  bgPrimary: 'bg-primary',
  bgSecondary: 'bg-secondary',
  bgTertiary: 'bg-tertiary',
  bgElevated: 'bg-elevated',
};

describe('vizTokens', () => {
  it.each(Object.entries(TOKEN_TO_CSS_VAR))(
    'VIZ_TOKEN_HEX.%s mirrors variables.css',
    (token, cssVar) => {
      expect(VIZ_TOKEN_HEX[token as VizTokenName].toLowerCase()).toBe(cssHex(cssVar));
    },
  );

  it('VIZ_SERIES_HEX mirrors --viz-1..--viz-8', () => {
    expect(VIZ_SERIES_HEX).toHaveLength(8);
    VIZ_SERIES_HEX.forEach((hex, i) => {
      expect(hex.toLowerCase()).toBe(cssTripletHex(`viz-${i + 1}`));
    });
  });

  it('hexToInt / tokenHexInt / tokenRgba agree', () => {
    expect(hexToInt('#00c8ff')).toBe(0x00c8ff);
    expect(tokenHexInt('info')).toBe(0x00c8ff);
    expect(tokenRgba('info', 0.4)).toBe('rgba(0, 200, 255, 0.4)');
    expect(tokenRgba('violet', 0.25)).toBe('rgba(176, 108, 222, 0.25)');
  });
});
