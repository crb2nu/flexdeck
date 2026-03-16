/// <reference lib="webworker" />

import * as d3 from 'd3';
import {
  buildTopologyGraphData,
  createPreparedTopologySimulation,
  primeTopologyGraphLayout,
  type BuildInput,
  type BuildResult,
} from './layoutEngine';
import type { TopologyNode, TopologyLink } from './types';

const workerScope = self as DedicatedWorkerGlobalScope;

interface WorkerBuildRequest {
  type: 'build';
  requestId: number;
  input: BuildInput;
  width: number;
  height: number;
}

interface WorkerResizeRequest {
  type: 'resize';
  requestId: number;
  width: number;
  height: number;
}

interface WorkerDragRequest {
  type: 'drag';
  requestId: number;
  phase: 'start' | 'move' | 'end';
  nodeId: string;
  x?: number;
  y?: number;
}

interface WorkerBuildResponse {
  type: 'result';
  requestId: number;
  graphData: BuildResult;
}

interface WorkerTickResponse {
  type: 'tick';
  requestId: number;
  alpha: number;
  settled: boolean;
  positions: ArrayBuffer;
}

interface WorkerErrorResponse {
  type: 'error';
  requestId: number;
  error: string;
}

type WorkerRequest = WorkerBuildRequest | WorkerResizeRequest | WorkerDragRequest;

let activeRequestId = 0;
let activeSimulation: d3.Simulation<TopologyNode, TopologyLink> | null = null;
let activeNodes: TopologyNode[] = [];
let activeNodeByID = new Map<string, TopologyNode>();
let stepTimeoutID: ReturnType<typeof setTimeout> | null = null;

const getNodeRadius = (node: TopologyNode): number => {
  switch (node.type) {
    case 'node':
      return 28;
    case 'service':
      return 18;
    case 'pod':
      return 8;
    default:
      return 8;
  }
};

const normalizeLinks = (links: TopologyLink[]): TopologyLink[] =>
  links.map((link) => ({
    ...link,
    source: typeof link.source === 'string' ? link.source : link.source.id,
    target: typeof link.target === 'string' ? link.target : link.target.id,
  }));

const getTickBatchSize = (nodeCount: number, alpha: number): number => {
  if (nodeCount >= 1200) return alpha < 0.05 ? 6 : alpha < 0.12 ? 5 : 4;
  if (nodeCount >= 700) return alpha < 0.05 ? 4 : 3;
  if (nodeCount >= 250) return alpha < 0.05 ? 3 : 2;
  return 1;
};

const getSnapshotIntervalMs = (nodeCount: number, alpha: number): number => {
  if (nodeCount >= 1200) return alpha < 0.05 ? 72 : alpha < 0.12 ? 56 : 40;
  if (nodeCount >= 700) return alpha < 0.05 ? 60 : alpha < 0.12 ? 46 : 34;
  if (nodeCount >= 250) return alpha < 0.05 ? 44 : 30;
  return alpha < 0.05 ? 28 : 22;
};

const clearStepLoop = (): void => {
  if (stepTimeoutID) {
    clearTimeout(stepTimeoutID);
    stepTimeoutID = null;
  }
};

const stopActiveSimulation = (): void => {
  clearStepLoop();
  activeSimulation?.stop();
  activeSimulation = null;
  activeNodes = [];
  activeNodeByID.clear();
};

const postSnapshot = (settled: boolean): void => {
  const positions = new Float32Array(activeNodes.length * 2);
  for (let i = 0; i < activeNodes.length; i++) {
    const node = activeNodes[i];
    positions[i * 2] = node.x ?? 0;
    positions[i * 2 + 1] = node.y ?? 0;
  }

  const response: WorkerTickResponse = {
    type: 'tick',
    requestId: activeRequestId,
    alpha: activeSimulation?.alpha() ?? 0,
    settled,
    positions: positions.buffer,
  };
  workerScope.postMessage(response, [positions.buffer]);
};

const scheduleStepLoop = (): void => {
  if (stepTimeoutID || !activeSimulation) return;
  stepTimeoutID = setTimeout(
    runSimulationStep,
    getSnapshotIntervalMs(activeNodes.length, activeSimulation.alpha()),
  );
};

const restartSimulation = (alpha: number, alphaTarget = 0): void => {
  if (!activeSimulation) return;
  activeSimulation.alpha(Math.max(activeSimulation.alpha(), alpha));
  activeSimulation.alphaTarget(alphaTarget);
  scheduleStepLoop();
};

function runSimulationStep(): void {
  stepTimeoutID = null;
  if (!activeSimulation) return;

  const tickBatchSize = getTickBatchSize(activeNodes.length, activeSimulation.alpha());
  for (let i = 0; i < tickBatchSize; i++) {
    activeSimulation.tick();
  }

  const settled = activeSimulation.alpha() <= activeSimulation.alphaMin();
  postSnapshot(settled);

  if (settled) {
    activeSimulation.stop();
    activeSimulation = null;
    return;
  }

  scheduleStepLoop();
}

const handleBuild = (message: WorkerBuildRequest): void => {
  stopActiveSimulation();
  activeRequestId = message.requestId;

  const graphData = buildTopologyGraphData(message.input);
  primeTopologyGraphLayout(
    graphData.nodes,
    graphData.links,
    message.width,
    message.height,
    getNodeRadius,
  );

  activeNodes = graphData.nodes;
  activeNodeByID = new Map(graphData.nodes.map((node) => [node.id, node]));

  if (graphData.nodes.length > 0) {
    const prepared = createPreparedTopologySimulation({
      nodes: graphData.nodes,
      links: graphData.links,
      width: message.width,
      height: message.height,
      getNodeRadius,
    });
    activeSimulation = prepared.simulation;
    scheduleStepLoop();
  }

  const response: WorkerBuildResponse = {
    type: 'result',
    requestId: message.requestId,
    graphData: {
      ...graphData,
      links: normalizeLinks(graphData.links),
      hostsLinks: normalizeLinks(graphData.hostsLinks),
      selectsLinks: normalizeLinks(graphData.selectsLinks),
    },
  };
  workerScope.postMessage(response);
};

const handleResize = (message: WorkerResizeRequest): void => {
  if (message.requestId !== activeRequestId || !activeSimulation || message.width <= 0 || message.height <= 0) return;
  activeSimulation.force('center', d3.forceCenter(message.width / 2, message.height / 2).strength(0.1));
  restartSimulation(0.15, 0);
  postSnapshot(false);
};

const handleDrag = (message: WorkerDragRequest): void => {
  if (message.requestId !== activeRequestId || !activeSimulation) return;
  const node = activeNodeByID.get(message.nodeId);
  if (!node) return;

  if (message.phase === 'end') {
    node.fx = null;
    node.fy = null;
    restartSimulation(0.14, 0);
    postSnapshot(false);
    return;
  }

  const x = message.x ?? node.x ?? 0;
  const y = message.y ?? node.y ?? 0;
  node.x = x;
  node.y = y;
  node.fx = x;
  node.fy = y;
  restartSimulation(message.phase === 'start' ? 0.28 : 0.2, 0.3);
  postSnapshot(false);
};

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'build':
        handleBuild(message);
        break;
      case 'resize':
        handleResize(message);
        break;
      case 'drag':
        handleDrag(message);
        break;
      default:
        break;
    }
  } catch (error) {
    const response: WorkerErrorResponse = {
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : activeRequestId,
      error: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};
