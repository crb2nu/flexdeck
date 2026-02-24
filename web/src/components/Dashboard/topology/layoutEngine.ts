import * as d3 from 'd3';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import type { TopologyNode, TopologyLink } from './types';

interface BuildInput {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  prevNodes: TopologyNode[];
}

interface BuildResult {
  nodes: TopologyNode[];
  links: TopologyLink[];
  hostsLinks: TopologyLink[];
  selectsLinks: TopologyLink[];
  namespaceMap: Map<string, number>;
}

interface NamespacePodIndex {
  pods: K8sPod[];
  labelIndex: Map<string, Map<string, K8sPod[]>>;
}

interface CreateSimulationInput {
  nodes: TopologyNode[];
  links: TopologyLink[];
  width: number;
  height: number;
  getNodeRadius: (node: TopologyNode) => number;
  onEnd: () => void;
}

export interface LayoutTuning {
  alphaStart: number;
  alphaAfterWarmup: number;
  alphaDecay: number;
  alphaMin: number;
  velocityDecay: number;
  chargeStrength: number;
  distanceMax: number;
  linkDistance: number;
  linkStrength: number;
  centerStrength: number;
  warmupTicks: number;
  collisionEnabled: boolean;
  collisionPadding: number;
  collisionStrength: number;
}

export const namespaceColors = [
  '#00d9ff', '#a855f7', '#22c55e', '#f97316', '#ec4899',
  '#3b82f6', '#eab308', '#06b6d4', '#8b5cf6', '#10b981'
];

export const getNamespaceColor = (namespace: string, namespaceMap: Map<string, number>): string => {
  if (!namespaceMap.has(namespace)) {
    namespaceMap.set(namespace, namespaceMap.size);
  }
  return namespaceColors[namespaceMap.get(namespace)! % namespaceColors.length];
};

const getNamespacePodIndex = (namespaceIndexes: Map<string, NamespacePodIndex>, namespace: string): NamespacePodIndex => {
  let index = namespaceIndexes.get(namespace);
  if (!index) {
    index = {
      pods: [],
      labelIndex: new Map<string, Map<string, K8sPod[]>>()
    };
    namespaceIndexes.set(namespace, index);
  }
  return index;
};

const buildPodIndexesByNamespace = (pods: K8sPod[]): Map<string, NamespacePodIndex> => {
  const namespaceIndexes = new Map<string, NamespacePodIndex>();
  for (const pod of pods) {
    const namespace = pod.metadata.namespace || 'default';
    const index = getNamespacePodIndex(namespaceIndexes, namespace);
    index.pods.push(pod);

    const labels = pod.metadata.labels || {};
    for (const [labelKey, labelValue] of Object.entries(labels)) {
      let byValue = index.labelIndex.get(labelKey);
      if (!byValue) {
        byValue = new Map<string, K8sPod[]>();
        index.labelIndex.set(labelKey, byValue);
      }

      let labeledPods = byValue.get(labelValue);
      if (!labeledPods) {
        labeledPods = [];
        byValue.set(labelValue, labeledPods);
      }
      labeledPods.push(pod);
    }
  }
  return namespaceIndexes;
};

const getServiceCandidatePods = (namespaceIndex: NamespacePodIndex, selectorEntries: [string, string][]): K8sPod[] => {
  if (selectorEntries.length === 0) {
    return namespaceIndex.pods;
  }

  let narrowedCandidates: K8sPod[] | null = null;
  for (const [labelKey, labelValue] of selectorEntries) {
    const podsForLabelValue = namespaceIndex.labelIndex.get(labelKey)?.get(labelValue);
    if (!podsForLabelValue || podsForLabelValue.length === 0) {
      return [];
    }
    if (!narrowedCandidates || podsForLabelValue.length < narrowedCandidates.length) {
      narrowedCandidates = podsForLabelValue;
    }
  }

  return narrowedCandidates || namespaceIndex.pods;
};

const selectorsMatchPod = (selectorEntries: [string, string][], pod: K8sPod): boolean => {
  for (const [labelKey, labelValue] of selectorEntries) {
    if (pod.metadata.labels?.[labelKey] !== labelValue) {
      return false;
    }
  }
  return true;
};

const preserveNodePhysics = (target: TopologyNode, previousNode: TopologyNode | undefined): void => {
  if (!previousNode) return;
  target.x = previousNode.x;
  target.y = previousNode.y;
  target.vx = previousNode.vx;
  target.vy = previousNode.vy;
  target.fx = previousNode.fx;
  target.fy = previousNode.fy;
};

const isTopologyNodeReady = (node: K8sNode): boolean =>
  node.status.conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True');

