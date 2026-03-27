import { describe, expect, it } from "vitest";

import {
  getReliabilityStatus,
  hasObservedInferenceMetrics,
  summarizeIntegrationCoverage,
  summarizeLoRA,
} from "./controllerIntegration";
import type { InferenceMetrics, LoRAAdapter } from "../../lib/types";

const baseMetrics: InferenceMetrics = {
  model: "model-a",
  observed: true,
  tps: 10,
  p95LatencyMs: 100,
  queueDepth: 0,
  activeConnections: 1,
  errorRate: 0,
  queueWaitP95Ms: 100,
  rejectedRequestsPerSec: 0,
  scaleUps5m: 0,
  activationRetries5m: 0,
  coldStartP95Ms: null,
  idleSeconds: null,
};

describe("controllerIntegration", () => {
  it("returns unknown reliability when metrics are unavailable", () => {
    expect(getReliabilityStatus(undefined).level).toBe("unknown");
  });

  it("returns unknown reliability when the payload has no observed series", () => {
    const metrics: InferenceMetrics = {
      ...baseMetrics,
      observed: false,
      tps: null,
      p95LatencyMs: null,
      queueDepth: null,
      activeConnections: null,
      errorRate: null,
      queueWaitP95Ms: null,
      rejectedRequestsPerSec: null,
      scaleUps5m: null,
      activationRetries5m: null,
    };
    expect(hasObservedInferenceMetrics(metrics)).toBe(false);
    expect(getReliabilityStatus(metrics).level).toBe("unknown");
  });

  it("returns partial reliability when payload is partial", () => {
    const metrics: InferenceMetrics = { ...baseMetrics, partial: true };
    expect(getReliabilityStatus(metrics).level).toBe("partial");
  });

  it("returns degraded reliability on elevated error rate or queue wait", () => {
    expect(
      getReliabilityStatus({ ...baseMetrics, errorRate: 0.03 }).level,
    ).toBe("degraded");
    expect(
      getReliabilityStatus({ ...baseMetrics, queueWaitP95Ms: 2200 }).level,
    ).toBe("degraded");
    expect(
      getReliabilityStatus({ ...baseMetrics, rejectedRequestsPerSec: 0.1 })
        .level,
    ).toBe("degraded");
    expect(
      getReliabilityStatus({ ...baseMetrics, activationRetries5m: 2 }).level,
    ).toBe("degraded");
  });

  it("returns healthy reliability for low-error low-queue signals", () => {
    expect(getReliabilityStatus(baseMetrics).level).toBe("healthy");
  });

  it("summarizes LoRA adapter states", () => {
    const adapters: LoRAAdapter[] = [
      {
        name: "a",
        namespace: "ns",
        modelRef: "m",
        state: "Loaded",
        adapterSource: "s",
      },
      {
        name: "b",
        namespace: "ns",
        modelRef: "m",
        state: "Pending",
        adapterSource: "s",
      },
      {
        name: "c",
        namespace: "ns",
        modelRef: "m",
        state: "Loaded",
        adapterSource: "s",
      },
      {
        name: "d",
        namespace: "ns",
        modelRef: "m",
        state: "Unloading",
        adapterSource: "s",
      },
    ];

    expect(summarizeLoRA(adapters)).toEqual({
      total: 4,
      loaded: 2,
      pending: 1,
      unloading: 1,
    });
  });

  it("summarizes integration availability coverage", () => {
    expect(
      summarizeIntegrationCoverage([
        {
          inferenceAvailable: true,
          loraAvailable: true,
          throughputAvailable: false,
        },
        {
          inferenceAvailable: false,
          loraAvailable: true,
          throughputAvailable: false,
        },
        {
          inferenceAvailable: false,
          loraAvailable: false,
          throughputAvailable: false,
        },
      ]),
    ).toEqual({
      inferenceUnavailable: 2,
      loraUnavailable: 1,
    });
  });
});
