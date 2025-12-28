import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import * as d3 from 'd3';

const SEED = 1337;

const scenarios = [
  { name: 'small', nodes: 50, pods: 200, services: 20, namespaces: 4, ticks: 60 },
  { name: 'medium', nodes: 150, pods: 600, services: 50, namespaces: 8, ticks: 90 },
  { name: 'large', nodes: 300, pods: 1200, services: 80, namespaces: 12, ticks: 120 },
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

  const podsByNamespace = new Map();
  for (const pod of data.pods) {
    const ns = pod.metadata.namespace;
    if (!podsByNamespace.has(ns)) podsByNamespace.set(ns, []);
    podsByNamespace.get(ns).push(pod);
  }

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

    const namespacePods = podsByNamespace.get(svc.metadata.namespace) || [];
    const selectorEntries = Object.entries(svc.spec.selector || {});
    for (const pod of namespacePods) {
      let matches = true;
      for (const [k, v] of selectorEntries) {
        if (pod.metadata.labels?.[k] !== v) {
          matches = false;
          break;
        }
      }
      if (matches) {
        links.push({
          source: id,
          target: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
        });
      }
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
  const nodeCount = graph.nodes.length || 1;
  const linkDistance = Math.max(80, Math.min(140, 2500 / Math.sqrt(nodeCount)));
  const chargeStrength = Math.max(-400, Math.min(-120, -2500 / Math.sqrt(nodeCount)));

  const simulation = d3.forceSimulation(graph.nodes)
    .alpha(0.3)
    .alphaDecay(0.03)
    .alphaMin(0.001)
    .velocityDecay(0.5)
    .force('link', d3.forceLink(graph.links).id((d) => d.id).distance(linkDistance).strength(0.3))
    .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(250))
    .force('center', d3.forceCenter(0, 0).strength(0.1))
    .stop();

  for (let i = 0; i < scenario.ticks; i++) {
    simulation.tick();
  }
  simulation.stop();

  const simMs = performance.now() - simStart;

  return {
    name: scenario.name,
    nodes: graph.nodes.length,
    links: graph.links.length,
    ticks: scenario.ticks,
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