export const buildTopologyGraphData = (input: BuildInput): BuildResult => {
  const previousNodeById = new Map(input.prevNodes.map((node) => [node.id, node]));

  const links: TopologyLink[] = [];
  const hostsLinks: TopologyLink[] = [];
  const selectsLinks: TopologyLink[] = [];
  const nodes: TopologyNode[] = [];
  const nodeMap = new Map<string, TopologyNode>();
  const namespaceMap = new Map<string, number>();
  const podsByNamespace = buildPodIndexesByNamespace(input.pods);

  const appendNode = (node: TopologyNode): void => {
    preserveNodePhysics(node, previousNodeById.get(node.id));
    nodes.push(node);
    nodeMap.set(node.id, node);
  };

  for (const k8sNode of input.nodes) {
    appendNode({
      id: `node-${k8sNode.metadata.name}`,
      type: 'node',
      label: k8sNode.metadata.name,
      data: k8sNode,
      status: isTopologyNodeReady(k8sNode) ? 'ok' : 'error'
    });
  }

  for (const pod of input.pods) {
    const namespace = pod.metadata.namespace || 'default';
    const namespaceForId = pod.metadata.namespace ?? 'undefined';
    getNamespaceColor(namespace, namespaceMap);

    appendNode({
      id: `pod-${namespaceForId}-${pod.metadata.name}`,
      type: 'pod',
      label: pod.metadata.name,
      data: pod,
      namespace,
      status: pod.status.phase === 'Running'
        ? 'ok'
        : pod.status.phase === 'Pending'
          ? 'warn'
          : 'error'
    });

    if (pod.spec.nodeName) {
      const hostNodeId = `node-${pod.spec.nodeName}`;
      if (nodeMap.has(hostNodeId)) {
        const link: TopologyLink = {
          source: `pod-${namespaceForId}-${pod.metadata.name}`,
          target: hostNodeId,
          type: 'hosts'
        };
        links.push(link);
        hostsLinks.push(link);
      }
    }
  }

  for (const service of input.services) {
    const namespace = service.metadata.namespace || 'default';
    const namespaceForId = service.metadata.namespace ?? 'undefined';
    getNamespaceColor(namespace, namespaceMap);

    const serviceId = `svc-${namespaceForId}-${service.metadata.name}`;
    appendNode({
      id: serviceId,
      type: 'service',
      label: service.metadata.name,
      data: service,
      namespace,
      status: 'ok'
    });

    if (!service.spec.selector) continue;

    const namespaceIndex = podsByNamespace.get(namespace);
    if (!namespaceIndex) continue;

    const selectorEntries = Object.entries(service.spec.selector);
    const candidates = getServiceCandidatePods(namespaceIndex, selectorEntries);
    for (const pod of candidates) {
      if (!selectorsMatchPod(selectorEntries, pod)) continue;
      const podNamespaceForId = pod.metadata.namespace ?? 'undefined';
      const link: TopologyLink = {
        source: serviceId,
        target: `pod-${podNamespaceForId}-${pod.metadata.name}`,
        type: 'selects'
      };
      links.push(link);
      selectsLinks.push(link);
    }
  }

  return {
    nodes,
    links,
    hostsLinks,
    selectsLinks,
    namespaceMap
  };
};

export const getTopologyLayoutTuning = (nodeCount: number): LayoutTuning => {
  const normalizedNodeCount = Math.max(nodeCount, 1);
  const isVeryLarge = normalizedNodeCount >= 1200;
  const isLarge = !isVeryLarge && normalizedNodeCount >= 700;

  const warmupTicks = isVeryLarge
    ? 48
    : isLarge
      ? 64
      : Math.min(100, Math.max(30, Math.round(Math.sqrt(normalizedNodeCount) * 3)));

  return {
    alphaStart: isVeryLarge ? 0.24 : 0.3,
    alphaAfterWarmup: isVeryLarge ? 0.14 : isLarge ? 0.16 : 0.2,
    alphaDecay: isVeryLarge ? 0.05 : isLarge ? 0.04 : 0.03,
    alphaMin: isVeryLarge ? 0.002 : isLarge ? 0.0015 : 0.001,
    velocityDecay: isVeryLarge ? 0.58 : isLarge ? 0.54 : 0.5,
    chargeStrength: Math.max(-400, Math.min(-120, -2500 / Math.sqrt(normalizedNodeCount))),
    distanceMax: isVeryLarge ? 200 : 250,
    linkDistance: Math.max(80, Math.min(140, 2500 / Math.sqrt(normalizedNodeCount))),
    linkStrength: isVeryLarge ? 0.24 : isLarge ? 0.27 : 0.3,
    centerStrength: isVeryLarge ? 0.08 : 0.1,
    warmupTicks,
    collisionEnabled: normalizedNodeCount < 200,
    collisionPadding: 8,
    collisionStrength: 0.5
  };
};

const seedNodePositions = (nodes: TopologyNode[], width: number, height: number): void => {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.3;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const radiusStep = radius / Math.sqrt(Math.max(nodes.length, 1));

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.x !== undefined && node.y !== undefined) continue;
    const spiralRadius = radiusStep * Math.sqrt(i + 1);
    const angle = i * goldenAngle;
    node.x = centerX + Math.cos(angle) * spiralRadius;
    node.y = centerY + Math.sin(angle) * spiralRadius;
  }
};

export const createTopologySimulation = (input: CreateSimulationInput): {
  simulation: d3.Simulation<TopologyNode, TopologyLink>;
  tuning: LayoutTuning;
} => {
  const tuning = getTopologyLayoutTuning(input.nodes.length);
  seedNodePositions(input.nodes, input.width, input.height);

  const simulation = d3.forceSimulation<TopologyNode>(input.nodes)
    .alpha(tuning.alphaStart)
    .alphaDecay(tuning.alphaDecay)
    .alphaMin(tuning.alphaMin)
    .velocityDecay(tuning.velocityDecay)
    .force('link', d3.forceLink<TopologyNode, TopologyLink>(input.links)
      .id((node) => node.id)
      .distance(tuning.linkDistance)
      .strength(tuning.linkStrength))
    .force('charge', d3.forceManyBody().strength(tuning.chargeStrength).distanceMax(tuning.distanceMax))
    .force('center', d3.forceCenter(input.width / 2, input.height / 2).strength(tuning.centerStrength))
    .force('collision', tuning.collisionEnabled
      ? d3.forceCollide<TopologyNode>().radius((node) => input.getNodeRadius(node) + tuning.collisionPadding).strength(tuning.collisionStrength)
      : null)
    .on('end', input.onEnd);

  simulation.stop();
  for (let i = 0; i < tuning.warmupTicks; i++) {
    simulation.tick();
  }
  simulation.alpha(tuning.alphaAfterWarmup).restart();

  return { simulation, tuning };
};
