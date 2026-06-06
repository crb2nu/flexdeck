import { describe, expect, it } from 'vitest';
import { sanitizeError } from './sanitizeError';

describe('sanitizeError', () => {
  it('returns a calm default for empty / non-string input', () => {
    expect(sanitizeError('')).toBe('Something went wrong.');
    expect(sanitizeError('   ')).toBe('Something went wrong.');
    expect(sanitizeError(null)).toBe('Something went wrong.');
    expect(sanitizeError(undefined)).toBe('Something went wrong.');
    expect(sanitizeError(42)).toBe('Something went wrong.');
  });

  it('strips a leaked Go fs path tail but keeps the human lead (the live Stack error)', () => {
    const raw = 'workspace root unavailable: stat /home/flexdeck/workspace: no such file or directory';
    expect(sanitizeError(raw)).toBe('workspace root unavailable');
  });

  it('preserves a clean message unchanged, including its original casing', () => {
    // The Stack test asserts this exact lowercase string still renders.
    expect(sanitizeError('workspace root not configured')).toBe('workspace root not configured');
    expect(sanitizeError('Failed to load workspace inventory')).toBe('Failed to load workspace inventory');
  });

  it('maps a path-only fs error (no human lead) to friendly copy', () => {
    expect(sanitizeError('stat /var/run/secret: no such file or directory')).toBe(
      'A required resource was not found on the server.',
    );
    expect(sanitizeError('open /etc/config.yaml: no such file or directory')).toBe(
      'A required resource was not found on the server.',
    );
  });

  it('maps transport failures to friendly copy', () => {
    expect(sanitizeError('dial tcp 10.0.0.5:8080: connect: connection refused')).toBe(
      'Could not reach an upstream service.',
    );
    expect(sanitizeError('Get "http://svc/api": context deadline exceeded')).toBe(
      'The request timed out — the service may be busy.',
    );
    expect(sanitizeError('unexpected EOF')).toBe('The connection closed unexpectedly. Please retry.');
  });

  it('maps HTTP status families to friendly copy', () => {
    expect(sanitizeError('HTTP 503')).toBe('The server hit an internal error. Please retry.');
    expect(sanitizeError('HTTP 429')).toBe('Too many requests — please slow down and retry.');
    expect(sanitizeError('HTTP 403 Forbidden')).toBe('Access to this resource was denied.');
  });

  it('maps a Go panic to friendly copy', () => {
    expect(sanitizeError('panic: runtime error: invalid memory address')).toBe(
      'The server hit an unexpected error.',
    );
  });

  it('unwraps a JSON error body', () => {
    expect(sanitizeError('{"error":"Failed to reach Grafana"}')).toBe('Failed to reach Grafana');
    expect(sanitizeError('{"error":{"message":"bad gateway"}}')).toBe('bad gateway');
    expect(sanitizeError('{"message":"queue full"}')).toBe('queue full');
  });

  it('accepts an Error instance', () => {
    expect(sanitizeError(new Error('connection refused'))).toBe('Could not reach an upstream service.');
  });

  it('caps very long messages', () => {
    const long = `prefix ${'x'.repeat(300)}`;
    const out = sanitizeError(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });
});
