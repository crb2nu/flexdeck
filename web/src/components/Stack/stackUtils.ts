import type { WorkspaceRepository } from '../../lib/api';

export type StackBucketFilter = 'all' | 'services' | 'libs';
export type StackReadinessFilter = 'all' | 'ready' | 'attention';
export type RepoReadinessLevel = 'ready' | 'attention';

export interface RepoReadiness {
  level: RepoReadinessLevel;
  label: string;
  reasons: string[];
  score: number;
}

export function getRepoReadiness(repo: WorkspaceRepository): RepoReadiness {
  const reasons: string[] = [];
  const repoErrors = repo.errors?.length ?? 0;
  const gitErrors = repo.git.errors?.length ?? 0;

  if (repoErrors + gitErrors > 0) {
    reasons.push('Scanner warning');
  }
  if (!repo.git.isRepository) {
    reasons.push('No git metadata');
  }
  if (repo.git.isRepository && !repo.git.clean) {
    const dirtyCount = repo.git.dirtyCount ?? 1;
    reasons.push(`${dirtyCount} dirty ${dirtyCount === 1 ? 'file' : 'files'}`);
  }
  if ((repo.manifests?.length ?? 0) === 0) {
    reasons.push('No manifests');
  }

  return {
    level: reasons.length === 0 ? 'ready' : 'attention',
    label: reasons.length === 0 ? 'Ready' : 'Review',
    reasons,
    score: reasons.length,
  };
}

export function repositoryMatches(repo: WorkspaceRepository, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') return true;

  const binding = repo.binding;
  const searchable = [
    repo.name,
    repo.bucket,
    repo.path,
    repo.primaryLanguage ?? '',
    repo.git.branch ?? '',
    ...(repo.packageManagers ?? []),
    ...(repo.manifests ?? []).flatMap((manifest) => [manifest.path, manifest.type]),
    ...(repo.git.remotes ?? []).flatMap((remote) => [remote.name, remote.url]),
    ...(repo.discoveryReasons ?? []),
    binding?.kind ?? '',
    binding?.namespace ?? '',
    binding?.fluxSource ?? '',
    binding?.fluxNamespace ?? '',
    binding?.kustomization ?? '',
    binding?.gitlabProject ?? '',
    binding?.matchKey ?? '',
  ];

  return searchable.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function hasManifest(repo: WorkspaceRepository, manifestType: string): boolean {
  return repo.manifests?.some((manifest) => manifest.type === manifestType || manifest.path === manifestType) ?? false;
}

export function getRepositoryLanguage(repo: WorkspaceRepository): string {
  return repo.primaryLanguage?.trim() || 'unknown';
}

export function getDocsCount(repo: WorkspaceRepository): number {
  return [repo.docs.agents, repo.docs.readme, repo.docs.roadmap, repo.docs.loom].filter(Boolean).length;
}

export function formatBucketLabel(bucket: string): string {
  if (bucket === 'services') return 'Services';
  if (bucket === 'libs') return 'Libraries';
  return bucket;
}

export interface BindingSummary {
  label: string;
  detail: string;
  confidence: 'verified' | 'inferred' | 'none';
  verified: boolean;
  workload?: string;
  workloadHealthy?: boolean;
}

// summarizeBinding turns the service-to-cluster binding into a compact card
// descriptor. Services report their namespace + Flux source, plus live
// Deployment health when known; libraries report that they are consumed rather
// than deployed. Returns null when no binding metadata is present (older
// payloads or unknown kinds).
export function summarizeBinding(repo: WorkspaceRepository): BindingSummary | null {
  const binding = repo.binding;
  if (!binding) return null;

  if (binding.kind === 'library') {
    return { label: 'Library', detail: 'consumed, not deployed', confidence: 'none', verified: false };
  }

  if (binding.kind === 'service') {
    const parts: string[] = [];
    if (binding.namespace) parts.push(`ns ${binding.namespace}`);
    if (binding.fluxSource) parts.push(`flux ${binding.fluxSource}`);
    if (parts.length === 0) return null;

    const workload = binding.workload;
    return {
      label: parts.join(' · '),
      detail: binding.confidence === 'verified' ? 'verified target' : 'inferred from naming',
      confidence: binding.confidence,
      verified: binding.confidence === 'verified',
      workload: workload ? `${workload.ready}/${workload.desired} ready` : undefined,
      workloadHealthy: workload ? workload.ready >= workload.desired && workload.desired > 0 : undefined,
    };
  }

  return null;
}

export function summarizeRemote(repo: WorkspaceRepository): string {
  const remote = repo.git.remotes?.[0];
  if (!remote) return '';

  const value = remote.url.trim();
  if (value === '') return remote.name;

  try {
    const parsed = new URL(value);
    return `${remote.name}: ${parsed.hostname}${parsed.pathname.replace(/\.git$/, '')}`;
  } catch {
    const sshMatch = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return `${remote.name}: ${sshMatch[1]}/${sshMatch[2]}`;
    }
    return `${remote.name}: ${value.replace(/\.git$/, '')}`;
  }
}
