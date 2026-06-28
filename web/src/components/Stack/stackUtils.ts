import type { WorkspaceRepository, WorkspaceWorkloadStatus } from '../../lib/api';

export type StackBucketFilter = 'all' | 'services' | 'libs';
export type StackReadinessFilter = 'all' | 'ready' | 'attention';
export type StackBindingFilter = 'all' | 'verified' | 'degraded' | 'inferred';
export type StackAdoptionFilter = 'all' | 'adopted' | 'unadopted';
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
    ...(repo.dependsOn ?? []),
    ...(repo.usedBy ?? []),
    ...(repo.usedByLibs ?? []),
  ];

  return searchable.some((value) => value.toLowerCase().includes(normalizedQuery));
}

// libAdoptionLabel describes how widely a library is adopted. Service adoption
// (the contract-coverage signal) leads; lib→lib consumers are appended so a lib
// used only by other libs reads as transitively used, not a dead orphan. A lib
// with no adopters of either kind is surfaced explicitly — that gap is the point
// of the contract-coverage view.
export function libAdoptionLabel(repo: WorkspaceRepository): string {
  const services = repo.usedBy ?? [];
  const libs = repo.usedByLibs ?? [];
  const serviceLabel =
    services.length > 0
      ? `${services.length} ${services.length === 1 ? 'service' : 'services'}: ${services.join(', ')}`
      : 'No service adopters yet';
  if (libs.length === 0) return serviceLabel;

  const libLabel = `${libs.length} ${libs.length === 1 ? 'lib' : 'libs'}: ${libs.join(', ')}`;
  const head = services.length > 0 ? serviceLabel : 'No service adopters';
  return `${head} · used by ${libLabel}`;
}

// --- library adoption coverage ---

export function isLibrary(repo: WorkspaceRepository): boolean {
  return repo.bucket === 'libs';
}

// isAdoptedLib / isUnadoptedLib partition libraries by whether any service
// depends on them. Unadopted libs are the cross-cutting contract libs nobody
// has wired in yet — the coverage gap.
export function isAdoptedLib(repo: WorkspaceRepository): boolean {
  return isLibrary(repo) && (repo.usedBy?.length ?? 0) > 0;
}

export function isUnadoptedLib(repo: WorkspaceRepository): boolean {
  return isLibrary(repo) && (repo.usedBy?.length ?? 0) === 0;
}

export interface AdoptionSummary {
  libs: number;
  adopted: number;
  unadopted: number;
  coveragePct: number;
  unadoptedNames: string[];
}

// summarizeAdoption tallies library contract coverage: how many workspace libs
// have at least one service adopter vs none.
export function summarizeAdoption(repos: WorkspaceRepository[]): AdoptionSummary {
  const libs = repos.filter(isLibrary);
  const adopted = libs.filter((repo) => (repo.usedBy?.length ?? 0) > 0);
  return {
    libs: libs.length,
    adopted: adopted.length,
    unadopted: libs.length - adopted.length,
    coveragePct: libs.length > 0 ? Math.round((adopted.length / libs.length) * 100) : 0,
    unadoptedNames: libs
      .filter((repo) => (repo.usedBy?.length ?? 0) === 0)
      .map((repo) => repo.name)
      .sort(),
  };
}

// matchesAdoptionFilter applies the Stack "Adoption" filter, scoped to libs:
// 'adopted' shows libs with >=1 service adopter, 'unadopted' shows the
// zero-adopter contract libs, 'all' is a no-op.
export function matchesAdoptionFilter(repo: WorkspaceRepository, filter: StackAdoptionFilter): boolean {
  switch (filter) {
    case 'adopted':
      return isAdoptedLib(repo);
    case 'unadopted':
      return isUnadoptedLib(repo);
    default:
      return true;
  }
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
  workloadStatus?: WorkspaceWorkloadStatus;
  workloadKinds?: string;
}

