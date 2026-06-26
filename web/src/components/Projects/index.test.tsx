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
    expect(document.body.textContent).toContain('plans');
    expect(document.body.textContent).toContain('1 plans');
  });

  it('sorts the project picker with open plans included in concern', async () => {
    projectsMocks.list.mockResolvedValue({
      projects: [
        {
          project: 'services/issues-only',
          open_tasks: 0,
          open_issues: 4,
          milestones_at_risk: 0,
          open_risks: 0,
          open_plans: 0,
        },
        {
          project: 'services/plans-heavy',
          open_tasks: 0,
          open_issues: 0,
          milestones_at_risk: 0,
          open_risks: 0,
          open_plans: 5,
        },
      ],
    });

    cleanup = mount(() => <Projects />);

    await vi.waitFor(() => {
      const pickerButtons = Array.from(
        document.querySelectorAll('aside[aria-label="Project picker"] button'),
      );
      expect(pickerButtons).toHaveLength(2);
      expect(pickerButtons[0].textContent).toContain('plans-heavy');
    });

    expect(projectsMocks.get).toHaveBeenCalledWith('services/plans-heavy');
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
      expect(document.body.textContent).toContain('Plans');
    });

    // Detail content from the fixture is present.
    expect(document.body.textContent).toContain('Wire /projects page to backend rollup');
    expect(document.body.textContent).toContain('Unified Project Tracking');
    expect(document.body.textContent).toContain('Unified project tracking');

    // Issues link out via web_url.
    const issueLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.getAttribute('href') === projectDetailFixture.issues[0].web_url,
    );
    expect(issueLink).toBeTruthy();

    // Plan planning-contract: kill-test status badge + born-linked issue link.
    expect(document.body.textContent).toContain('kill-test: passed');
    const planIssueLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.getAttribute('href') === projectDetailFixture.plans[0].issue_url,
    );
    expect(planIssueLink).toBeTruthy();
  });
});
