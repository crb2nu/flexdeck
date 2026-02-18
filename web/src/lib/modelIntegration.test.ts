import { beforeEach, describe, expect, it, vi } from 'vitest';

const { crdInferenceMock, loraMock } = vi.hoisted(() => ({
  crdInferenceMock: vi.fn(),
  loraMock: vi.fn(),
}));

vi.mock('./api', () => ({
  modelsApi: {
    crdInference: crdInferenceMock,
    lora: loraMock,
  },
}));

import {
  __clearModelIntegrationsForTests,
  clearModelIntegrationsCache,
  fetchModelIntegrationsBatch,
  invalidateModelIntegration,
} from './modelIntegration';

describe('modelIntegration', () => {
  beforeEach(() => {
    __clearModelIntegrationsForTests();
    crdInferenceMock.mockReset();
    loraMock.mockReset();
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
});
