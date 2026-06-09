import { describe, expect, it } from 'vitest';
import type { WorkspaceRepository } from '../../lib/api';
import {
  bindingSeverity,
  compareByBindingConcern,
  getRepoReadiness,
  isDegradedBinding,
  isInferredBinding,
  isVerifiedBinding,
  matchesBindingFilter,
  repositoryMatches,
  summarizeBinding,
  summarizeRemote,
} from './stackUtils';

function makeRepo(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  return {
    name: 'flexdeck',
    bucket: 'services',
    path: '/workspace/services/flexdeck',
    primaryLanguage: 'go',
    packageManagers: ['go', 'npm'],
    manifests: [
      { type: 'go-mod', path: 'go.mod' },
      { type: 'gitlab-ci', path: '.gitlab-ci.yml' },
    ],
    docs: {
      agents: true,
      readme: true,
      roadmap: true,
      loom: true,
    },
    worktreeCount: 0,
    git: {
      isRepository: true,
      branch: 'main',
      clean: true,
      remotes: [{ name: 'origin', url: 'https://gitlab.example.com/services/flexdeck.git' }],
    },
    discoveryReasons: ['.git', 'go.mod'],
    ...overrides,
  };
}

describe('stackUtils', () => {
  it('marks clean documented repositories as ready', () => {
    expect(getRepoReadiness(makeRepo())).toMatchObject({
      level: 'ready',
      label: 'Ready',
      reasons: [],
    });
  });

  it('collects local review reasons from scanner metadata', () => {
    const readiness = getRepoReadiness(makeRepo({
      docs: { agents: true, readme: false, roadmap: false, loom: false },
      worktreeCount: 2,
      git: {
        isRepository: true,
        branch: 'feature/local',
        clean: false,
        dirtyCount: 3,
      },
    }));

    expect(readiness.level).toBe('attention');
    expect(readiness.reasons).toEqual(['3 dirty files']);
  });

  it('matches search terms across manifests, remotes, branches, and package managers', () => {
    const repo = makeRepo();

    expect(repositoryMatches(repo, 'gitlab.example.com')).toBe(true);
    expect(repositoryMatches(repo, 'go.mod')).toBe(true);
    expect(repositoryMatches(repo, 'npm')).toBe(true);
    expect(repositoryMatches(repo, 'main')).toBe(true);
    expect(repositoryMatches(repo, 'not-present')).toBe(false);
  });

  it('summarizes common remote URL shapes without credentials', () => {
    expect(summarizeRemote(makeRepo())).toBe('origin: gitlab.example.com/services/flexdeck');
    expect(summarizeRemote(makeRepo({
      git: {
        isRepository: true,
        clean: true,
        remotes: [{ name: 'origin', url: 'git@gitlab.example.com:libs/visual-kit.git' }],
      },
    }))).toBe('origin: gitlab.example.com/libs/visual-kit');
  });

  it('summarizes an inferred service binding as namespace + flux source', () => {
    const summary = summarizeBinding(makeRepo({
      binding: {
        kind: 'service',
        confidence: 'inferred',
        namespace: 'flexdeck',
        fluxSource: 'flexdeck',
        kustomization: 'flexdeck',
        gitlabProject: 'services/flexdeck',
        matchKey: 'gitlab.example.com/services/flexdeck',
      },
    }));

    expect(summary).toEqual({
      label: 'ns flexdeck · flux flexdeck',
      detail: 'inferred from naming',
      confidence: 'inferred',
      verified: false,
    });
  });

  it('marks a verified binding with the verified detail and flag', () => {
    const summary = summarizeBinding(makeRepo({
      binding: {
        kind: 'service',
        confidence: 'verified',
        namespace: 'flexdeck',
        fluxSource: 'flexdeck',
        fluxNamespace: 'flux-system',
        kustomization: 'flexdeck',
        gitlabProject: 'services/flexdeck',
      },
    }));

    expect(summary).toEqual({
      label: 'ns flexdeck · flux flexdeck',
      detail: 'verified target',
      confidence: 'verified',
      verified: true,
    });
  });

  it('includes live workload health on a verified binding', () => {
    const summary = summarizeBinding(makeRepo({
      binding: {
        kind: 'service',
        confidence: 'verified',
        namespace: 'flexinfer-system',
        fluxSource: 'flexinfer',
        kustomization: 'flexinfer-system',
        workload: { namespaces: ['flexinfer-system'], deployments: 2, ready: 2, desired: 2 },
      },
    }));

    expect(summary).toMatchObject({ verified: true, workload: '2/2 ready', workloadHealthy: true });
  });

  it('flags an unhealthy workload', () => {
    const summary = summarizeBinding(makeRepo({
      binding: {
        kind: 'service',
        confidence: 'verified',
        namespace: 'flexdeck',
        fluxSource: 'flexdeck',
        workload: { namespaces: ['flexdeck'], deployments: 3, ready: 2, desired: 3 },
      },
    }));

    expect(summary).toMatchObject({ workload: '2/3 ready', workloadHealthy: false });
  });

  it('describes a StatefulSet-backed workload by kind', () => {
    const summary = summarizeBinding(makeRepo({
      binding: {
        kind: 'service',
        confidence: 'verified',
        namespace: 'smarthome',
        fluxSource: 'smarthome',
        workload: { namespaces: ['smarthome'], statefulSets: 1, ready: 1, desired: 1 },
      },
    }));

    expect(summary).toMatchObject({ workload: '1/1 ready', workloadHealthy: true, workloadKinds: '1 statefulset' });
  });

  it('reports progressing vs degraded rollout status', () => {
    const progressing = summarizeBinding(makeRepo({
      binding: { kind: 'service', confidence: 'verified', namespace: 'x', fluxSource: 'x', workload: { ready: 1, desired: 2, status: 'progressing' } },
    }));
    expect(progressing).toMatchObject({ workload: '1/2 ready', workloadStatus: 'progressing', workloadHealthy: false });

    const degraded = summarizeBinding(makeRepo({
      binding: { kind: 'service', confidence: 'verified', namespace: 'x', fluxSource: 'x', workload: { ready: 0, desired: 1, status: 'degraded' } },
    }));
    expect(degraded).toMatchObject({ workloadStatus: 'degraded', workloadHealthy: false });

    // Older payloads without status fall back to a replica comparison.
    const fallback = summarizeBinding(makeRepo({
      binding: { kind: 'service', confidence: 'verified', namespace: 'x', fluxSource: 'x', workload: { ready: 1, desired: 1 } },
    }));
    expect(fallback).toMatchObject({ workloadStatus: 'healthy', workloadHealthy: true });
  });

  it('summarizes a library binding as not deployed', () => {
    const summary = summarizeBinding(makeRepo({
      bucket: 'libs',
      binding: { kind: 'library', confidence: 'none', gitlabProject: 'libs/visual-kit' },
    }));

    expect(summary).toMatchObject({ label: 'Library', confidence: 'none', verified: false });
  });

  it('returns null when no binding metadata is present', () => {
    expect(summarizeBinding(makeRepo({ binding: undefined }))).toBeNull();
  });

  it('matches search terms across inferred binding fields', () => {
    const repo = makeRepo({
      binding: {
        kind: 'service',
        confidence: 'inferred',
        namespace: 'inference-zone',
        fluxSource: 'edge-source',
        gitlabProject: 'services/flexdeck',
        matchKey: 'gitlab.example.com/services/flexdeck',
      },
    });

    // Tokens that only exist on the binding, not on name/path/remote.
    expect(repositoryMatches(repo, 'inference-zone')).toBe(true);
    expect(repositoryMatches(repo, 'edge-source')).toBe(true);
    expect(repositoryMatches(repo, 'not-present')).toBe(false);
  });

  describe('cluster binding filter', () => {
    const verifiedHealthy = makeRepo({
      binding: { kind: 'service', confidence: 'verified', namespace: 'flexdeck', fluxSource: 'flexdeck', workload: { ready: 3, desired: 3 } },
    });
    const verifiedDegraded = makeRepo({
      binding: { kind: 'service', confidence: 'verified', namespace: 'flexinfer-system', fluxSource: 'flexinfer', workload: { ready: 1, desired: 2, status: 'degraded' } },
    });
    const verifiedProgressing = makeRepo({
      binding: { kind: 'service', confidence: 'verified', namespace: 'svc', fluxSource: 'svc', workload: { ready: 1, desired: 2, status: 'progressing' } },
    });
    const inferredOnly = makeRepo({
      binding: { kind: 'service', confidence: 'inferred', namespace: 'loom-core', fluxSource: 'loom-core' },
    });
    const library = makeRepo({ bucket: 'libs', binding: { kind: 'library', confidence: 'none' } });
    const noBinding = makeRepo({ binding: undefined });

    it('classifies binding predicates', () => {
      expect(isVerifiedBinding(verifiedHealthy)).toBe(true);
      expect(isVerifiedBinding(verifiedDegraded)).toBe(true);
      expect(isVerifiedBinding(inferredOnly)).toBe(false);

      expect(isDegradedBinding(verifiedDegraded)).toBe(true);
      expect(isDegradedBinding(verifiedHealthy)).toBe(false);
      expect(isDegradedBinding(inferredOnly)).toBe(false);
      // A workload mid-rollout is progressing, not degraded.
      expect(isDegradedBinding(verifiedProgressing)).toBe(false);

      expect(isInferredBinding(inferredOnly)).toBe(true);
      expect(isInferredBinding(verifiedHealthy)).toBe(false);
    });

    it('matchesBindingFilter selects the right repos', () => {
      expect(matchesBindingFilter(library, 'all')).toBe(true);
      expect(matchesBindingFilter(noBinding, 'all')).toBe(true);

      expect(matchesBindingFilter(verifiedHealthy, 'verified')).toBe(true);
      expect(matchesBindingFilter(verifiedDegraded, 'verified')).toBe(true);
      expect(matchesBindingFilter(inferredOnly, 'verified')).toBe(false);

      // Degraded is the verified subset that is genuinely unhealthy, not a rollout.
      expect(matchesBindingFilter(verifiedDegraded, 'degraded')).toBe(true);
      expect(matchesBindingFilter(verifiedHealthy, 'degraded')).toBe(false);
      expect(matchesBindingFilter(verifiedProgressing, 'degraded')).toBe(false);
      expect(matchesBindingFilter(verifiedProgressing, 'verified')).toBe(true);

      expect(matchesBindingFilter(inferredOnly, 'inferred')).toBe(true);
      expect(matchesBindingFilter(verifiedHealthy, 'inferred')).toBe(false);
      expect(matchesBindingFilter(library, 'inferred')).toBe(false);
    });
  });

  describe('health-first sort', () => {
    const svc = (name: string, status?: 'healthy' | 'progressing' | 'degraded') =>
      makeRepo({
        name,
        binding: status
          ? { kind: 'service', confidence: 'verified', namespace: name, fluxSource: name, workload: { ready: 1, desired: 2, status } }
          : undefined,
      });

    it('ranks binding severity degraded > progressing > rest', () => {
      expect(bindingSeverity(svc('a', 'degraded'))).toBe(2);
      expect(bindingSeverity(svc('b', 'progressing'))).toBe(1);
      expect(bindingSeverity(svc('c', 'healthy'))).toBe(0);
      expect(bindingSeverity(svc('d'))).toBe(0);
    });

    it('sorts degraded first, then progressing, then by readiness/name', () => {
      const degraded = svc('zeta', 'degraded');
      const progressing = svc('alpha', 'progressing');
      const healthyA = svc('mango', 'healthy');
      // A clean healthy repo and a dirty one (higher readiness score) to check the tiebreak.
      const dirty = makeRepo({
        name: 'kilo',
        git: { isRepository: true, branch: 'main', clean: false, dirtyCount: 3 },
      });

      const sorted = [healthyA, dirty, progressing, degraded].sort(compareByBindingConcern).map((r) => r.name);
      // degraded first, progressing second, then the dirty repo (readiness score) before the clean one.
      expect(sorted).toEqual(['zeta', 'alpha', 'kilo', 'mango']);
    });
  });
});
