import { api } from './client';

export type WorkspaceBucket = 'services' | 'libs' | string;

export interface WorkspaceInventory {
  root: string;
  generatedAt: string;
  totals: WorkspaceTotals;
  repositories: WorkspaceRepository[];
  errors?: string[];
}

export interface WorkspaceTotals {
  repositories: number;
  services: number;
  libs: number;
  byLanguage?: Record<string, number>;
}

export interface WorkspaceRepository {
  name: string;
  bucket: WorkspaceBucket;
  path: string;
  primaryLanguage?: string;
  packageManagers?: string[];
  manifests?: WorkspaceManifest[];
  docs: WorkspaceDocs;
  worktreeCount?: number;
  git: WorkspaceGitState;
  binding?: WorkspaceRepoBinding;
  discoveryReasons?: string[];
  errors?: string[];
}

export type WorkspaceBindingKind = 'service' | 'library' | 'unknown';
export type WorkspaceBindingConfidence = 'verified' | 'inferred' | 'none';

export interface WorkspaceRepoBinding {
  kind: WorkspaceBindingKind;
  confidence: WorkspaceBindingConfidence;
  gitlabProject?: string;
  namespace?: string;
  fluxSource?: string;
  kustomization?: string;
  matchKey?: string;
  signals?: string[];
}

export interface WorkspaceManifest {
  type: string;
  path: string;
}

export interface WorkspaceDocs {
  agents: boolean;
  readme: boolean;
  roadmap: boolean;
  loom: boolean;
}

export interface WorkspaceGitState {
  isRepository: boolean;
  branch?: string;
  clean: boolean;
  dirtyCount?: number;
  remotes?: WorkspaceGitRemote[];
  errors?: string[];
}

export interface WorkspaceGitRemote {
  name: string;
  url: string;
}

export const workspaceApi = {
  getRepos: () => api<WorkspaceInventory>('/workspace/repos'),
};
