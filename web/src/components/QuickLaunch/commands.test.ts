import { describe, expect, it } from 'vitest';
import {
  buildNavCommands,
  loadRecents,
  rankCommands,
  recordRecent,
  scoreCommand,
  type PaletteCommand,
} from './commands';

function cmd(overrides: Partial<PaletteCommand> & { id: string; name: string }): PaletteCommand {
  return { description: '', keywords: [], section: 'Navigate', ...overrides };
}

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('buildNavCommands', () => {
  it('mirrors the feature-gated top nav, including Loom and Admin when enabled', () => {
    const commands = buildNavCommands({ rbac: { enabled: true } });
    const hrefs = commands.map((c) => c.href);
    // Base pages present
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/infra');
    expect(hrefs).toContain('/admin');
    // Loom control plane defaults ON and is the primary target (not /loom-hud)
    expect(hrefs).toContain('/loom');
    expect(hrefs).not.toContain('/loom-hud');
  });

  it('falls back to legacy Loom HUD nav when the control plane flag is off', () => {
    const commands = buildNavCommands({ loom_control_plane: { enabled: false } });
    const hrefs = commands.map((c) => c.href);
    expect(hrefs).toContain('/loom-hud');
    // No control-plane deep links in legacy mode
    expect(commands.filter((c) => c.section === 'Loom')).toHaveLength(0);
  });

  it('exposes deep links for Loom surfaces and Workbench sections', () => {
    const commands = buildNavCommands({});
    const hrefs = commands.map((c) => c.href);
    expect(hrefs).toContain('/loom?tab=mills');
    expect(hrefs).toContain('/loom?tab=flightdeck');
    expect(hrefs).toContain('/flexinfer?section=gpu-fleet');
    // Fleet is the Loom default tab → clean URL
    const fleet = commands.find((c) => c.id === 'loom:fleet');
    expect(fleet?.href).toBe('/loom');
  });

  it('hides Admin when no admin-ish feature is enabled', () => {
    const hrefs = buildNavCommands({}).map((c) => c.href);
    expect(hrefs).not.toContain('/admin');
  });
});

describe('scoreCommand', () => {
  const gpuFleet = cmd({
    id: 'flexinfer:gpu-fleet',
    name: 'FlexInfer · GPU Fleet',
    description: 'Jump to the GPU Fleet section',
    keywords: ['nodes', 'gaming', 'swap'],
  });

  it('ranks name prefix over word prefix over keyword match', () => {
    expect(scoreCommand(gpuFleet, 'flexinfer')).toBeGreaterThan(scoreCommand(gpuFleet, 'gpu'));
    expect(scoreCommand(gpuFleet, 'gpu')).toBeGreaterThan(scoreCommand(gpuFleet, 'swap'));
    expect(scoreCommand(gpuFleet, 'swap')).toBeGreaterThan(0);
  });

  it('matches subsequences as a last resort and rejects non-matches', () => {
    expect(scoreCommand(gpuFleet, 'fift')).toBeGreaterThan(0); // F-l-e-x-I-n-F-e-r … subsequence
    expect(scoreCommand(gpuFleet, 'zzz')).toBe(0);
  });

  it('treats an empty query as a universal match', () => {
    expect(scoreCommand(gpuFleet, '')).toBeGreaterThan(0);
  });
});

describe('rankCommands', () => {
  const commands = [
    cmd({ id: 'a', name: 'Go to Dashboard', keywords: ['home'] }),
    cmd({ id: 'b', name: 'Go to Services', keywords: ['pods'] }),
    cmd({ id: 'c', name: 'Go to Stack', keywords: ['repos'] }),
  ];

  it('puts recents first (in recency order) when the query is empty', () => {
    const ranked = rankCommands(commands, '', ['c', 'a']);
    expect(ranked.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('filters and orders by score when a query is present', () => {
    // Services/Stack match as substrings; Dashboard only as a weak
    // subsequence ("…da-s-hboard") and ranks last.
    const ranked = rankCommands(commands, 'go to s', []);
    expect(ranked.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(rankCommands(commands, 'zzz', [])).toEqual([]);
  });

  it('boosts recents on tied scores', () => {
    const ranked = rankCommands(commands, 'go to', ['c']);
    expect(ranked[0].id).toBe('c');
  });
});

describe('recents persistence', () => {
  it('records most-recent-first, dedupes, and caps at 8', () => {
    const storage = new MemoryStorage();
    for (const id of ['a', 'b', 'c', 'a']) recordRecent(id, storage);
    expect(loadRecents(storage)).toEqual(['a', 'c', 'b']);

    for (let i = 0; i < 10; i++) recordRecent(`x${i}`, storage);
    expect(loadRecents(storage)).toHaveLength(8);
    expect(loadRecents(storage)[0]).toBe('x9');
  });

  it('survives corrupted storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('flexdeck.palette.recents', '{not json');
    expect(loadRecents(storage)).toEqual([]);
  });
});
