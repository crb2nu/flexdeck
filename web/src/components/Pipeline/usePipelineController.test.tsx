/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoInfo } from '../../lib/api';
import type { Pipeline } from './CIPipelineViz';

const pipelineControllerMocks = vi.hoisted(() => ({
  batchPipelines: vi.fn<(ids: number[]) => Promise<{ pipelines: Record<string, unknown> }>>(),
  cancelPipeline: vi.fn(async () => ({})),
  createPolling: vi.fn(),
  getJobTrace: vi.fn(async () => ({ jobId: '1', trace: 'trace output' })),
  getPipeline: vi.fn<(id: number) => Promise<unknown>>(),
  getTrends: vi.fn<() => Promise<unknown[]>>(async () => []),
  listRepos: vi.fn<() => Promise<RepoInfo[]>>(async () => []),
  repoConfig: vi.fn(async () => ({ id: 0, hasConfig: false, configContent: '' })),
  retryPipeline: vi.fn(async () => ({})),
  triggerPipeline: vi.fn(async () => ({})),
}));

vi.mock('../../hooks/createPolling', () => ({
  createPolling: pipelineControllerMocks.createPolling,
}));

vi.mock('../../lib/api', () => ({
  ciApi: {
    batchPipelines: pipelineControllerMocks.batchPipelines,
    cancelPipeline: pipelineControllerMocks.cancelPipeline,
    getJobTrace: pipelineControllerMocks.getJobTrace,
    getPipeline: pipelineControllerMocks.getPipeline,
    getTrends: pipelineControllerMocks.getTrends,
    listRepos: pipelineControllerMocks.listRepos,
    repoConfig: pipelineControllerMocks.repoConfig,
    retryPipeline: pipelineControllerMocks.retryPipeline,
    triggerPipeline: pipelineControllerMocks.triggerPipeline,
  },
}));

import { usePipelineController } from './usePipelineController';

function buildRepo(id: number, name: string, overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    id,
    name,
    path: `services/${name}`,
    type: 'gitlab',
    hasConfig: true,
    ...overrides,
  };
}

function buildPipeline(id: string, status: Pipeline['status'] = 'running'): Pipeline {
  return {
    id,
    ref: 'main',
    status,
    rawStatus: status,
    createdAt: '2026-04-03T14:00:00Z',
    stages: [
      {
        name: 'build',
        jobs: [
          {
            id: 'job-build',
            name: 'build',
            stage: 'build',
            status: status === 'running' ? 'running' : 'success',
            rawStatus: status === 'running' ? 'running' : 'success',
          },
        ],
      },
    ],
  };
}

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

