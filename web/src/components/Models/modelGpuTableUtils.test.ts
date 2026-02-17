import { describe, expect, it } from 'vitest';

import { aggregateModelGPUEntries, hasAnyGPUData, type ModelGPUEntry } from './modelGpuTableUtils';

describe('modelGpuTableUtils', () => {
  it('aggregates repeated model/node rows and computes averages', () => {
    const input: ModelGPUEntry[] = [
      {
        modelId: 'a1',
        modelName: 'qwen',
        node: 'node-a',
        gpuUtilization: 60,
        vramUsedPercent: 70,
        temperature: 80,
        power: 200,
      },
      {
        modelId: 'a2',
        modelName: 'qwen',
        node: 'node-a',
        gpuUtilization: 40,
        vramUsedPercent: 50,
        temperature: 76,
        power: 180,
      },
      {
        modelId: 'b1',
        modelName: 'glm',
        node: 'node-b',
        gpuUtilization: null,
        vramUsedPercent: null,
        temperature: null,
        power: null,
      },
    ];

    const output = aggregateModelGPUEntries(input);
    expect(output).toHaveLength(2);

    const qwen = output.find((entry) => entry.modelName === 'qwen');
    expect(qwen?.replicas).toBe(2);
    expect(qwen?.gpuUtilization).toBe(50);
    expect(qwen?.vramUsedPercent).toBe(60);
    expect(qwen?.temperature).toBe(78);
    expect(qwen?.power).toBe(190);
  });

  it('detects whether any telemetry values are present', () => {
    expect(
      hasAnyGPUData([
        {
          modelId: 'a1',
          modelName: 'qwen',
          node: 'node-a',
          gpuUtilization: null,
          vramUsedPercent: null,
          temperature: null,
          power: null,
        },
      ])
    ).toBe(false);

    expect(
      hasAnyGPUData([
        {
          modelId: 'a1',
          modelName: 'qwen',
          node: 'node-a',
          gpuUtilization: 10,
          vramUsedPercent: null,
          temperature: null,
          power: null,
        },
      ])
    ).toBe(true);
  });
});
