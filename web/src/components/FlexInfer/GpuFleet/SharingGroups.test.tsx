import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlexInferModel } from '../../../lib/types';

const swapHistoryMock = vi.fn(async () => ({
  events: [
    { ts: '2026-07-12T10:00:00Z', model: 'qwen', ns: 'ai', group: 'gfx1100', oldState: 'Queued', newState: 'Active' },
  ],
  group: 'gfx1100',
  models: ['qwen'],
  summary: { totalSwaps: 1, avgQueueWaitSec: 30, modelStats: { qwen: { swapCount: 1, totalActiveSec: 60, totalQueuedSec: 30 } } },
}));

vi.mock('../../../lib/api', () => ({
  modelsApi: {
    groupSwapHistory: (...args: unknown[]) => swapHistoryMock(...(args as [])),
  },
}));

import SharingGroups from './SharingGroups';

function model(name: string, state: string): FlexInferModel {
  return {
    name,
    namespace: 'ai',
    creationTimestamp: '2026-01-01T00:00:00Z',
    spec: { backend: 'vllm', source: 'hf://x' },
    status: { sharedGroup: { groupName: 'gfx1100', state } },
  } as FlexInferModel;
}

describe('SharingGroups poll stability', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('keeps the card and timeline mounted across identical polls (no blank+redraw)', async () => {
    const [models, setModels] = createSignal([model('qwen', 'Active')]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(() => <SharingGroups models={models} />, container);

    // Wait for the timeline's first snapshot to render.
    await vi.waitFor(() => {
      expect(container.textContent).toContain('swaps');
    });
    const cardBefore = container.querySelector('.surface');
    expect(cardBefore).toBeTruthy();

    // A poll delivers fresh (but value-identical) model objects.
    setModels([model('qwen', 'Active')]);
    await Promise.resolve();

    // Same DOM node — the card was never torn down, so the embedded timeline
    // never reset to its loading state.
    expect(container.querySelector('.surface')).toBe(cardBefore);
    expect(container.textContent).not.toContain('Loading swap history');
  });

  it('updates member chips in place when a state changes, still without remounting', async () => {
    const [models, setModels] = createSignal([model('qwen', 'Active')]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(() => <SharingGroups models={models} />, container);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('swaps');
    });
    const cardBefore = container.querySelector('.surface');
    expect(container.textContent).toContain('Active');

    setModels([model('qwen', 'Queued')]);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Queued');
    });
    expect(container.querySelector('.surface')).toBe(cardBefore);
    expect(container.textContent).not.toContain('Loading swap history');
  });
});
