import { describe, expect, it } from 'vitest';
import type { WorkspaceRepository } from '../../lib/api';
import { getRepoReadiness, repositoryMatches, summarizeBinding, summarizeRemote } from './stackUtils';

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
});
