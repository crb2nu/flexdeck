import type { K8sNode, K8sPod, K8sService } from "./k8s";

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
  type: "node" | "pod" | "service";
  label: string;
  status: "ok" | "warn" | "error";
  data: K8sNode | K8sPod | K8sService;
}

export interface TopologyLink {
  source: string;
  target: string;
  type: "hosts" | "selects";
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  links: TopologyLink[];
}
