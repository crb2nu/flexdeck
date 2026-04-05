/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { K8sNode, K8sPod, K8sService, WatchEvent } from './k8s';

vi.mock('./auth', () => ({
  authenticatedFetch: vi.fn(),
}));

vi.mock('../lib/polling', () => ({
  pollingScheduler: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

const { __k8sTestUtils, k8sStore } = await import('./k8s');

const buildNode = (name: string, ready = true): K8sNode => ({
  metadata: {
    name,
    uid: `node-${name}`,
    labels: {},
  },
  status: {
    conditions: [
      {
        type: 'Ready',
        status: ready ? 'True' : 'False',
      },
    ],
  },
});

const buildPod = (
  name: string,
  namespace: string,
  nodeName: string,
  phase: string
): K8sPod => ({
  metadata: {
    name,
    namespace,
    uid: `pod-${namespace}-${name}`,
    labels: {},
  },
  spec: {
    nodeName,
    containers: [],
  },
  status: {
    phase,
    containerStatuses: [],
  },
});

const buildService = (
  name: string,
  namespace: string,
  selector?: Record<string, string>
): K8sService => ({
  metadata: {
    name,
    namespace,
    uid: `svc-${namespace}-${name}`,
  },
  spec: {
    type: 'ClusterIP',
    selector,
  },
});

const queueEvents = (events: WatchEvent[]) => {
  for (const event of events) {
    __k8sTestUtils.enqueueWatchEvent(event);
  }
  __k8sTestUtils.flushPendingWatchEvents();
};

describe('k8s store watch batching', () => {
  afterEach(() => {
    __k8sTestUtils.resetStore();
  });

  it('coalesces topology and style bumps across a multi-event flush', () => {
    __k8sTestUtils.replaceStoreState({
      nodes: [buildNode('node-a', true)],
      pods: [
        buildPod('api-0', 'apps', 'node-a', 'Pending'),
        buildPod('worker-0', 'apps', 'node-a', 'Running'),
      ],
      services: [buildService('api', 'apps', { app: 'api' })],
      topologyVersion: 0,
      styleVersion: 0,
      connected: true,
      lastUpdate: 1,
      error: null,
    });

    queueEvents([
      {
        type: 'MODIFIED',
        objectType: 'pod',
        object: buildPod('api-0', 'apps', 'node-a', 'Running'),
      },
      {
        type: 'ADDED',
        objectType: 'node',
        object: buildNode('node-b', false),
      },
      {
        type: 'MODIFIED',
        objectType: 'service',
        object: buildService('api', 'apps', { app: 'api-v2' }),
      },
    ]);

    expect(k8sStore.nodes).toHaveLength(2);
    expect(k8sStore.services[0].spec.selector).toEqual({ app: 'api-v2' });
    expect(k8sStore.pods[0].status.phase).toBe('Running');
    expect(k8sStore.topologyVersion).toBe(1);
    expect(k8sStore.styleVersion).toBe(1);
    expect(k8sStore.lastUpdate).toBeGreaterThan(1);
  });

  it('keeps later events in the same flush aligned after a delete shifts indexes', () => {
    __k8sTestUtils.replaceStoreState({
      nodes: [buildNode('node-a', true)],
      pods: [
        buildPod('api-0', 'apps', 'node-a', 'Running'),
        buildPod('worker-0', 'apps', 'node-a', 'Pending'),
      ],
      services: [],
      topologyVersion: 0,
      styleVersion: 0,
      connected: true,
      lastUpdate: 1,
      error: null,
    });

    queueEvents([
      {
        type: 'DELETED',
        objectType: 'pod',
        object: buildPod('api-0', 'apps', 'node-a', 'Running'),
      },
      {
        type: 'MODIFIED',
        objectType: 'pod',
        object: buildPod('worker-0', 'apps', 'node-a', 'Running'),
      },
    ]);

    expect(k8sStore.pods).toHaveLength(1);
    expect(k8sStore.pods[0].metadata.name).toBe('worker-0');
    expect(k8sStore.pods[0].status.phase).toBe('Running');
    expect(k8sStore.topologyVersion).toBe(1);
    expect(k8sStore.styleVersion).toBe(1);
  });

  it('does not bump topology or style versions for service type-only updates', () => {
    __k8sTestUtils.replaceStoreState({
      nodes: [buildNode('node-a', true)],
      pods: [buildPod('api-0', 'apps', 'node-a', 'Running')],
      services: [buildService('api', 'apps', { app: 'api' })],
      topologyVersion: 4,
      styleVersion: 7,
      connected: true,
      lastUpdate: 1,
      error: null,
    });

    queueEvents([
      {
        type: 'MODIFIED',
        objectType: 'service',
        object: {
          ...buildService('api', 'apps', { app: 'api' }),
          spec: {
            ...buildService('api', 'apps', { app: 'api' }).spec,
            type: 'LoadBalancer',
          },
        },
      },
    ]);

    expect(k8sStore.services[0].spec.type).toBe('LoadBalancer');
    expect(k8sStore.topologyVersion).toBe(4);
    expect(k8sStore.styleVersion).toBe(7);
  });
});
