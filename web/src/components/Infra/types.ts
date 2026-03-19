// TypeScript mirror of internal/infra/snapshot.go

export interface NodeCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  message?: string;
}

export interface NodeInfo {
  name: string;
  status: 'Ready' | 'NotReady';
  roles: string[];
  labels?: Record<string, string>;
  conditions?: NodeCondition[];
  memCapacityMi: number;
  cpuPct: number;
  memPct: number;
  gpuVramPct: number;
  gpuVramUsedMi: number;
  gpuVramTotalMi: number;
  podCount: number;
}

export interface OOMKilledPod {
  name: string;
  namespace: string;
  container: string;
  restartCount: number;
  lastOOM?: string;
  nodeName: string;
}

export interface ComputeSnapshot {
  nodes: NodeInfo[];
  clusterCpuPct: number;
  clusterMemPct: number;
  gpuVramPct: number;
  totalNodes: number;
  readyNodes: number;
  totalPods: number;
  runningPods: number;
  oomKilledPods?: OOMKilledPod[];
  oomKilledCount: number;
}

export interface PVCInfo {
  name: string;
  namespace: string;
  storageClass?: string;
  capacity?: string;
  capacityGi: number;
  phase: string;
  volumeName?: string;
  longhornActualBytes: number;
  longhornRobustness?: string;
}

export interface StorageSnapshot {
  pvcs: PVCInfo[];
  totalCapacityGi: number;
  usedCapacityGi: number;
  degradedVolumes: number;
  totalVolumes: number;
}

export interface IngressInfo {
  name: string;
  namespace: string;
  hosts: string[];
  rps: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
}

export interface NetworkingSnapshot {
  ingresses: IngressInfo[];
  policyGaps: string[];
  totalRps: number;
  p99Ms: number;
  errorRate: number;
}

export interface FluxSourceRef {
  kind: string;
  name: string;
  namespace?: string;
}

export interface FluxResourceInfo {
  name: string;
  namespace: string;
  kind: string;
  ready: boolean;
  suspended: boolean;
  message?: string;
  lastApplied?: string;
  reconcileLagSecs: number;
  sourceRef?: FluxSourceRef;
}

export interface FluxSourceInfo {
  name: string;
  namespace: string;
  kind: string;
  ready: boolean;
  url?: string;
}

export interface GitOpsSnapshot {
  kustomizations: FluxResourceInfo[];
  helmReleases: FluxResourceInfo[];
  sources: FluxSourceInfo[];
  driftCount: number;
  suspendedCount: number;
  maxReconcileLagSecs: number;
}

export interface HotNodeInfo {
  name: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
}

export interface PressureItem {
  resource: 'cpu' | 'memory' | 'disk' | 'gpu';
  node: string;
  pct: number;
  trendDirection: 'up' | 'down' | 'stable';
  etaSaturateSecs: number;
}

export interface NsEfficiency {
  namespace: string;
  cpuRequested: number;
  cpuActual: number;
  memRequestedMi: number;
  memActualMi: number;
}

export interface CapacitySnapshot {
  hotNodes: HotNodeInfo[];
  pressureItems: PressureItem[];
  efficiencyByNs: NsEfficiency[];
}

export interface InfraSnapshot {
  compute: ComputeSnapshot;
  storage: StorageSnapshot;
  networking: NetworkingSnapshot;
  gitops: GitOpsSnapshot;
  capacity: CapacitySnapshot;
  lastUpdated: number; // unix millis
}

// Ambient global for agent console access.
declare global {
  interface Window {
    __FLEXDECK_INFRA__?: InfraSnapshot;
  }
}
