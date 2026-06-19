/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectsListFixture, projectDetailFixture } from './projects.fixture';

const projectsMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  createPolling: vi.fn(),
}));

// Drive the polling tasks synchronously so the page loads its first payload
// without waiting on a scheduler timer.
vi.mock('../../hooks/createPolling', () => ({
  createPolling: (
    _id: unknown,
    task: () => Promise<void> | void,
    _interval: unknown,
    enabled: boolean | (() => boolean) = true,
  ) => {
    projectsMocks.createPolling(_id, task, _interval, enabled);
    const isEnabled = typeof enabled === 'function' ? enabled() : enabled;
    if (isEnabled) {
      void task();
    }
    return { trigger: vi.fn() };
  },
}));

vi.mock('../../lib/api/projects', () => ({
  projectsApi: {
    list: projectsMocks.list,
    get: projectsMocks.get,
  },
}));

import Projects from './index';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

describe('Projects page', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    projectsMocks.list.mockReset();
    projectsMocks.get.mockReset();
    projectsMocks.createPolling.mockReset();

    projectsMocks.list.mockResolvedValue(projectsListFixture);
    projectsMocks.get.mockResolvedValue(projectDetailFixture);
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('renders the project picker from the rollup contract', async () => {
    cleanup = mount(() => <Projects />);

    await vi.waitFor(() => {
      expect(projectsMocks.list).toHaveBeenCalled();
      expect(document.body.textContent).toContain('flexdeck');
      expect(document.body.textContent).toContain('flexinfer');
    });

    // Rollup counts surface in the picker chips.
    expect(document.body.textContent).toContain('tasks');
    expect(document.body.textContent).toContain('risks');
  });

  it('loads the selected project detail lanes from the contract', async () => {
    cleanup = mount(() => <Projects />);

    await vi.waitFor(() => {
      expect(projectsMocks.get).toHaveBeenCalled();
      // Section headings render for every lane.
      expect(document.body.textContent).toContain('Tasks');
      expect(document.body.textContent).toContain('Issues');
      expect(document.body.textContent).toContain('Milestones');
      expect(document.body.textContent).toContain('Risks');
      expect(document.body.textContent).toContain('Decisions');
    });

    // Detail content from the fixture is present.
    expect(document.body.textContent).toContain('Wire /projects page to backend rollup');
    expect(document.body.textContent).toContain('Unified Project Tracking');

    // Issues link out via web_url.
    const issueLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.getAttribute('href') === projectDetailFixture.issues[0].web_url,
    );
    expect(issueLink).toBeTruthy();
  });
});
