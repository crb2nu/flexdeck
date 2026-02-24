import type * as d3 from 'd3';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';

export type TopologyResource = K8sNode | K8sPod | K8sService;

export interface TopologyNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'node' | 'pod' | 'service';
  label: string;
  namespace?: string;
  status: 'ok' | 'warn' | 'error';
  data: TopologyResource;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface TopologyLink extends d3.SimulationLinkDatum<TopologyNode> {
  source: string | TopologyNode;
  target: string | TopologyNode;
  type: 'hosts' | 'selects';
}
