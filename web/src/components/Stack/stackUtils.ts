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
