import { describe, expect, it, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import { createPersistedSignal, oneOf } from './createPersistedSignal';

const isMode = oneOf(['2d', '3d']);

describe('createPersistedSignal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the initial value and persists changes', () => {
    createRoot((dispose) => {
      const [mode, setMode] = createPersistedSignal('test.mode', '2d', isMode);
      expect(mode()).toBe('2d');
      // Defaults never pollute storage — only explicit changes are written.
      expect(localStorage.getItem('flexdeck.pref.test.mode')).toBeNull();
      setMode('3d');
      expect(localStorage.getItem('flexdeck.pref.test.mode')).toBe('"3d"');
      dispose();
    });
  });

  it('supports functional updates', () => {
    createRoot((dispose) => {
      const [mode, setMode] = createPersistedSignal('test.mode', '2d', isMode);
      setMode((m) => (m === '2d' ? '3d' : '2d'));
      expect(mode()).toBe('3d');
      expect(localStorage.getItem('flexdeck.pref.test.mode')).toBe('"3d"');
      dispose();
    });
  });

  it('restores a previously persisted value', () => {
    localStorage.setItem('flexdeck.pref.test.mode', '"3d"');
    createRoot((dispose) => {
      const [mode] = createPersistedSignal('test.mode', '2d', isMode);
      expect(mode()).toBe('3d');
      dispose();
    });
  });

  it('falls back to initial on invalid or corrupted stored values', () => {
    localStorage.setItem('flexdeck.pref.test.mode', '"holodeck-9"');
    createRoot((dispose) => {
      const [mode] = createPersistedSignal('test.mode', '2d', isMode);
      expect(mode()).toBe('2d');
      dispose();
    });

    localStorage.setItem('flexdeck.pref.test.mode', '{not json');
    createRoot((dispose) => {
      const [mode] = createPersistedSignal('test.mode', '2d', isMode);
      expect(mode()).toBe('2d');
      dispose();
    });
  });

  it('supports non-string shapes with a custom guard', () => {
    const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
    createRoot((dispose) => {
      const [hidden, setHidden] = createPersistedSignal('test.hidden', false, isBool);
      setHidden(true);
      expect(hidden()).toBe(true);
      expect(localStorage.getItem('flexdeck.pref.test.hidden')).toBe('true');
      dispose();
    });
    createRoot((dispose) => {
      const [hidden] = createPersistedSignal('test.hidden', false, isBool);
      expect(hidden()).toBe(true);
      dispose();
    });
  });
});
