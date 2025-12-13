// K8s types (simplified from full K8s API types)
export interface K8sMetadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

export interface K8sCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface K8sNode {
  metadata: K8sMetadata;
  status: {
    conditions: K8sCondition[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
}

export interface K8sPod {
  metadata: K8sMetadata;
  spec: {
    nodeName?: string;
    containers: Array<{
      name: string;
      image: string;
    }>;
  };
  status: {
    phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
    conditions?: K8sCondition[];
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
    }>;
  };
}

export interface K8sService {
  metadata: K8sMetadata;
  spec: {
    type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
    clusterIP?: string;
    ports?: Array<{
      name?: string;
      port: number;
      targetPort: number | string;
      protocol: string;
    }>;
    selector?: Record<string, string>;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
}

export interface K8sDeployment {
  metadata: K8sMetadata;
  spec: {
    replicas: number;
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
  };
  status: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
  };
}

export interface K8sIngress {
  metadata: K8sMetadata;
  spec: {
    ingressClassName?: string;
    tls?: Array<{
      hosts: string[];
      secretName: string;
    }>;
    rules?: Array<{
      host?: string;
      http?: {
        paths: Array<{
          path: string;
          pathType: string;
          backend: {
            service: {
              name: string;
              port: { number?: number; name?: string };
            };
          };
        }>;
      };
    }>;
  };
}

export interface K8sList<T> {
  items: T[];
  metadata?: {
    continue?: string;
    resourceVersion?: string;
  };
}

// Dashboard types
export interface PulseData {
  loading: boolean;
  error: string;
}

export interface PodPulse extends PulseData {
  ready: number;
  total: number;
  namespaces: number;
}

export interface NodePulse extends PulseData {
  ready: number;
  total: number;
}

export interface ResourcePulse extends PulseData {
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
}

// Topology graph types
export interface TopologyNode {
  id: string;
  type: 'node' | 'pod' | 'service';
  label: string;
  status: 'ok' | 'warn' | 'error';
  data: K8sNode | K8sPod | K8sService;
}

export interface TopologyLink {
  source: string;
  target: string;
  type: 'hosts' | 'selects';
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  links: TopologyLink[];
}

// LiteLLM Metrics types
export interface ModelThroughput {
  model: string;
  tok_per_sec_1m: number;
  tok_per_sec_5m: number;
  tok_per_sec_15m: number;
  output_tok_per_sec: number;
  requests_per_min: number;
  avg_latency_ms: number;
  sparkline: number[];
  trend: 'up' | 'down' | 'stable';
  last_updated: string;
}

export interface LiteLLMMetricsResponse {
  models: ModelThroughput[];
}

export interface LiteLLMHealthResponse {
  healthy: boolean;
  disabled?: boolean;
  error?: string;
}
