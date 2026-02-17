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

export function hasAnyGPUData(entries: Array<ModelGPUEntry | AggregatedModelGPUEntry>): boolean {
  return entries.some(
    (entry) =>
      entry.gpuUtilization != null ||
      entry.vramUsedPercent != null ||
      entry.temperature != null ||
      entry.power != null
  );
}
