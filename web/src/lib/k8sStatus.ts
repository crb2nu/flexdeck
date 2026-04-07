interface NodeConditionLike {
  type?: string;
  status?: string;
}

interface NodeStatusLike {
  status?: {
    conditions?: NodeConditionLike[];
  };
}

const isReadyCondition = (condition: NodeConditionLike): boolean =>
  condition.type === 'Ready' && condition.status === 'True';

export function getNodeConditions(node: NodeStatusLike | null | undefined): NodeConditionLike[] {
  return Array.isArray(node?.status?.conditions) ? node.status.conditions : [];
}

export function isK8sNodeReady(node: NodeStatusLike | null | undefined): boolean {
  return getNodeConditions(node).some(isReadyCondition);
}
