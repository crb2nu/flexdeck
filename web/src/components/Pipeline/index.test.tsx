/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pipelineMocks = vi.hoisted(() => {
  const selectedRepo = {
    id: 42,
    name: 'flexdeck',
    path: 'services/flexdeck',
    type: 'gitlab',
    hasConfig: true,
  };

  const pipelineData = {
    id: 'pipeline-demo-main',
    ref: 'main',
    status: 'pending',
    rawStatus: 'pending',
    createdAt: '2026-04-02T20:00:00Z',
    stages: [
      {
        name: 'build',
        jobs: [
          {
            id: 'job-build',
            name: 'build',
            stage: 'build',
            status: 'pending',
            rawStatus: 'pending',
          },
        ],
      },
    ],
  };

  return {
    actionNotice: null as { type: 'info' | 'success' | 'error'; message: string } | null,
    autoRefresh: true,
    dataStateMeta: {
      state: 'fallback',
      label: 'FALLBACK · static preview',
      detail: 'static preview',
      badgeClass: 'bg-status-warn/15 text-status-warn',
    },
    fetchPipelineStatus: vi.fn(),
    formatTimeAgo: vi.fn(() => 'just now'),
    handleCancelPipeline: vi.fn(),
    handleRetryPipeline: vi.fn(),
    handleTriggerPipeline: vi.fn(),
    isPipelineActive: false,
    jobTrace: '',
    lastUpdate: new Date('2026-04-02T20:01:00Z'),
    loading: false,
    overviewLoading: false,
    pipelineActionLoading: false,
    pipelineData,
    pipelineSort: { field: 'activity', direction: 'desc' as const },
    pipelinesCache: new Map<number, typeof pipelineData>(),
    pushActionNotice: vi.fn(),
    repos: [selectedRepo],
    scheduleRefresh: vi.fn(),
    selectedJob: null as null | { id: string; name: string; stage: string; status: string },
    selectedRepo,
    selectRepo: vi.fn(),
    setAutoRefresh: vi.fn(),
    setPipelineSort: vi.fn(),
    setSelectedJob: vi.fn(),
    setTriggerRef: vi.fn(),
    traceLoading: false,
    triggerRef: 'main',
  };
});

vi.mock('./usePipelineController', () => ({
  usePipelineController: () => ({
    actionNotice: () => pipelineMocks.actionNotice,
    autoRefresh: () => pipelineMocks.autoRefresh,
    dataStateMeta: () => pipelineMocks.dataStateMeta,
    fetchPipelineStatus: pipelineMocks.fetchPipelineStatus,
    formatTimeAgo: pipelineMocks.formatTimeAgo,
    handleCancelPipeline: pipelineMocks.handleCancelPipeline,
    handleRetryPipeline: pipelineMocks.handleRetryPipeline,
    handleTriggerPipeline: pipelineMocks.handleTriggerPipeline,
    isPipelineActive: () => pipelineMocks.isPipelineActive,
    jobTrace: () => pipelineMocks.jobTrace,
    lastUpdate: () => pipelineMocks.lastUpdate,
    loading: () => pipelineMocks.loading,
    overviewLoading: () => pipelineMocks.overviewLoading,
    pipelineActionLoading: () => pipelineMocks.pipelineActionLoading,
    pipelineData: () => pipelineMocks.pipelineData,
    pipelineDataState: () => pipelineMocks.dataStateMeta.state,
    pipelineSort: () => pipelineMocks.pipelineSort,
    pipelinesCache: () => pipelineMocks.pipelinesCache,
    pushActionNotice: pipelineMocks.pushActionNotice,
    repos: () => pipelineMocks.repos,
    scheduleRefresh: pipelineMocks.scheduleRefresh,
    selectedJob: () => pipelineMocks.selectedJob,
    selectedRepo: () => pipelineMocks.selectedRepo,
    selectRepo: pipelineMocks.selectRepo,
    setAutoRefresh: pipelineMocks.setAutoRefresh,
    setPipelineSort: pipelineMocks.setPipelineSort,
    setSelectedJob: pipelineMocks.setSelectedJob,
    setTriggerRef: pipelineMocks.setTriggerRef,
    traceLoading: () => pipelineMocks.traceLoading,
    triggerRef: () => pipelineMocks.triggerRef,
  }),
}));

