import { k8s, modelsApi, workspaceApi } from '../../lib/api';
import type { PaletteCommand } from './commands';

// Live-entity commands for the palette: workspace repos, k8s workloads, and
// FlexInfer models, each deep-linking to its page with the search pre-applied
// (?q= support added page-side). Fetched lazily when the palette opens,
// best-effort per source, and cached briefly so reopening is instant.

const TTL_MS = 60_000;

interface EntityCache {
  at: number;
  commands: PaletteCommand[];
}

let cache: EntityCache | null = null;
let inflight: Promise<PaletteCommand[]> | null = null;

/** Test hook: drop the module cache. */
export function invalidateEntityCache(): void {
  cache = null;
  inflight = null;
}

interface EntitySources {
  repos: () => Promise<{ repositories?: { name: string; bucket: string; primaryLanguage?: string }[] }>;
  services: () => Promise<{ items?: { metadata?: { name?: string; namespace?: string } }[] }>;
  deployments: () => Promise<{ items?: { metadata?: { name?: string; namespace?: string } }[] }>;
  models: () => Promise<{ models?: { name: string; namespace: string; status?: { phase?: string } }[] }>;
}

const defaultSources: EntitySources = {
  repos: () => workspaceApi.getRepos(),
  services: () => k8s.getServices(),
  deployments: () => k8s.getDeployments(),
  models: () => modelsApi.crd(),
};

export async function buildEntityCommands(sources: EntitySources = defaultSources): Promise<PaletteCommand[]> {
  const [repos, services, deployments, models] = await Promise.allSettled([
    sources.repos(),
    sources.services(),
    sources.deployments(),
    sources.models(),
  ]);

  const commands: PaletteCommand[] = [];

  if (repos.status === 'fulfilled') {
    for (const repo of repos.value.repositories ?? []) {
      commands.push({
        id: `repo:${repo.bucket}/${repo.name}`,
        name: repo.name,
        description: `Repository · ${repo.bucket}${repo.primaryLanguage ? ` · ${repo.primaryLanguage}` : ''}`,
        keywords: ['repo', 'repository', repo.bucket],
        href: `/stack?q=${encodeURIComponent(repo.name)}`,
        section: 'Repos',
      });
    }
  }

  if (services.status === 'fulfilled') {
    for (const svc of services.value.items ?? []) {
      const name = svc.metadata?.name;
      if (!name) continue;
      const ns = svc.metadata?.namespace ?? '';
      commands.push({
        id: `svc:${ns}/${name}`,
        name,
        description: `Service · ${ns}`,
        keywords: ['service', 'k8s', ns],
        href: `/services?tab=services&q=${encodeURIComponent(name)}`,
        section: 'Workloads',
      });
    }
  }

  if (deployments.status === 'fulfilled') {
    for (const dep of deployments.value.items ?? []) {
      const name = dep.metadata?.name;
      if (!name) continue;
      const ns = dep.metadata?.namespace ?? '';
      commands.push({
        id: `deploy:${ns}/${name}`,
        name,
        description: `Deployment · ${ns}`,
        keywords: ['deployment', 'k8s', 'workload', ns],
        href: `/services?tab=deployments&q=${encodeURIComponent(name)}`,
        section: 'Workloads',
      });
    }
  }

  if (models.status === 'fulfilled') {
    for (const model of models.value.models ?? []) {
      commands.push({
        id: `model:${model.namespace}/${model.name}`,
        name: model.name,
        description: `FlexInfer model · ${model.namespace}${model.status?.phase ? ` · ${model.status.phase}` : ''}`,
        keywords: ['model', 'llm', 'inference', model.namespace],
        href: `/flexinfer?section=telemetry&q=${encodeURIComponent(model.name)}`,
        section: 'Models',
      });
    }
  }

  return commands;
}

/** Cached entry point used by the palette. Never rejects — worst case []. */
export function fetchEntityCommands(): Promise<PaletteCommand[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.commands);
  if (inflight) return inflight;
  inflight = buildEntityCommands()
    .then((commands) => {
      cache = { at: Date.now(), commands };
      inflight = null;
      return commands;
    })
    .catch(() => {
      inflight = null;
      return cache?.commands ?? [];
    });
  return inflight;
}
