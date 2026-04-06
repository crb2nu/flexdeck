/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const modelComparisonMocks = vi.hoisted(() => ({
  api: vi.fn(),
  crd: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: modelComparisonMocks.api,
  modelsApi: {
    crd: modelComparisonMocks.crd,
  },
}));

import ModelComparison from './ModelComparison';

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

describe('ModelComparison', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    modelComparisonMocks.crd.mockReset();
    modelComparisonMocks.api.mockReset();

    modelComparisonMocks.crd.mockResolvedValue({
      models: [
        {
          name: 'alpha',
          namespace: 'flexinfer-system',
          spec: { source: 'hf://alpha', backend: 'vllm' },
          status: {
            phase: 'Ready',
            metrics: {
              tokensPerSecond: '42.5',
              avgLatencyMs: '120.0',
            },
            gpu: {
              memoryMB: 24576,
              node: 'gpu-a',
            },
          },
        },
        {
          name: 'beta',
          namespace: 'flexinfer-system',
          spec: { source: 'hf://beta', backend: 'vllm' },
          status: {
            phase: 'Ready',
            metrics: {
              tokensPerSecond: '35.0',
              avgLatencyMs: '140.0',
            },
            gpu: {
              memoryMB: 16384,
              node: 'gpu-b',
            },
          },
        },
        {
          name: 'warming',
          namespace: 'flexinfer-system',
          spec: { source: 'hf://warming', backend: 'vllm' },
          status: {
            phase: 'Pending',
          },
        },
      ],
    });

    modelComparisonMocks.api.mockResolvedValue({
      models: [
        {
          modelName: 'alpha',
          gpuUtilization: 65,
          vramUsedPercent: 72,
        },
        {
          modelName: 'beta',
          gpuUtilization: 58,
          vramUsedPercent: 68,
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
  });

  it('loads ready models and renders comparison data after selecting two models', async () => {
    cleanup = mount(() => <ModelComparison />);
    await flush();

    const warmingButton = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('warming'),
    );
    expect(warmingButton).toBeUndefined();

    const alphaButton = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('alpha'),
    ) as HTMLButtonElement | undefined;
    const betaButton = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('beta'),
    ) as HTMLButtonElement | undefined;

    expect(alphaButton).toBeTruthy();
    expect(betaButton).toBeTruthy();

    alphaButton!.click();
    betaButton!.click();
    await flush();

    const pageText = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain('Throughput (tok/s)');
    expect(pageText).toContain('42.5 tok/s');
    expect(pageText).toContain('35.0 tok/s');
    expect(pageText).toContain('GPU Node');
    expect(pageText).toContain('gpu-a');
    expect(pageText).toContain('gpu-b');
  });
});
