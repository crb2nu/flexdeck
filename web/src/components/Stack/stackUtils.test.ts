import { describe, expect, it } from 'vitest';
import type { WorkspaceRepository } from '../../lib/api';
import { getRepoReadiness, repositoryMatches, summarizeRemote } from './stackUtils';

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
});
