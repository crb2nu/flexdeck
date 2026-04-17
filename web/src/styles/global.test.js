/* global process */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const globalCss = readFileSync(`${process.cwd()}/src/styles/global.css`, 'utf8');

describe('surface hover styles', () => {
  it('keeps hover feedback on a paint-only overlay', () => {
    expect(globalCss).toContain('.surface-hover::before');
    expect(globalCss).toContain('.surface-hover:hover::before');
    expect(globalCss).toContain('.surface-hover:focus-within::before');
    expect(globalCss).toMatch(/\.surface-hover\s*{[^}]*position:\s*relative;/s);
    expect(globalCss).not.toMatch(/\.surface-hover\s*{[^}]*transition:\s*background/s);
  });
});