vi.mock('./CIPipelineViz', () => ({
  default: (props: { onRefresh?: () => void }) => (
    <div data-testid="pipeline-viz">
      pipeline viz
      <button type="button" onClick={props.onRefresh}>refresh viz</button>
    </div>
  ),
}));

vi.mock('./PipelineListView', () => ({
  default: () => <div data-testid="pipeline-list">pipeline list</div>,
}));

vi.mock('../shared', () => ({
  LoadingState: () => <div data-testid="loading-state">loading</div>,
  TabBar: (props: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: any) => void }) => (
    <div data-testid="tab-bar">
      {props.tabs.map((tab) => (
        <button type="button" data-active={String(props.active === tab.id)} onClick={() => props.onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

import Pipeline from './index';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function clickByText(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  button!.click();
}

function clickButtonContaining(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  button!.click();
}

describe('Pipeline detail surface', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    pipelineMocks.actionNotice = null;
    pipelineMocks.autoRefresh = true;
    pipelineMocks.dataStateMeta = {
      state: 'fallback',
      label: 'FALLBACK · static preview',
      detail: 'static preview',
      badgeClass: 'bg-status-warn/15 text-status-warn',
    };
    pipelineMocks.fetchPipelineStatus.mockClear();
    pipelineMocks.formatTimeAgo.mockClear();
    pipelineMocks.handleCancelPipeline.mockClear();
    pipelineMocks.handleRetryPipeline.mockClear();
    pipelineMocks.handleTriggerPipeline.mockClear();
    pipelineMocks.pushActionNotice.mockClear();
    pipelineMocks.selectRepo.mockClear();
    pipelineMocks.setAutoRefresh.mockClear();
    pipelineMocks.setPipelineSort.mockClear();
    pipelineMocks.setSelectedJob.mockClear();
    pipelineMocks.setTriggerRef.mockClear();
    pipelineMocks.scheduleRefresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('shows the shared fallback badge in pipeline detail mode', async () => {
    cleanup = mount(() => <Pipeline />);

    clickButtonContaining('flexdeck');

    await vi.waitFor(() => {
      expect(pageText()).toContain('FALLBACK · static preview');
    });

    const text = pageText();
    expect(text).toContain('flexdeck');
    expect(text).toContain('FALLBACK · static preview');
    expect(text).toContain('Updated: just now');
  });

  it('renders error action notices with their message', async () => {
    pipelineMocks.actionNotice = {
      type: 'error',
      message: 'Pipeline retry failed.',
    };

    cleanup = mount(() => <Pipeline />);

    clickButtonContaining('flexdeck');

    await vi.waitFor(() => {
      expect(pageText()).toContain('Pipeline retry failed.');
    });

    const notice = Array.from(document.querySelectorAll('div')).find((element) =>
      element.textContent?.includes('Pipeline retry failed.')
      && typeof element.className === 'string'
      && element.className.includes('border-red-400/30'),
    );
    expect(notice).toBeTruthy();
  });

  it('refreshes the selected repo and pushes an info notice when refresh is clicked', async () => {
    cleanup = mount(() => <Pipeline />);

    clickButtonContaining('flexdeck');

    await vi.waitFor(() => {
      expect(pageText()).toContain('↻ Refresh');
    });

    clickByText('↻ Refresh');

    expect(pipelineMocks.fetchPipelineStatus).toHaveBeenCalledWith(42);
    expect(pipelineMocks.pushActionNotice).toHaveBeenCalledWith('info', 'Refreshing pipeline status...');
  });
});
