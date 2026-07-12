import type { FlexInferModel, GamingSession, K8sNode } from '../../../lib/types';

// A GPU node's operating mode, from the operator's point of view.
//   gaming    — an Active GamingSession owns the node; it streams, not serves.
//   switching — a GamingSession exists but is not yet Active (Pending/Terminating).
//   serving   — at least one inference model is Ready on the node.
//   standby   — models are placed but none are Ready (idle/serverless scaled to 0).
//   idle      — a GPU node with no models and no gaming session.
export type NodeMode = 'gaming' | 'switching' | 'serving' | 'standby' | 'idle';

export interface FleetModelRef {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
}

export interface FleetNode {
  name: string;
  vendor: string; // 'AMD' | 'NVIDIA' | ''
  arch: string; // e.g. gfx1100
  vram: string; // e.g. '23Gi'
  gpuCount: number;
  ready: boolean; // node Ready condition
  gpuUtilPercent: number | null; // 0..100
  freeVramMB: number | null;
  mode: NodeMode;
  session: GamingSession | null;
  models: FleetModelRef[];
  readyModels: number;
}

export interface FleetSummary {
  total: number;
  gaming: number;
  switching: number;
  serving: number;
  standby: number;
  idle: number;
}

const GPU_LABEL_PRESENT = 'flexinfer.ai/gpu-present';
const GPU_LABEL_VENDOR = 'flexinfer.ai/gpu.vendor';
const GPU_LABEL_ARCH = 'flexinfer.ai/gpu.arch';
const GPU_LABEL_VRAM = 'flexinfer.ai/gpu.vram';
const GPU_LABEL_COUNT = 'flexinfer.ai/gpu.count';
const GPU_ANNOT_UTIL = 'flexinfer.ai/gpu.util';
const GPU_ANNOT_FREE_MEM = 'flexinfer.ai/gpu-free-memory';

/** True when the node carries FlexInfer GPU labels. */
export function isGpuNode(node: K8sNode): boolean {
  const labels = node.metadata.labels || {};
  return labels[GPU_LABEL_PRESENT] === 'true' || Boolean(labels[GPU_LABEL_VENDOR]) || Boolean(labels[GPU_LABEL_ARCH]);
}

