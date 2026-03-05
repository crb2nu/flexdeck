import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { authenticatedFetch } from "./auth";
import { pollingScheduler } from "../lib/polling";

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
  topologyVersion: number;
  styleVersion: number;
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

interface WatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  objectType: "node" | "pod" | "service";
  object: K8sNode | K8sPod | K8sService;
}

// Create the reactive store
const [store, setStore] = createStore<K8sStore>({
  nodes: [],
  pods: [],
  services: [],
  topologyVersion: 0,
  styleVersion: 0,
  connected: false,
  lastUpdate: 0,
  error: null,
});

// Connection state
const [connectionStatus, setConnectionStatus] = createSignal<
  "disconnected" | "connecting" | "connected" | "error"
>("disconnected");
let eventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

const hashString = (value: string): number => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
};

const selectorKey = (selector?: Record<string, string>): string => {
  if (!selector) return "";
  return Object.entries(selector)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
};

const selectorEquals = (
  left?: Record<string, string>,
  right?: Record<string, string>
): boolean => selectorKey(left) === selectorKey(right);

const nodeReadyStatus = (node: K8sNode): boolean =>
  node.status.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false;

const computeTopologyHash = (
  nodes: K8sNode[],
  pods: K8sPod[],
  services: K8sService[]
): number => {
  let hash = 0;
  hash = (hash + nodes.length * 3 + pods.length * 5 + services.length * 7) >>> 0;

  for (const node of nodes) {
    hash = (hash + hashString(`n:${node.metadata.name}`)) >>> 0;
  }

  for (const pod of pods) {
    const namespace = pod.metadata.namespace ?? "undefined";
    const nodeName = pod.spec.nodeName ?? "";
    hash = (hash + hashString(`p:${namespace}/${pod.metadata.name}@${nodeName}`)) >>> 0;
  }

  for (const service of services) {
    const namespace = service.metadata.namespace ?? "undefined";
    hash = (
      hash +
      hashString(
        `s:${namespace}/${service.metadata.name}|${service.spec.type ?? ""}|${selectorKey(service.spec.selector)}`
      )
    ) >>> 0;
  }

  return hash >>> 0;
};

const computeStyleHash = (nodes: K8sNode[], pods: K8sPod[]): number => {
  let hash = 0;
  for (const node of nodes) {
    hash = (hash + hashString(`n:${node.metadata.name}:${nodeReadyStatus(node) ? "1" : "0"}`)) >>> 0;
  }
  for (const pod of pods) {
    const namespace = pod.metadata.namespace ?? "undefined";
    hash = (hash + hashString(`p:${namespace}/${pod.metadata.name}:${pod.status?.phase ?? ""}`)) >>> 0;
  }
  return hash >>> 0;
};

const bumpTopologyVersion = () => {
  setStore("topologyVersion", (value) => value + 1);
};

const bumpStyleVersion = () => {
  setStore("styleVersion", (value) => value + 1);
};

// Apply a watch event to the store
function applyWatchEvent(event: WatchEvent) {
  const { type, objectType, object } = event;

  setStore("lastUpdate", Date.now());
  let topologyChanged = false;
  let styleChanged = false;

  if (objectType === "node") {
    const node = object as K8sNode;
    setStore("nodes", (nodes) => {
      const index = nodes.findIndex(
        (n) => n.metadata.uid === node.metadata.uid
      );
      if (type === "DELETED") {
        if (index >= 0) {
          topologyChanged = true;
          styleChanged = true;
        }
        return nodes.filter((n) => n.metadata.uid !== node.metadata.uid);
      } else if (index >= 0) {
        const previous = nodes[index];
        if (previous.metadata.name !== node.metadata.name) {
          topologyChanged = true;
        }
        if (nodeReadyStatus(previous) !== nodeReadyStatus(node)) {
          styleChanged = true;
        }
        const updated = [...nodes];
        updated[index] = node;
        return updated;
      } else {
        topologyChanged = true;
        styleChanged = true;
        return [...nodes, node];
      }
    });
  } else if (objectType === "pod") {
    const pod = object as K8sPod;
    setStore("pods", (pods) => {
      const index = pods.findIndex((p) => p.metadata.uid === pod.metadata.uid);
      if (type === "DELETED") {
        if (index >= 0) {
          topologyChanged = true;
          styleChanged = true;
        }
        return pods.filter((p) => p.metadata.uid !== pod.metadata.uid);
      } else if (index >= 0) {
        const previous = pods[index];
        if (
          previous.metadata.name !== pod.metadata.name ||
          previous.metadata.namespace !== pod.metadata.namespace ||
          previous.spec.nodeName !== pod.spec.nodeName
        ) {
          topologyChanged = true;
        }
        if (previous.status?.phase !== pod.status?.phase) {
          styleChanged = true;
        }
        const updated = [...pods];
        updated[index] = pod;
        return updated;
      } else {
        topologyChanged = true;
        styleChanged = true;
        return [...pods, pod];
      }
    });
  } else if (objectType === "service") {
    const service = object as K8sService;
    setStore("services", (services) => {
      const index = services.findIndex(
        (s) => s.metadata.uid === service.metadata.uid
      );
      if (type === "DELETED") {
        if (index >= 0) {
          topologyChanged = true;
        }
        return services.filter((s) => s.metadata.uid !== service.metadata.uid);
      } else if (index >= 0) {
        const previous = services[index];
        if (
          previous.metadata.name !== service.metadata.name ||
          previous.metadata.namespace !== service.metadata.namespace ||
          previous.spec.type !== service.spec.type ||
          !selectorEquals(previous.spec.selector, service.spec.selector)
        ) {
          topologyChanged = true;
        }
        const updated = [...services];
        updated[index] = service;
        return updated;
      } else {
        topologyChanged = true;
        return [...services, service];
      }
    });
  }

  if (topologyChanged) bumpTopologyVersion();
  if (styleChanged) bumpStyleVersion();
}

