import { createSignal, createEffect, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { authenticatedFetch } from './auth';

// Types matching the Go backend
export interface K8sNode {
  metadata: {
    name: string;
    uid: string;
    labels?: Record<string, string>;
  };
  status: {
    conditions?: Array<{
      type: string;
      status: string;
    }>;
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
}

export interface K8sPod {
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    labels?: Record<string, string>;
  };
  spec: {
    nodeName?: string;
    containers?: Array<{
      name: string;
      image: string;
    }>;
  };
  status: {
    phase: string;
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
    }>;
  };
}

export interface K8sService {
  metadata: {
    name: string;
    namespace: string;
    uid: string;
  };
  spec: {
    type: string;
    clusterIP?: string;
    ports?: Array<{
      port: number;
      targetPort: number | string;
      protocol: string;
    }>;
    selector?: Record<string, string>;
  };
}

interface K8sStore {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

interface WatchEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED';
  objectType: 'node' | 'pod' | 'service';
  object: K8sNode | K8sPod | K8sService;
}

// Create the reactive store
const [store, setStore] = createStore<K8sStore>({
  nodes: [],
  pods: [],
  services: [],
  connected: false,
  lastUpdate: 0,
  error: null,
});

// Connection state
const [connectionStatus, setConnectionStatus] = createSignal<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
let eventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Apply a watch event to the store
function applyWatchEvent(event: WatchEvent) {
  const { type, objectType, object } = event;

  setStore('lastUpdate', Date.now());

  if (objectType === 'node') {
    const node = object as K8sNode;
    setStore('nodes', (nodes) => {
      const index = nodes.findIndex(n => n.metadata.uid === node.metadata.uid);
      if (type === 'DELETED') {
        return nodes.filter(n => n.metadata.uid !== node.metadata.uid);
      } else if (index >= 0) {
        const updated = [...nodes];
        updated[index] = node;
        return updated;
      } else {
        return [...nodes, node];
      }
    });
  } else if (objectType === 'pod') {
    const pod = object as K8sPod;
    setStore('pods', (pods) => {
      const index = pods.findIndex(p => p.metadata.uid === pod.metadata.uid);
      if (type === 'DELETED') {
        return pods.filter(p => p.metadata.uid !== pod.metadata.uid);
      } else if (index >= 0) {
        const updated = [...pods];
        updated[index] = pod;
        return updated;
      } else {
        return [...pods, pod];
      }
    });
  } else if (objectType === 'service') {
    const service = object as K8sService;
    setStore('services', (services) => {
      const index = services.findIndex(s => s.metadata.uid === service.metadata.uid);
      if (type === 'DELETED') {
        return services.filter(s => s.metadata.uid !== service.metadata.uid);
      } else if (index >= 0) {
        const updated = [...services];
        updated[index] = service;
        return updated;
      } else {
        return [...services, service];
      }
    });
  }
}

// Fetch initial data via REST
async function fetchInitialData() {
  try {
    const [nodesRes, podsRes, servicesRes] = await Promise.all([
      authenticatedFetch('/api/k8s/nodes'),
      authenticatedFetch('/api/k8s/pods'),
      authenticatedFetch('/api/k8s/services'),
    ]);

    if (nodesRes.ok) {
      const data = await nodesRes.json();
      setStore('nodes', reconcile(data.items || []));
    }

    if (podsRes.ok) {
      const data = await podsRes.json();
      setStore('pods', reconcile(data.items || []));
    }

    if (servicesRes.ok) {
      const data = await servicesRes.json();
      setStore('services', reconcile(data.items || []));
    }

    setStore('lastUpdate', Date.now());
    setStore('error', null);
  } catch (err) {
    console.error('Failed to fetch K8s data:', err);
    setStore('error', err instanceof Error ? err.message : 'Failed to fetch data');
  }
}

// Connect to SSE endpoint
function connectSSE(namespace?: string) {
  if (eventSource) {
    eventSource.close();
  }

  setConnectionStatus('connecting');

  const params = new URLSearchParams();
  if (namespace) {
    params.set('ns', namespace);
  }

  const url = `/api/k8s/watch-sse${params.toString() ? '?' + params.toString() : ''}`;
  eventSource = new EventSource(url);

  eventSource.addEventListener('ready', () => {
    setConnectionStatus('connected');
    setStore('connected', true);
    setStore('error', null);
    console.log('K8s SSE connected');
  });

  eventSource.addEventListener('node', (e: MessageEvent) => {
    try {
      const event: WatchEvent = JSON.parse(e.data);
      applyWatchEvent(event);
    } catch (err) {
      console.error('Failed to parse node event:', err);
    }
  });

  eventSource.addEventListener('pod', (e: MessageEvent) => {
    try {
      const event: WatchEvent = JSON.parse(e.data);
      applyWatchEvent(event);
    } catch (err) {
      console.error('Failed to parse pod event:', err);
    }
  });

  eventSource.addEventListener('service', (e: MessageEvent) => {
    try {
      const event: WatchEvent = JSON.parse(e.data);
      applyWatchEvent(event);
    } catch (err) {
      console.error('Failed to parse service event:', err);
    }
  });

  eventSource.addEventListener('error', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      setStore('error', data.error || 'SSE error');
    } catch {
      // Ignore parse errors
    }
  });

  eventSource.onerror = () => {
    setConnectionStatus('error');
    setStore('connected', false);
    eventSource?.close();
    eventSource = null;

    // Attempt reconnect after 5 seconds
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      console.log('Attempting SSE reconnect...');
      connectSSE(namespace);
    }, 5000);

    // Fall back to polling while disconnected
    startPolling();
  };
}

// Fallback polling
function startPolling() {
  if (pollInterval) return;

  pollInterval = setInterval(async () => {
    // Only poll if not connected via SSE
    if (connectionStatus() !== 'connected') {
      await fetchInitialData();
    }
  }, 15000); // Poll every 15 seconds
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Public API
export function connectK8sStream(namespace?: string) {
  // Fetch initial data first
  fetchInitialData();

  // Then connect to SSE for updates
  connectSSE(namespace);
}

export function disconnectK8sStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  stopPolling();
  setConnectionStatus('disconnected');
  setStore('connected', false);
}

// Export store and status
export { store as k8sStore, connectionStatus };

// Selectors
export const getNodeByName = (name: string) => store.nodes.find(n => n.metadata.name === name);
export const getPodsByNode = (nodeName: string) => store.pods.filter(p => p.spec.nodeName === nodeName);
export const getPodsByNamespace = (namespace: string) => store.pods.filter(p => p.metadata.namespace === namespace);
export const getServicesByNamespace = (namespace: string) => store.services.filter(s => s.metadata.namespace === namespace);

// Node status helpers
export const isNodeReady = (node: K8sNode): boolean => {
  return node.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True') ?? false;
};

export const getPodsOnNode = (nodeName: string): K8sPod[] => {
  return store.pods.filter(p => p.spec.nodeName === nodeName);
};