function nodeReady(node: K8sNode): boolean {
  return (node.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True');
}

/**
 * Parse the `flexinfer.ai/gpu.util` annotation, which may be encoded either as
 * a fraction (0..1) or a percent (0..100). Normalize to a 0..100 percent.
 */
export function parseUtilPercent(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  const pct = v <= 1 ? v * 100 : v;
  return Math.min(100, pct);
}

function parseFreeMem(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** An Active GamingSession is the authoritative "this node is gaming" signal. */
export function isActiveGaming(session: GamingSession): boolean {
  const phase = (session.status?.phase || '').toLowerCase();
  return phase === 'active' || (session.status?.observedMode || '').toLowerCase() === 'gaming';
}

// A session in a terminal phase no longer owns the node: it must not force
// "switching" mode (the live symptom: an Expired session kept a node badged
// Switching while it was actually back in inference mode).
const TERMINAL_SESSION_PHASES = new Set(['expired', 'completed', 'failed', 'terminated']);

export function isTerminalSession(session: GamingSession): boolean {
  return TERMINAL_SESSION_PHASES.has((session.status?.phase || '').toLowerCase());
}

/**
 * Where a model runs. The operator does not populate status.gpu on current
 * CRDs, so the spec's hostname pin is the placement source of truth; prefer
 * the status field when a future operator version fills it in.
 */
export function modelNodeName(model: FlexInferModel): string | undefined {
  return model.status?.gpu?.node || model.spec?.nodeSelector?.['kubernetes.io/hostname'] || undefined;
}

function computeMode(hasActiveGaming: boolean, hasSession: boolean, readyModels: number, totalModels: number): NodeMode {
  if (hasActiveGaming) return 'gaming';
  if (hasSession) return 'switching';
  if (readyModels > 0) return 'serving';
  if (totalModels > 0) return 'standby';
  return 'idle';
}

/**
 * Build the GPU fleet: the union of labelled GPU nodes, inference-model
 * placements, and gaming sessions. Nodes referenced only by a model or session
 * (e.g. a node whose labels haven't synced) are still surfaced.
 */
export function buildFleet(
  nodes: K8sNode[],
  models: FlexInferModel[],
  sessions: GamingSession[],
): FleetNode[] {
  const byName = new Map<string, FleetNode>();

  const ensure = (name: string): FleetNode => {
    let entry = byName.get(name);
    if (!entry) {
      entry = {
        name,
        vendor: '',
        arch: '',
        vram: '',
        gpuCount: 0,
        ready: false,
        gpuUtilPercent: null,
        freeVramMB: null,
        mode: 'idle',
        session: null,
        models: [],
        readyModels: 0,
      };
      byName.set(name, entry);
    }
    return entry;
  };

  for (const node of nodes) {
    if (!isGpuNode(node)) continue;
    const labels = node.metadata.labels || {};
    const annotations = node.metadata.annotations || {};
    const entry = ensure(node.metadata.name);
    entry.vendor = labels[GPU_LABEL_VENDOR] || entry.vendor;
    entry.arch = labels[GPU_LABEL_ARCH] || entry.arch;
    entry.vram = labels[GPU_LABEL_VRAM] || entry.vram;
    entry.gpuCount = Number(labels[GPU_LABEL_COUNT]) || entry.gpuCount;
    entry.ready = nodeReady(node);
    entry.gpuUtilPercent = parseUtilPercent(annotations[GPU_ANNOT_UTIL]);
    entry.freeVramMB = parseFreeMem(annotations[GPU_ANNOT_FREE_MEM]);
  }

  for (const model of models) {
    const nodeName = modelNodeName(model);
    if (!nodeName) continue;
    const entry = ensure(nodeName);
    const phase = model.status?.phase || 'Unknown';
    const ready = phase === 'Ready';
    entry.models.push({ name: model.name, namespace: model.namespace, phase, ready });
    if (ready) entry.readyModels += 1;
    // Fall back to the model's reported GPU vendor when the node lacks labels.
    if (!entry.vendor && model.status?.gpu?.vendor) entry.vendor = model.status.gpu.vendor;
    if (!entry.arch && model.status?.gpu?.architecture) entry.arch = model.status.gpu.architecture;
  }

  for (const session of sessions) {
    const nodeName = session.spec?.nodeName;
    if (!nodeName) continue;
    if (isTerminalSession(session)) continue;
    const entry = ensure(nodeName);
    // Prefer the most-advanced session (Active over Pending) if several exist.
    if (!entry.session || (isActiveGaming(session) && !isActiveGaming(entry.session))) {
      entry.session = session;
    }
  }

  const fleet = [...byName.values()];
  for (const entry of fleet) {
    const hasSession = entry.session != null;
    const hasActive = hasSession && isActiveGaming(entry.session as GamingSession);
    entry.mode = computeMode(hasActive, hasSession, entry.readyModels, entry.models.length);
    entry.models.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Stable, meaningful order: gaming first (the story), then serving, then the rest.
  const rank: Record<NodeMode, number> = { gaming: 0, switching: 1, serving: 2, standby: 3, idle: 4 };
  fleet.sort((a, b) => rank[a.mode] - rank[b.mode] || a.name.localeCompare(b.name));
  return fleet;
}

export function summarizeFleet(fleet: FleetNode[]): FleetSummary {
  const summary: FleetSummary = { total: fleet.length, gaming: 0, switching: 0, serving: 0, standby: 0, idle: 0 };
  for (const node of fleet) summary[node.mode] += 1;
  return summary;
}

export type ModeTone = 'ok' | 'warn' | 'error' | 'info' | 'default';

export function nodeModeTone(mode: NodeMode): ModeTone {
  switch (mode) {
    case 'gaming':
      return 'info'; // violet — a distinct, intentional non-inference state
    case 'serving':
      return 'ok';
    case 'switching':
    case 'standby':
      return 'warn';
    default:
      return 'default';
  }
}

export function nodeModeLabel(mode: NodeMode): string {
  switch (mode) {
    case 'gaming':
      return 'Gaming';
    case 'switching':
      return 'Switching';
    case 'serving':
      return 'Serving';
    case 'standby':
      return 'Standby';
    default:
      return 'Idle';
  }
}

/** Compact "streaming for 2h 14m" style duration since an ISO timestamp. */
export function formatUptime(iso: string | undefined, nowMs: number): string {
  if (!iso) return '';
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '';
  const secs = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}
