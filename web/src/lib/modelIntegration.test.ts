import { beforeEach, describe, expect, it, vi } from 'vitest';

const { crdInferenceMock, loraMock, modelMetricsMock } = vi.hoisted(() => ({
  crdInferenceMock: vi.fn(),
  loraMock: vi.fn(),
  modelMetricsMock: vi.fn(),
}));

vi.mock('./api', () => ({
  modelsApi: {
    crdInference: crdInferenceMock,
    lora: loraMock,
  },
  litellm: {
    modelMetrics: modelMetricsMock,
  },
}));

import {
  __clearModelIntegrationsForTests,
  clearModelIntegrationsCache,
  fetchModelIntegrationsBatch,
  invalidateModelIntegration,
  modelRefKey,
} from './modelIntegration';

describe('modelIntegration', () => {
  beforeEach(() => {
    __clearModelIntegrationsForTests();
    crdInferenceMock.mockReset();
    loraMock.mockReset();
    modelMetricsMock.mockReset();
    modelMetricsMock.mockResolvedValue(null);
  });

  it('deduplicates duplicate model refs inside one batch', async () => {
    crdInferenceMock.mockResolvedValue({ model: 'alpha', tps: 1 });
    loraMock.mockResolvedValue({ adapters: [{ name: 'adapter-a', state: 'Loaded' }] });

    const result = await fetchModelIntegrationsBatch([
      { namespace: 'flexinfer-system', name: 'alpha' },
      { namespace: 'flexinfer-system', name: 'alpha' },
    ]);

    expect(Object.keys(result)).toEqual(['flexinfer-system/alpha']);
    expect(crdInferenceMock).toHaveBeenCalledTimes(1);
    expect(loraMock).toHaveBeenCalledTimes(1);
  });

  it('exposes a shared model key helper for cross-surface selectors', () => {
    expect(modelRefKey('flexinfer-system', 'alpha')).toBe('flexinfer-system/alpha');
  });

  it('reuses cached values across calls until invalidated', async () => {
    crdInferenceMock.mockResolvedValue({ model: 'alpha', tps: 1 });
    loraMock.mockResolvedValue({ adapters: [] });

    await fetchModelIntegrationsBatch([{ namespace: 'ns', name: 'alpha' }]);
    await fetchModelIntegrationsBatch([{ namespace: 'ns', name: 'alpha' }]);

    expect(crdInferenceMock).toHaveBeenCalledTimes(1);
    expect(loraMock).toHaveBeenCalledTimes(1);

    invalidateModelIntegration('ns', 'alpha');
    await fetchModelIntegrationsBatch([{ namespace: 'ns', name: 'alpha' }]);

    expect(crdInferenceMock).toHaveBeenCalledTimes(2);
    expect(loraMock).toHaveBeenCalledTimes(2);

    clearModelIntegrationsCache();
    await fetchModelIntegrationsBatch([{ namespace: 'ns', name: 'alpha' }]);

    expect(crdInferenceMock).toHaveBeenCalledTimes(3);
    expect(loraMock).toHaveBeenCalledTimes(3);
  });

  it('marks inference or LoRA as unavailable when calls fail', async () => {
    crdInferenceMock.mockRejectedValue(new Error('missing model'));
    loraMock.mockResolvedValue({ adapters: [] });

    const result = await fetchModelIntegrationsBatch([{ namespace: 'ns', name: 'beta' }], { force: true });
    const item = result['ns/beta'];

    expect(item?.inferenceAvailable).toBe(false);
    expect(item?.loraAvailable).toBe(true);
    expect(item?.metrics).toBeUndefined();
    expect(item?.adapters).toEqual([]);
  });

  it('reuses the same in-flight fetch across concurrent callers for one model key', async () => {
    let resolveInference: ((value: { model: string; tps: number }) => void) | undefined;
    let resolveLora: ((value: { adapters: { name: string; state: string }[] }) => void) | undefined;

    crdInferenceMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInference = resolve;
        })
    );
    loraMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLora = resolve;
        })
    );

    const refs = [{ namespace: 'ns', name: 'alpha' }];
    const first = fetchModelIntegrationsBatch(refs, { force: true });
    const second = fetchModelIntegrationsBatch(refs, { force: true });

    await Promise.resolve();

    expect(crdInferenceMock).toHaveBeenCalledTimes(1);
    expect(loraMock).toHaveBeenCalledTimes(1);
    expect(resolveInference).toBeTypeOf('function');
    expect(resolveLora).toBeTypeOf('function');

    resolveInference?.({ model: 'alpha', tps: 1 });
    resolveLora?.({ adapters: [{ name: 'adapter-a', state: 'Loaded' }] });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult['ns/alpha']).toEqual(secondResult['ns/alpha']);
    expect(firstResult['ns/alpha']?.inferenceAvailable).toBe(true);
    expect(firstResult['ns/alpha']?.loraAvailable).toBe(true);
  });

  it('limits concurrent integration fetches to the configured worker count', async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    crdInferenceMock.mockImplementation(
      (_namespace: string, name: string) =>
        new Promise((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active--;
            resolve({ model: name, tps: 1 });
          });
        })
    );
    loraMock.mockResolvedValue({ adapters: [] });

    const models = [
      { namespace: 'ns', name: 'alpha' },
      { namespace: 'ns', name: 'beta' },
      { namespace: 'ns', name: 'gamma' },
      { namespace: 'ns', name: 'delta' },
    ];

    const batchPromise = fetchModelIntegrationsBatch(models, { force: true, concurrency: 2 });

    await Promise.resolve();
    expect(crdInferenceMock).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);

    releases.splice(0, releases.length).forEach((release) => release());
    await vi.waitFor(() => {
      expect(crdInferenceMock).toHaveBeenCalledTimes(4);
    });
    expect(maxActive).toBe(2);

    releases.splice(0, releases.length).forEach((release) => release());
    await batchPromise;
  });
});
