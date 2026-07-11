/**
 * Minimal ambient types for Node builtins used by tests.
 *
 * The app tsconfig is browser-targeted and intentionally has no @types/node;
 * vitest executes in Node, so tests that read fixture files (for example
 * lib/vizTokens.test.ts asserting against styles/variables.css) need just
 * this signature.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf-8'): string;
}