// Fetch initial data via REST
async function fetchInitialData() {
  const publicDomains = ['www.flexinfer.ai', 'codyblevins.com', 'www.codyblevins.com'];
  const isPublicView =
    typeof window !== "undefined" &&
    publicDomains.includes(window.location.hostname);

  if (isPublicView) {
    try {
      const resp = await fetch("/flexdeck/api/public/topology");
      if (resp.ok) {
        const data = await resp.json();

        // Transform the sanitized public topology into the format expected by the UI
        const nodes = (data.nodes || []).map((n: any) => ({
          metadata: { name: n.name, uid: n.id, labels: {} },
          status: {
            conditions: [
              {
                type: "Ready",
                status: n.status === "Ready" ? "True" : "False",
              },
            ],
            capacity: n.capacity || {},
          },
        }));

        const pods = (data.pods || []).map((p: any) => {
          const node = data.nodes.find((n: any) => n.id === p.nodeId);
          return {
            metadata: {
              name: p.name,
              namespace: p.namespace,
              uid: p.id,
              labels: { category: p.category },
            },
            spec: { nodeName: node ? node.name : "unknown" },
            status: { phase: p.status },
          };
        });

        const services = (data.services || []).map((s: any) => ({
          metadata: { name: s.name, namespace: "default", uid: s.id },
          spec: { type: s.type },
        }));

        const topologyChanged =
          computeTopologyHash(nodes, pods, services) !==
          computeTopologyHash(store.nodes, store.pods, store.services);
        const styleChanged =
          computeStyleHash(nodes, pods) !== computeStyleHash(store.nodes, store.pods);

        setStore("nodes", reconcile(nodes));
        setStore("pods", reconcile(pods));
        setStore("services", reconcile(services));
        if (topologyChanged) bumpTopologyVersion();
        if (styleChanged) bumpStyleVersion();
        setStore("lastUpdate", Date.now());
        setStore("error", null);
      } else {
        throw new Error(`Public API error: ${resp.status}`);
      }
    } catch (err) {
      console.error("Failed to fetch public topology:", err);
      setStore("error", "Unable to load public cluster view");
    }
    return;
  }

  try {
    const [nodesRes, podsRes, servicesRes] = await Promise.all([
      authenticatedFetch("/api/k8s/nodes"),
      authenticatedFetch("/api/k8s/pods"),
      authenticatedFetch("/api/k8s/services"),
    ]);

    let nextNodes = store.nodes;
    let nextPods = store.pods;
    let nextServices = store.services;

    if (nodesRes.ok) {
      const data = await nodesRes.json();
      nextNodes = Array.isArray(data?.items) ? data.items : [];
    }

    if (podsRes.ok) {
      const data = await podsRes.json();
      nextPods = Array.isArray(data?.items) ? data.items : [];
    }

    if (servicesRes.ok) {
      const data = await servicesRes.json();
      nextServices = Array.isArray(data?.items) ? data.items : [];
    }

    const topologyChanged =
      computeTopologyHash(nextNodes, nextPods, nextServices) !==
      computeTopologyHash(store.nodes, store.pods, store.services);
    const styleChanged =
      computeStyleHash(nextNodes, nextPods) !== computeStyleHash(store.nodes, store.pods);

    setStore("nodes", reconcile(nextNodes));
    setStore("pods", reconcile(nextPods));
    setStore("services", reconcile(nextServices));
    if (topologyChanged) bumpTopologyVersion();
    if (styleChanged) bumpStyleVersion();
    setStore("lastUpdate", Date.now());
    setStore("error", null);
  } catch (err) {
    console.error("Failed to fetch K8s data:", err);
    setStore(
      "error",
      err instanceof Error ? err.message : "Failed to fetch data"
    );
  }
}

