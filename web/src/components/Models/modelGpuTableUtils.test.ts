import { describe, expect, it } from 'vitest';

import { aggregateModelGPUEntries, compareGpuRows, hasAnyGPUData, type AggregatedModelGPUEntry, type ModelGPUEntry } from './modelGpuTableUtils';

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

  describe('compareGpuRows', () => {
    function row(overrides: Partial<AggregatedModelGPUEntry>): AggregatedModelGPUEntry {
      return {
        modelId: 'id',
        modelName: 'model',
        node: 'node-a',
        replicas: 1,
        gpuUtilization: null,
        vramUsedPercent: null,
        temperature: null,
        power: null,
        ...overrides,
      };
    }

    it('sorts numeric columns by direction', () => {
      const hot = row({ modelName: 'hot', gpuUtilization: 90 });
      const cool = row({ modelName: 'cool', gpuUtilization: 10 });
      expect(compareGpuRows(hot, cool, 'util', 'desc')).toBeLessThan(0);
      expect(compareGpuRows(hot, cool, 'util', 'asc')).toBeGreaterThan(0);
    });

    it('always sinks null telemetry to the bottom', () => {
      const measured = row({ modelName: 'measured', gpuUtilization: 5 });
      const missing = row({ modelName: 'aaa-missing', gpuUtilization: null });
      expect(compareGpuRows(measured, missing, 'util', 'desc')).toBeLessThan(0);
      expect(compareGpuRows(measured, missing, 'util', 'asc')).toBeLessThan(0);
      expect(compareGpuRows(missing, measured, 'util', 'asc')).toBeGreaterThan(0);
    });

    it('sorts string columns and breaks ties deterministically', () => {
      const a = row({ modelName: 'alpha', node: 'node-b' });
      const b = row({ modelName: 'alpha', node: 'node-a' });
      expect(compareGpuRows(a, b, 'model', 'asc')).toBeGreaterThan(0); // node tiebreak
      expect(compareGpuRows(a, b, 'node', 'desc')).toBeLessThan(0);
    });
  });
});