describe('usePipelineController', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    pipelineControllerMocks.batchPipelines.mockReset();
    pipelineControllerMocks.cancelPipeline.mockClear();
    pipelineControllerMocks.createPolling.mockClear();
    pipelineControllerMocks.getJobTrace.mockClear();
    pipelineControllerMocks.getPipeline.mockReset();
    pipelineControllerMocks.getTrends.mockReset();
    pipelineControllerMocks.listRepos.mockReset();
    pipelineControllerMocks.repoConfig.mockReset();
    pipelineControllerMocks.retryPipeline.mockClear();
    pipelineControllerMocks.triggerPipeline.mockClear();

    pipelineControllerMocks.createPolling.mockImplementation(() => undefined);
    pipelineControllerMocks.getTrends.mockResolvedValue([]);
    pipelineControllerMocks.listRepos.mockResolvedValue([]);
    pipelineControllerMocks.batchPipelines.mockResolvedValue({ pipelines: {} });
    pipelineControllerMocks.getPipeline.mockResolvedValue({});
    pipelineControllerMocks.repoConfig.mockResolvedValue({ id: 0, hasConfig: false, configContent: '' });
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('loads pipeline cache through the batch endpoint on mount', async () => {
    const repos = [buildRepo(11, 'flexdeck'), buildRepo(12, 'loom-core')];
    pipelineControllerMocks.listRepos.mockResolvedValue(repos);
    pipelineControllerMocks.batchPipelines.mockResolvedValue({
      pipelines: {
        '11': buildPipeline('101', 'running'),
        '12': buildPipeline('102', 'success'),
      },
    });

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.loading()).toBe(false);
      expect(controller.pipelinesCache().size).toBe(2);
    });

    expect(pipelineControllerMocks.batchPipelines).toHaveBeenCalledWith([11, 12]);
    expect(controller.pipelinesCache().get(11)?.id).toBe('101');
    expect(controller.pipelinesCache().get(12)?.status).toBe('success');
    expect(controller.lastUpdate()).toBeInstanceOf(Date);
  });

  it('falls back to individual pipeline fetches when the batch endpoint fails', async () => {
    const repos = [buildRepo(21, 'flexdeck'), buildRepo(22, 'loom-core')];
    pipelineControllerMocks.listRepos.mockResolvedValue(repos);
    pipelineControllerMocks.batchPipelines.mockRejectedValue(new Error('batch unavailable'));
    pipelineControllerMocks.getPipeline
      .mockResolvedValueOnce(buildPipeline('201', 'running'))
      .mockResolvedValueOnce(buildPipeline('202', 'failed'));

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.pipelinesCache().size).toBe(2);
    });

    expect(pipelineControllerMocks.batchPipelines).toHaveBeenCalledWith([21, 22]);
    expect(pipelineControllerMocks.getPipeline).toHaveBeenNthCalledWith(1, 21);
    expect(pipelineControllerMocks.getPipeline).toHaveBeenNthCalledWith(2, 22);
    expect(controller.pipelinesCache().get(22)?.status).toBe('failed');
  });

  it('guards retry and cancel actions for static pipeline previews', async () => {
    const repo = buildRepo(31, 'flexdeck', {
      configContent: 'stages:\n  - build\nbuild:\n  stage: build\n  script: echo ok\n',
    });

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await controller.selectRepo(repo);

    expect(controller.pipelineData()?.id).toBe('pipeline-flexdeck');
    expect(controller.pipelineDataState()).toBe('fallback');

    await controller.handleRetryPipeline();
    expect(controller.actionNotice()).toEqual({
      type: 'info',
      message: 'Retry is unavailable for static pipeline previews.',
    });
    expect(pipelineControllerMocks.retryPipeline).not.toHaveBeenCalled();

    await controller.handleCancelPipeline();
    expect(controller.actionNotice()).toEqual({
      type: 'info',
      message: 'Cancel is unavailable for static pipeline previews.',
    });
    expect(pipelineControllerMocks.cancelPipeline).not.toHaveBeenCalled();
  });

  it('hydrates a static preview by lazily fetching repo config content', async () => {
    const repo = buildRepo(35, 'flexdeck', { configContent: undefined });
    pipelineControllerMocks.listRepos.mockResolvedValue([repo]);
    pipelineControllerMocks.repoConfig.mockResolvedValue({
      id: 35,
      hasConfig: true,
      configContent: 'stages:\n  - build\nbuild:\n  stage: build\n  script: echo hydrated\n',
    });

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.loading()).toBe(false);
      expect(controller.repos()).toHaveLength(1);
    });

    await controller.selectRepo(controller.repos()[0]!);

    await vi.waitFor(() => {
      expect(pipelineControllerMocks.repoConfig).toHaveBeenCalledWith(35);
      expect(controller.pipelineData()?.id).toBe('pipeline-flexdeck');
    });

    expect(controller.selectedRepo()?.configContent).toContain('echo hydrated');
    expect(controller.pipelineDataState()).toBe('fallback');
  });

  it('retries live pipelines and schedules a refresh fetch', async () => {
    const repo = buildRepo(41, 'flexdeck');
    pipelineControllerMocks.getPipeline.mockResolvedValue(buildPipeline('401', 'running'));

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await controller.selectRepo(repo);
    expect(controller.pipelineData()?.id).toBe('401');

    pipelineControllerMocks.getPipeline.mockClear();
    await controller.handleRetryPipeline();

    expect(pipelineControllerMocks.retryPipeline).toHaveBeenCalledWith(41, '401');
    expect(controller.actionNotice()).toEqual({
      type: 'success',
      message: 'Pipeline retry requested.',
    });
    expect(controller.pipelineActionLoading()).toBe(false);
    expect(pipelineControllerMocks.getPipeline).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(pipelineControllerMocks.getPipeline).toHaveBeenCalledWith(41);
    });
  });

  it('shows a static trace message instead of requesting live logs for preview jobs', async () => {
    const repo = buildRepo(45, 'flexdeck', {
      configContent: 'stages:\n  - build\nbuild:\n  stage: build\n  script: echo ok\n',
    });

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await controller.selectRepo(repo);
    controller.setSelectedJob({
      id: 'job-build',
      name: 'build',
      stage: 'build',
      status: 'pending',
    });

    await vi.waitFor(() => {
      expect(controller.jobTrace()).toBe('Live logs are unavailable for static pipeline previews.');
    });

    expect(controller.traceLoading()).toBe(false);
    expect(pipelineControllerMocks.getJobTrace).not.toHaveBeenCalled();
  });

  it('fetches live job traces when a selected pipeline job has a numeric ID', async () => {
    const repo = buildRepo(47, 'flexdeck');
    pipelineControllerMocks.getPipeline.mockResolvedValue(buildPipeline('4701', 'running'));
    pipelineControllerMocks.getJobTrace.mockResolvedValueOnce({
      jobId: '701',
      trace: 'streaming trace output',
    });

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await controller.selectRepo(repo);
    controller.setSelectedJob({
      id: 'job-701',
      name: 'build',
      stage: 'build',
      status: 'running',
    });

    await vi.waitFor(() => {
      expect(pipelineControllerMocks.getJobTrace).toHaveBeenCalledWith(47, '701');
      expect(controller.jobTrace()).toBe('streaming trace output');
    });

    expect(controller.traceLoading()).toBe(false);
  });

  it('surfaces trigger failures and clears timed notices after the timeout', async () => {
    const repo = buildRepo(51, 'flexdeck');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pipelineControllerMocks.triggerPipeline.mockRejectedValueOnce(new Error('boom'));

    let controller!: ReturnType<typeof usePipelineController>;
    cleanup = mount(() => {
      controller = usePipelineController();
      return <div />;
    });

    await controller.selectRepo(repo);
    controller.setTriggerRef('release/2026-04-03');
    await controller.handleTriggerPipeline();

    expect(pipelineControllerMocks.triggerPipeline).toHaveBeenCalledWith(51, 'release/2026-04-03');
    expect(controller.actionNotice()).toEqual({
      type: 'error',
      message: 'Pipeline trigger failed.',
    });

    await vi.advanceTimersByTimeAsync(4500);
    await vi.waitFor(() => {
      expect(controller.actionNotice()).toBeNull();
    });

    consoleError.mockRestore();
  });
});
