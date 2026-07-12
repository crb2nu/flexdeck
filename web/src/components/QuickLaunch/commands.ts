import { buildNavItems, isLoomControlPlaneEnabled, type FeatureMap } from '../../lib/featureFlags';

// Command registry + ranking for the ⌘K palette. Navigation commands are
// derived from the same feature-gated source as the top nav (buildNavItems),
// so the palette can never drift from the routes that actually exist.

export interface PaletteCommand {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  /** Router target; commands without an href carry their own action. */
  href?: string;
  section: 'Navigate' | 'FlexInfer' | 'Loom' | 'Actions' | 'Repos' | 'Workloads' | 'Models';
}

const NAV_KEYWORDS: Record<string, string[]> = {
  '/': ['home', 'main', 'topology', 'cluster'],
  '/services': ['k8s', 'workloads', 'pods', 'deployments', 'ingress'],
  '/stack': ['workspace', 'repos', 'libs', 'local stack', 'binding'],
  '/infra': ['nodes', 'longhorn', 'storage', 'hardware', 'capacity'],
  '/flux': ['gitops', 'kustomization', 'helm', 'reconcile', 'deploy'],
  '/pipeline': ['ci', 'cd', 'gitlab', 'build', 'jobs'],
  '/logs': ['loki', 'search', 'debug', 'tail'],
  '/website-metrics': ['traffic', 'analytics', 'page views', 'public'],
  '/metrics': ['prometheus', 'graphs', 'monitoring', 'grafana'],
  '/flexinfer': ['llm', 'ai', 'inference', 'models', 'crd', 'workbench'],
  '/loom': ['agents', 'hud', 'control plane', 'fleet', 'workflows'],
  '/loom-hud': ['agents', 'hud', 'workflows', 'bots'],
  '/projects': ['tracking', 'issues', 'milestones', 'risks'],
  '/admin': ['users', 'rbac', 'audit', 'clusters', 'settings'],
};

const LOOM_TABS: { id: string; label: string; keywords: string[] }[] = [
  { id: 'fleet', label: 'Fleet', keywords: ['agents', 'hud', 'sessions', 'presence'] },
  { id: 'projects', label: 'Projects', keywords: ['tracking', 'issues', 'risks'] },
  { id: 'plans', label: 'Plans', keywords: ['slices', 'lifecycle'] },
  { id: 'mills', label: 'Mills', keywords: ['operator', 'council', 'backlog'] },
  { id: 'flightdeck', label: 'Flightdeck', keywords: ['stall board', 'turns', 'subagents'] },
];

const WORKBENCH_SECTIONS: { id: string; label: string; keywords: string[] }[] = [
  { id: 'overview', label: 'Overview', keywords: ['cockpit', 'summary'] },
  { id: 'control-plane', label: 'Control plane', keywords: ['crd', 'models', 'reliability'] },
  { id: 'gpu-fleet', label: 'GPU Fleet', keywords: ['nodes', 'gaming', 'sharing', 'swap', 'vram'] },
  { id: 'telemetry', label: 'Telemetry', keywords: ['proxy', 'router', 'latency', 'triage'] },
  { id: 'supply-chain', label: 'Supply chain', keywords: ['catalogs', 'caches', 'downloads'] },
  { id: 'intake', label: 'Intake', keywords: ['search', 'register', 'huggingface'] },
];

/** Feature-gated navigation commands: top-level pages + deep-linkable surfaces. */
export function buildNavCommands(features: FeatureMap): PaletteCommand[] {
  const commands: PaletteCommand[] = [];

  for (const item of buildNavItems(features)) {
    commands.push({
      id: `nav:${item.path}`,
      name: `Go to ${item.label}`,
      description: `Open the ${item.label} page`,
      keywords: NAV_KEYWORDS[item.path] ?? [],
      href: item.path,
      section: 'Navigate',
    });
  }

  for (const s of WORKBENCH_SECTIONS) {
    commands.push({
      id: `flexinfer:${s.id}`,
      name: `FlexInfer · ${s.label}`,
      description: `Jump to the ${s.label} section of the FlexInfer workbench`,
      keywords: s.keywords,
      href: `/flexinfer?section=${s.id}`,
      section: 'FlexInfer',
    });
  }

  if (isLoomControlPlaneEnabled(features)) {
    for (const t of LOOM_TABS) {
      commands.push({
        id: `loom:${t.id}`,
        name: `Loom · ${t.label}`,
        description: `Jump to the ${t.label} surface of the Loom control plane`,
        keywords: t.keywords,
        href: t.id === 'fleet' ? '/loom' : `/loom?tab=${t.id}`,
        section: 'Loom',
      });
    }
  }

  return commands;
}

/**
 * Score a command against a query. 0 means no match; higher is better.
 * Ordered tiers: name prefix > name word prefix > name substring > keyword >
 * description substring > name subsequence.
 */
export function scoreCommand(cmd: PaletteCommand, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const name = cmd.name.toLowerCase();
  if (name.startsWith(q)) return 100;
  if (name.split(/[\s·]+/).some((w) => w.startsWith(q))) return 80;
  if (name.includes(q)) return 60;
  if (cmd.keywords.some((k) => k.startsWith(q))) return 50;
  if (cmd.keywords.some((k) => k.includes(q))) return 40;
  if (cmd.description.toLowerCase().includes(q)) return 20;
  if (isSubsequence(q, name)) return 10;
  return 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

const RECENTS_KEY = 'flexdeck.palette.recents';
const RECENTS_MAX = 8;
const RECENT_BONUS = 15;

export function loadRecents(storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  try {
    const raw = storage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

export function recordRecent(
  id: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): string[] {
  const next = [id, ...loadRecents(storage).filter((r) => r !== id)].slice(0, RECENTS_MAX);
  try {
    storage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Private-mode / quota failures just lose recency ranking.
  }
  return next;
}

/**
 * Rank commands for display. With a query: score-ordered (recents break ties
 * upward). Without one: recently used first, then registry order.
 */
export function rankCommands(commands: PaletteCommand[], query: string, recents: string[]): PaletteCommand[] {
  const recentRank = new Map(recents.map((id, i) => [id, i]));

  if (!query.trim()) {
    const recent = recents
      .map((id) => commands.find((c) => c.id === id))
      .filter((c): c is PaletteCommand => Boolean(c));
    const rest = commands.filter((c) => !recentRank.has(c.id));
    return [...recent, ...rest];
  }

  return commands
    .map((cmd) => {
      let score = scoreCommand(cmd, query);
      if (score > 0 && recentRank.has(cmd.id)) score += RECENT_BONUS;
      return { cmd, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))
    .map((s) => s.cmd);
}