// Connect to SSE endpoint
function connectSSE(namespace?: string) {
  const publicDomains = ['www.flexinfer.ai', 'codyblevins.com', 'www.codyblevins.com'];
  const isPublicView =
    typeof window !== "undefined" &&
    publicDomains.includes(window.location.hostname);
  if (isPublicView) {
    // No SSE for public view, just fall back to polling
    setConnectionStatus("connected"); // Lie and say we are connected so UI doesn't show "disconnected"
    startPolling();
    return;
  }

  if (eventSource) {
    eventSource.close();
  }

  setConnectionStatus("connecting");

  const params = new URLSearchParams();
  if (namespace) {
    params.set("ns", namespace);
  }

  const url = `/api/k8s/watch-sse${
    params.toString() ? "?" + params.toString() : ""
  }`;
  eventSource = new EventSource(url);

  eventSource.addEventListener("ready", () => {
    setConnectionStatus("connected");
    setStore("connected", true);
    setStore("error", null);
    console.log("K8s SSE connected");
  });

  eventSource.addEventListener("node", (e: MessageEvent) => {
    try {
      const event: WatchEvent = JSON.parse(e.data);
      applyWatchEvent(event);
    } catch (err) {
      console.error("Failed to parse node event:", err);
    }
  });

  eventSource.addEventListener("pod", (e: MessageEvent) => {
    try {
      const event: WatchEvent = JSON.parse(e.data);
      applyWatchEvent(event);
    } catch (err) {
      console.error("Failed to parse pod event:", err);
    }
  });

  eventSource.addEventListener("service", (e: MessageEvent) => {
    try {
      const event: WatchEvent = JSON.parse(e.data);
      applyWatchEvent(event);
    } catch (err) {
      console.error("Failed to parse service event:", err);
    }
  });

  eventSource.addEventListener("error", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      setStore("error", data.error || "SSE error");
    } catch {
      // Ignore parse errors
    }
  });

  eventSource.onerror = () => {
    setConnectionStatus("error");
    setStore("connected", false);
    eventSource?.close();
    eventSource = null;

    // Attempt reconnect after 5 seconds
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      console.log("Attempting SSE reconnect...");
      connectSSE(namespace);
    }, 5000);

    // Fall back to polling while disconnected
    startPolling();
  };
}

// Fallback polling
function startPolling() {
  pollingScheduler.register("k8s-fallback", async () => {
    // Only poll if not connected via SSE
    if (connectionStatus() !== "connected") {
      await fetchInitialData();
    }
  }, 15000, false); // Don't run immediately as fetchInitialData is usually called first
}

function stopPolling() {
  pollingScheduler.unregister("k8s-fallback");
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
  setConnectionStatus("disconnected");
  setStore("connected", false);
}

// Export store and status
export { store as k8sStore, connectionStatus };

// Selectors
export const getNodeByName = (name: string) =>
  store.nodes.find((n) => n.metadata.name === name);
export const getPodsByNode = (nodeName: string) =>
  store.pods.filter((p) => p.spec.nodeName === nodeName);
export const getPodsByNamespace = (namespace: string) =>
  store.pods.filter((p) => p.metadata.namespace === namespace);
export const getServicesByNamespace = (namespace: string) =>
  store.services.filter((s) => s.metadata.namespace === namespace);

// Node status helpers
export const isNodeReady = (node: K8sNode): boolean => {
  return (
    node.status.conditions?.some(
      (c) => c.type === "Ready" && c.status === "True"
    ) ?? false
  );
};

export const getPodsOnNode = (nodeName: string): K8sPod[] => {
  return store.pods.filter((p) => p.spec.nodeName === nodeName);
};