function describeWorkloadKinds(
  workload: NonNullable<WorkspaceRepository['binding']>['workload'],
): string | undefined {
  if (!workload) return undefined;
  const parts: string[] = [];
  const add = (count: number | undefined, singular: string) => {
    if (count && count > 0) parts.push(`${count} ${count === 1 ? singular : `${singular}s`}`);
  };
  add(workload.deployments, 'deployment');
  add(workload.statefulSets, 'statefulset');
  add(workload.daemonSets, 'daemonset');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// summarizeBinding turns the service-to-cluster binding into a compact card
// descriptor. Services report their namespace + Flux source, plus live workload
// health (Deployments/StatefulSets/DaemonSets) when known; libraries report that
// they are consumed rather than deployed. Returns null when no binding metadata
// is present (older payloads or unknown kinds).
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
    const status = workloadStatus(repo);
    return {
      label: parts.join(' · '),
      detail: binding.confidence === 'verified' ? 'verified target' : 'inferred from naming',
      confidence: binding.confidence,
      verified: binding.confidence === 'verified',
      workload: workload ? `${workload.ready}/${workload.desired} ready` : undefined,
      workloadHealthy: status ? status === 'healthy' : undefined,
      workloadStatus: status,
      workloadKinds: describeWorkloadKinds(workload),
    };
  }

  return null;
}

// isVerifiedBinding reports whether a repo's binding was confirmed against live
// Flux/cluster state (confidence === 'verified').
export function isVerifiedBinding(repo: WorkspaceRepository): boolean {
  return repo.binding?.confidence === 'verified';
}

// isInferredBinding reports a binding guessed from naming but not verified.
export function isInferredBinding(repo: WorkspaceRepository): boolean {
  return repo.binding?.confidence === 'inferred';
}

// workloadStatus resolves a workload's rollout health, falling back to a replica
// comparison for older payloads that predate the backend `status`. A workload
// mid-rollout reports `progressing`, not `degraded`.
export function workloadStatus(repo: WorkspaceRepository): WorkspaceWorkloadStatus | undefined {
  const workload = repo.binding?.workload;
  if (!workload) return undefined;
  if (workload.status) return workload.status;
  return workload.desired > 0 && workload.ready < workload.desired ? 'degraded' : 'healthy';
}

// isDegradedBinding reports a service whose live workload is genuinely unhealthy
// (stuck or missing replicas), excluding an in-flight rollout.
export function isDegradedBinding(repo: WorkspaceRepository): boolean {
  return workloadStatus(repo) === 'degraded';
}

// bindingSeverity ranks a repo by live cluster-health urgency so the Stack list
// can surface problems first: degraded (2) > progressing (1) > everything else.
export function bindingSeverity(repo: WorkspaceRepository): number {
  switch (workloadStatus(repo)) {
    case 'degraded':
      return 2;
    case 'progressing':
      return 1;
    default:
      return 0;
  }
}

// compareByBindingConcern orders repositories for the Stack list: unhealthy
// cluster workloads first, then the existing scanner-readiness score, then a
// stable bucket/name tiebreak.
export function compareByBindingConcern(left: WorkspaceRepository, right: WorkspaceRepository): number {
  const severityDelta = bindingSeverity(right) - bindingSeverity(left);
  if (severityDelta !== 0) return severityDelta;

  const readinessDelta = getRepoReadiness(right).score - getRepoReadiness(left).score;
  if (readinessDelta !== 0) return readinessDelta;

  if (left.bucket !== right.bucket) return left.bucket.localeCompare(right.bucket);
  return left.name.localeCompare(right.name);
}

// matchesBindingFilter applies the Stack "Cluster" filter. Degraded is a subset
// of verified surfaced on its own so operators can triage unhealthy services.
export function matchesBindingFilter(repo: WorkspaceRepository, filter: StackBindingFilter): boolean {
  switch (filter) {
    case 'verified':
      return isVerifiedBinding(repo);
    case 'degraded':
      return isDegradedBinding(repo);
    case 'inferred':
      return isInferredBinding(repo);
    default:
      return true;
  }
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
