import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import * as d3 from 'd3';

const SEED = 1337;

const scenarios = [
  { name: 'small', nodes: 50, pods: 200, services: 20, namespaces: 4, maxTicks: 60 },
  { name: 'medium', nodes: 150, pods: 600, services: 50, namespaces: 8, maxTicks: 90 },
  { name: 'large', nodes: 300, pods: 1200, services: 80, namespaces: 12, maxTicks: 120 },
];

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hashString = (value) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
};

const getLayoutTuning = (nodeCount) => {
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
    collisionStrength: 0.5,
  };
};

const seedNodePositions = (nodes, width, height) => {
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

const buildPodIndexesByNamespace = (pods) => {
  const namespaceIndexes = new Map();
  for (const pod of pods) {
    const namespace = pod.metadata.namespace;
    let namespaceIndex = namespaceIndexes.get(namespace);
    if (!namespaceIndex) {
      namespaceIndex = { pods: [], labelIndex: new Map() };
      namespaceIndexes.set(namespace, namespaceIndex);
    }
    namespaceIndex.pods.push(pod);

    for (const [labelKey, labelValue] of Object.entries(pod.metadata.labels || {})) {
      let byValue = namespaceIndex.labelIndex.get(labelKey);
      if (!byValue) {
        byValue = new Map();
        namespaceIndex.labelIndex.set(labelKey, byValue);
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

const getServiceCandidatePods = (namespaceIndex, selectorEntries) => {
  if (selectorEntries.length === 0) return namespaceIndex.pods;

  let narrowedCandidates = null;
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

const selectorsMatchPod = (selectorEntries, pod) => {
  for (const [labelKey, labelValue] of selectorEntries) {
    if (pod.metadata.labels?.[labelKey] !== labelValue) return false;
  }
  return true;
};

const buildGraph = (data) => {
  const nodeMap = new Map();
  const nodes = [];
  const links = [];

  for (const node of data.nodes) {
    const id = `node-${node.metadata.name}`;
    const d3Node = { id, type: 'node', data: node, status: node.ready ? 'ok' : 'error' };
    nodes.push(d3Node);
    nodeMap.set(id, d3Node);
  }

  const podsByNamespace = buildPodIndexesByNamespace(data.pods);

  for (const pod of data.pods) {
    const id = `pod-${pod.metadata.namespace}-${pod.metadata.name}`;
    const d3Node = { id, type: 'pod', data: pod, status: pod.status.phase };
    nodes.push(d3Node);
    nodeMap.set(id, d3Node);

    if (pod.spec.nodeName) {
      const nodeId = `node-${pod.spec.nodeName}`;
      if (nodeMap.has(nodeId)) {
        links.push({ source: id, target: nodeId });
      }
    }
  }

  for (const svc of data.services) {
    const id = `svc-${svc.metadata.namespace}-${svc.metadata.name}`;
    const d3Node = { id, type: 'service', data: svc, status: 'ok' };
    nodes.push(d3Node);
    nodeMap.set(id, d3Node);

    const selectorEntries = Object.entries(svc.spec.selector || {});
    const namespaceIndex = podsByNamespace.get(svc.metadata.namespace);
    if (!namespaceIndex) continue;
    const candidates = getServiceCandidatePods(namespaceIndex, selectorEntries);
    for (const pod of candidates) {
      if (!selectorsMatchPod(selectorEntries, pod)) continue;
      links.push({
        source: id,
        target: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
      });
    }
  }

  return { nodes, links };
};

const runScenario = (scenario) => {
  const rand = mulberry32(SEED + hashString(scenario.name));
  const namespaces = Array.from({ length: scenario.namespaces }, (_, i) => `ns-${i}`);
  const apps = Array.from({ length: 12 }, (_, i) => `app-${i}`);
  const phases = ['Running', 'Running', 'Running', 'Pending', 'Failed'];
  const svcTypes = ['ClusterIP', 'NodePort', 'LoadBalancer'];

  const nodes = Array.from({ length: scenario.nodes }, (_, i) => ({
    metadata: { name: `node-${i}` },
    ready: rand() > 0.08,
  }));

  const pods = Array.from({ length: scenario.pods }, (_, i) => {
    const namespace = namespaces[Math.floor(rand() * namespaces.length)];
    const app = apps[Math.floor(rand() * apps.length)];
    const nodeName = `node-${Math.floor(rand() * scenario.nodes)}`;
    const phase = phases[Math.floor(rand() * phases.length)];
    return {
      metadata: { name: `pod-${i}`, namespace, labels: { app } },
      spec: { nodeName },
      status: { phase },
    };
  });

  const services = Array.from({ length: scenario.services }, (_, i) => {
    const namespace = namespaces[Math.floor(rand() * namespaces.length)];
    const app = apps[Math.floor(rand() * apps.length)];
    const type = svcTypes[Math.floor(rand() * svcTypes.length)];
    return {
      metadata: { name: `svc-${i}`, namespace },
      spec: { selector: { app }, type },
    };
  });

  const data = { nodes, pods, services };

  const buildStart = performance.now();
  const graph = buildGraph(data);
  const buildMs = performance.now() - buildStart;

  const simStart = performance.now();
  const tuning = getLayoutTuning(graph.nodes.length || 1);
  seedNodePositions(graph.nodes, 1600, 900);

  const simulation = d3.forceSimulation(graph.nodes)
    .alpha(tuning.alphaStart)
    .alphaDecay(tuning.alphaDecay)
    .alphaMin(tuning.alphaMin)
    .velocityDecay(tuning.velocityDecay)
    .force('link', d3.forceLink(graph.links).id((d) => d.id).distance(tuning.linkDistance).strength(tuning.linkStrength))
    .force('charge', d3.forceManyBody().strength(tuning.chargeStrength).distanceMax(tuning.distanceMax))
    .force('center', d3.forceCenter(0, 0).strength(tuning.centerStrength))
    .force('collision', tuning.collisionEnabled
      ? d3.forceCollide().radius(() => 8 + tuning.collisionPadding).strength(tuning.collisionStrength)
      : null)
    .stop();

  for (let i = 0; i < tuning.warmupTicks; i++) {
    simulation.tick();
  }

  simulation.alpha(tuning.alphaAfterWarmup);

  let settleTicks = 0;
  while (settleTicks < scenario.maxTicks && simulation.alpha() > 0.015) {
    simulation.tick();
    settleTicks++;
  }
  simulation.stop();

  const simMs = performance.now() - simStart;

  return {
    name: scenario.name,
    nodes: graph.nodes.length,
    links: graph.links.length,
    ticks: settleTicks + tuning.warmupTicks,
    warmupTicks: tuning.warmupTicks,
    settleTicks,
    buildMs,
    simMs,
  };
};

const results = scenarios.map(runScenario);

const outputDir = new URL('../../perf/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  scenarios: results,
};

const performanceReport = {
  version: '1.0',
  metrics: results.flatMap((result) => ([
    { name: `topology_build_${result.name}`, value: result.buildMs, unit: 'ms' },
    { name: `topology_layout_${result.name}`, value: result.simMs, unit: 'ms' },
    { name: `topology_nodes_${result.name}`, value: result.nodes, unit: 'count' },
    { name: `topology_links_${result.name}`, value: result.links, unit: 'count' },
  ])),
};

await writeFile(new URL('topology-bench.json', outputDir), JSON.stringify(summary, null, 2));
await writeFile(new URL('performance.json', outputDir), JSON.stringify(performanceReport, null, 2));

const formatMs = (value) => `${value.toFixed(1)}ms`;
for (const result of results) {
  console.log(
    `${result.name}: build ${formatMs(result.buildMs)} | layout ${formatMs(result.simMs)} | nodes ${result.nodes} | links ${result.links}`
  );
}
