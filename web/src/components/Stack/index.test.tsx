/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInventory, WorkspaceRepository } from '../../lib/api';

const stackMocks = vi.hoisted(() => ({
  getRepos: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  workspaceApi: {
    getRepos: stackMocks.getRepos,
  },
}));

import Stack from './index';

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

function makeInventory(): WorkspaceInventory {
  return {
    root: '/workspace',
    generatedAt: '2026-06-06T12:00:00Z',
    totals: {
      repositories: 3,
      services: 2,
      libs: 1,
      byLanguage: {
        go: 2,
        typescript: 1,
      },
    },
    repositories: [
      makeRepo(),
      makeRepo({
        name: 'loom-core',
        path: '/workspace/services/loom-core',
        primaryLanguage: 'go',
        packageManagers: ['go'],
        manifests: [{ type: 'go-mod', path: 'go.mod' }],
        git: {
          isRepository: true,
          branch: 'main',
          clean: true,
        },
      }),
      makeRepo({
        name: 'visual-kit',
        bucket: 'libs',
        path: '/workspace/libs/visual-kit',
        primaryLanguage: 'typescript',
        packageManagers: ['npm', 'pnpm'],
        manifests: [{ type: 'package-json', path: 'package.json' }],
        docs: {
          agents: true,
          readme: false,
          roadmap: false,
          loom: true,
        },
        worktreeCount: 1,
        git: {
          isRepository: true,
          branch: 'codex/visual-refresh',
          clean: false,
          dirtyCount: 2,
          remotes: [{ name: 'origin', url: 'git@gitlab.example.com:libs/visual-kit.git' }],
        },
      }),
    ],
  };
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <Stack />, container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function inputSearch(value: string) {
  const input = document.querySelector('input[aria-label="Search stack repositories"]') as HTMLInputElement | null;
  expect(input).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}

function clickButtonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function repoCard(bucket: string, name: string): HTMLElement | null {
  return document.querySelector(`[data-testid="stack-repo-${bucket}-${name}"]`);
}

describe('Stack Explorer', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    stackMocks.getRepos.mockReset();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('renders inventory summaries and filters repositories by search and bucket', async () => {
    stackMocks.getRepos.mockResolvedValue(makeInventory());
    cleanup = mount();

    await vi.waitFor(() => {
      expect(repoCard('services', 'flexdeck')).toBeTruthy();
      expect(repoCard('services', 'loom-core')).toBeTruthy();
      expect(repoCard('libs', 'visual-kit')).toBeTruthy();
    });

    expect(pageText()).toContain('2 services / 1 libs');
    expect(pageText()).toContain('1 need review');
    expect(pageText()).toContain('typescript 1');

    inputSearch('visual');

    await vi.waitFor(() => {
      expect(repoCard('libs', 'visual-kit')).toBeTruthy();
      expect(repoCard('services', 'flexdeck')).toBeNull();
    });

    clickButtonWithText('Reset');
    clickButtonWithText('Libs');

    await vi.waitFor(() => {
      expect(repoCard('libs', 'visual-kit')).toBeTruthy();
      expect(repoCard('services', 'loom-core')).toBeNull();
    });
  });

  it('surfaces library adoption coverage and filters to unadopted libs', async () => {
    const inventory: WorkspaceInventory = {
      root: '/workspace',
      generatedAt: '2026-06-26T12:00:00Z',
      totals: { repositories: 3, services: 1, libs: 2 },
      repositories: [
        makeRepo({ name: 'flexdeck', dependsOn: ['mcp-go'] }),
        makeRepo({ name: 'mcp-go', bucket: 'libs', path: '/workspace/libs/mcp-go', usedBy: ['flexdeck'] }),
        makeRepo({ name: 'ts-resilience', bucket: 'libs', path: '/workspace/libs/ts-resilience', usedBy: [] }),
      ],
    };
    stackMocks.getRepos.mockResolvedValue(inventory);
    cleanup = mount();

    await vi.waitFor(() => {
      expect(repoCard('libs', 'mcp-go')).toBeTruthy();
      expect(repoCard('libs', 'ts-resilience')).toBeTruthy();
    });

    // Coverage tile: 1 of 2 libs adopted = 50%, 1 with no adopters.
    expect(pageText()).toContain('Lib coverage');
    expect(pageText()).toContain('50%');
    expect(pageText()).toContain('1 with no adopters');

    // The "No adopters" adoption filter shows only the orphan lib.
    clickButtonWithText('No adopters');

    await vi.waitFor(() => {
      expect(repoCard('libs', 'ts-resilience')).toBeTruthy();
      expect(repoCard('libs', 'mcp-go')).toBeNull();
      expect(repoCard('services', 'flexdeck')).toBeNull();
    });
  });

  it('shows a blocking error when the workspace inventory is unavailable', async () => {
    stackMocks.getRepos.mockRejectedValue(new Error('workspace root not configured'));
    cleanup = mount();

    await vi.waitFor(() => {
      expect(pageText()).toContain('workspace root not configured');
      expect(pageText()).toContain('Try again');
    });
  });
});
