import {
  buildTopologyGraphData,
  primeTopologyGraphLayout,
  type BuildInput,
  type BuildResult,
} from './layoutEngine';
import type { TopologyNode, TopologyLink } from './types';

interface WorkerBuildRequest {
  type: 'build';
  requestId: number;
  input: BuildInput;
  width: number;
  height: number;
}

interface WorkerBuildResponse {
  type: 'result';
  requestId: number;
  graphData: BuildResult;
}

interface WorkerErrorResponse {
  type: 'error';
  requestId: number;
  error: string;
}

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

self.onmessage = (event: MessageEvent<WorkerBuildRequest>) => {
  const message = event.data;
  if (message.type !== 'build') return;

  try {
    const graphData = buildTopologyGraphData(message.input);
    primeTopologyGraphLayout(
      graphData.nodes,
      graphData.links,
      message.width,
      message.height,
      getNodeRadius,
    );

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
    self.postMessage(response);
  } catch (error) {
    const response: WorkerErrorResponse = {
      type: 'error',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
