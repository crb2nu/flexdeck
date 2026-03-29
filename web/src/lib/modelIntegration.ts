import { modelsApi, litellm } from "./api";
import type { InferenceMetrics, LoRAAdapter } from "./types";
import type { LiteLLMModelThroughput } from "./api/infrastructure";

export interface ModelRef {
  namespace: string;
  name: string;
}

export interface ModelIntegrationResult {
  metrics?: InferenceMetrics;
  adapters: LoRAAdapter[];
  throughput?: LiteLLMModelThroughput;
  inferenceAvailable: boolean;
  loraAvailable: boolean;
  throughputAvailable: boolean;
}

interface BatchOptions {
  force?: boolean;
  concurrency?: number;
}

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;

const cache = new Map<
  string,
  { expiresAt: number; value: ModelIntegrationResult }
>();
const inflight = new Map<string, Promise<ModelIntegrationResult>>();

function keyOf(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

export function modelRefKey(namespace: string, name: string): string {
  return keyOf(namespace, name);
}

async function fetchModelIntegration(
  namespace: string,
  name: string,
): Promise<ModelIntegrationResult> {
  const [inferenceResult, loraResult, throughputResult] =
    await Promise.allSettled([
      modelsApi.crdInference(namespace, name),
      modelsApi.lora(namespace, name),
      litellm.modelMetrics(name).catch(() => null),
    ]);

  return {
    metrics:
      inferenceResult.status === "fulfilled"
        ? inferenceResult.value
        : undefined,
    adapters:
      loraResult.status === "fulfilled" ? loraResult.value.adapters || [] : [],
    throughput:
      throughputResult.status === "fulfilled" && throughputResult.value
        ? throughputResult.value
        : undefined,
    inferenceAvailable: inferenceResult.status === "fulfilled",
    loraAvailable: loraResult.status === "fulfilled",
    throughputAvailable:
      throughputResult.status === "fulfilled" && !!throughputResult.value,
  };
}

async function getModelIntegration(
  namespace: string,
  name: string,
  force = false,
): Promise<ModelIntegrationResult> {
  const key = keyOf(namespace, name);
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const value = await fetchModelIntegration(namespace, name);
    cache.set(key, { value, expiresAt: Date.now() + DEFAULT_TTL_MS });
    return value;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export async function fetchModelIntegrationsBatch(
  models: ModelRef[],
  options: BatchOptions = {},
): Promise<Record<string, ModelIntegrationResult>> {
  const force = options.force ?? false;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const deduped = new Map<string, ModelRef>();
  for (const model of models) {
    deduped.set(keyOf(model.namespace, model.name), model);
  }
  const queue = Array.from(deduped.values());
  const results: Record<string, ModelIntegrationResult> = {};

  if (queue.length === 0) {
    return results;
  }

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= queue.length) break;
      const item = queue[index];
      results[keyOf(item.namespace, item.name)] = await getModelIntegration(
        item.namespace,
        item.name,
        force,
      );
    }
  });

  await Promise.all(workers);
  return results;
}

export function invalidateModelIntegration(
  namespace: string,
  name: string,
): void {
  cache.delete(keyOf(namespace, name));
}

export function clearModelIntegrationsCache(): void {
  cache.clear();
}

export function __clearModelIntegrationsForTests(): void {
  cache.clear();
  inflight.clear();
}
