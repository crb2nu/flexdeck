/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpuTableMocks = vi.hoisted(() => ({
  api: vi.fn(),
  createPolling: vi.fn(),
}));

vi.mock('../../hooks/createPolling', () => ({
  createPolling: gpuTableMocks.createPolling,
}));

vi.mock('../../lib/api', () => ({
  api: gpuTableMocks.api,
}));

import ModelGPUTable from './ModelGPUTable';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ModelGPUTable', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    gpuTableMocks.api.mockReset();
    gpuTableMocks.createPolling.mockReset();
    gpuTableMocks.createPolling.mockImplementation(() => ({ trigger: vi.fn() }));
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
  });

  it('loads GPU rows on mount without waiting for polling', async () => {
    gpuTableMocks.api.mockResolvedValue({
      models: [
        {
          modelId: 'alpha-1',
          modelName: 'alpha',
          node: 'gpu-a',
          gpuUtilization: 72,
          vramUsedPercent: 81,
          temperature: 65,
          power: 210,
        },
        {
          modelId: 'alpha-2',
          modelName: 'alpha',
          node: 'gpu-a',
          gpuUtilization: 68,
          vramUsedPercent: 79,
          temperature: 67,
          power: 205,
        },
      ],
    });

    cleanup = mount(() => <ModelGPUTable />);
    await flush();

    expect(gpuTableMocks.api).toHaveBeenCalledWith('/k8s/metrics/gpu/models');
    expect(gpuTableMocks.createPolling).toHaveBeenCalledWith('gpu-models', expect.any(Function), 15000);

    const pageText = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain('GPU Usage by Model');
    expect(pageText).toContain('alpha');
    expect(pageText).toContain('gpu-a');
    expect(pageText).toContain('2');
    expect(pageText).toContain('70%');
    expect(pageText).toContain('80%');
  });
});
