export interface ModelGPUEntry {
  modelId: string;
  modelName: string;
  node: string;
  gpuUtilization: number | null;
  vramUsedPercent: number | null;
  temperature: number | null;
  power: number | null;
}

export interface AggregatedModelGPUEntry extends ModelGPUEntry {
  replicas: number;
}

function averageNonNull(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value != null);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

export function aggregateModelGPUEntries(entries: ModelGPUEntry[]): AggregatedModelGPUEntry[] {
  const grouped = new Map<string, ModelGPUEntry[]>();
  for (const entry of entries) {
    const key = `${entry.modelName}@@${entry.node}`;
    const list = grouped.get(key) || [];
    list.push(entry);
    grouped.set(key, list);
  }

  const aggregated: AggregatedModelGPUEntry[] = [];
  for (const [key, list] of grouped) {
    const [modelName, node] = key.split('@@');
    aggregated.push({
      modelId: list[0].modelId,
      modelName,
      node,
      replicas: list.length,
      gpuUtilization: averageNonNull(list.map((item) => item.gpuUtilization)),
      vramUsedPercent: averageNonNull(list.map((item) => item.vramUsedPercent)),
      temperature: averageNonNull(list.map((item) => item.temperature)),
      power: averageNonNull(list.map((item) => item.power)),
    });
  }

  return aggregated.sort((a, b) => {
    if (a.modelName === b.modelName) {
      return a.node.localeCompare(b.node);
    }
    return a.modelName.localeCompare(b.modelName);
  });
}

export type GpuSortKey = 'model' | 'node' | 'replicas' | 'util' | 'vram' | 'temp' | 'power';
export type GpuSortDir = 'asc' | 'desc';

// Missing telemetry (null) always sorts to the bottom regardless of direction,
// so "sort by utilization" reads as a triage list, not a nulls sandwich.
function compareNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

export function compareGpuRows(
  a: AggregatedModelGPUEntry,
  b: AggregatedModelGPUEntry,
  key: GpuSortKey,
  dir: GpuSortDir,
): number {
  const sign = dir === 'asc' ? 1 : -1;
  let delta: number;
  switch (key) {
    case 'model':
      delta = a.modelName.localeCompare(b.modelName) * sign;
      break;
    case 'node':
      delta = a.node.localeCompare(b.node) * sign;
      break;
    case 'replicas':
      delta = (a.replicas - b.replicas) * sign;
      break;
    case 'util':
      delta = compareNullable(a.gpuUtilization, b.gpuUtilization, sign);
      break;
    case 'vram':
      delta = compareNullable(a.vramUsedPercent, b.vramUsedPercent, sign);
      break;
    case 'temp':
      delta = compareNullable(a.temperature, b.temperature, sign);
      break;
    default:
      delta = compareNullable(a.power, b.power, sign);
  }
  if (delta !== 0) return delta;
  // Stable, deterministic tiebreak so equal rows never jitter between polls.
  return a.modelName.localeCompare(b.modelName) || a.node.localeCompare(b.node);
}

export function hasAnyGPUData(entries: Array<ModelGPUEntry | AggregatedModelGPUEntry>): boolean {
  return entries.some(
    (entry) =>
      entry.gpuUtilization != null ||
      entry.vramUsedPercent != null ||
      entry.temperature != null ||
      entry.power != null
  );
}
