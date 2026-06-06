/**
 * sanitizeError — turn raw backend/transport error strings into calm,
 * human-readable copy for the UI.
 *
 * A premium console never shows a user a Go filesystem path, a panic stack,
 * or `dial tcp ...: connect: connection refused`. This maps the common shapes
 * to friendly copy while being deliberately CONSERVATIVE: anything it does not
 * recognize passes through unchanged (only trimmed + length-capped), and the
 * ORIGINAL casing is preserved for pass-through text so existing copy/tests are
 * not disturbed.
 *
 * Strategy:
 *  1. Unwrap `{"error": "..."}` / `{"message": "..."}` JSON bodies.
 *  2. Strip leaked technical tails (e.g. `: stat /home/x: no such file or
 *     directory`) while KEEPING any human lead text before them.
 *  3. If nothing human remains, fall back to a friendly per-category message.
 */

const MAX_LEN = 160;

// Friendly copy for fully-technical errors (checked against the raw text).
const FRIENDLY: Array<[RegExp, string]> = [
  [/connection refused|dial tcp|no route to host|econnrefused|connect: /i, 'Could not reach an upstream service.'],
  [/context deadline exceeded|i\/o timeout|\btimed? ?out\b|deadline exceeded/i, 'The request timed out — the service may be busy.'],
  [/\bunexpected eof\b|\beof\b/i, 'The connection closed unexpectedly. Please retry.'],
  [/panic:|goroutine \d+ \[|runtime error:/i, 'The server hit an unexpected error.'],
  [/\bhttp 5\d\d\b|status(?: code)? 5\d\d|internal server error/i, 'The server hit an internal error. Please retry.'],
  [/\bhttp 429\b|too many requests|rate ?limit/i, 'Too many requests — please slow down and retry.'],
  [/permission denied|\bforbidden\b|\bunauthorized\b|\bhttp 40[13]\b/i, 'Access to this resource was denied.'],
];

// Technical tails to strip while preserving any human lead text.
const TECHNICAL_TAILS: RegExp[] = [
  /[:\-,]?\s*l?stat\s+\S+:\s*no such file or directory\.?/gi,
  /[:\-,]?\s*open\s+\S+:\s*no such file or directory\.?/gi,
  /[:\-,]?\s*\S+:\s*no such file or directory\.?/gi,
  /[:\-,]?\s*dial tcp\s+\S+:\s*connect:[^.]*\.?/gi,
];

function unwrapJson(text: string): string {
  if (!(text.startsWith('{') && text.endsWith('}'))) return text;
  try {
    const parsed = JSON.parse(text);
    const candidate =
      (typeof parsed?.error === 'string' && parsed.error) ||
      (typeof parsed?.error?.message === 'string' && parsed.error.message) ||
      (typeof parsed?.message === 'string' && parsed.message) ||
      '';
    return candidate || text;
  } catch {
    return text;
  }
}

function cap(text: string): string {
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1).trimEnd()}…` : text;
}

export function sanitizeError(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  text = (text ?? '').trim();
  if (!text) return 'Something went wrong.';

  text = unwrapJson(text).trim();

  // Strip leaked technical tails, keep readable lead text.
  let stripped = text;
  for (const tail of TECHNICAL_TAILS) stripped = stripped.replace(tail, '');
  stripped = stripped.replace(/\s{2,}/g, ' ').replace(/[\s:,–-]+$/g, '').trim();

  if (stripped && stripped !== text && stripped.length >= 4 && /[a-z0-9]/i.test(stripped)) {
    return cap(stripped);
  }

  for (const [re, msg] of FRIENDLY) {
    if (re.test(text)) return msg;
  }

  // Recognized-but-no-human-lead filesystem error.
  if (/no such file or directory/i.test(text)) {
    return 'A required resource was not found on the server.';
  }

  return cap(text);
}
