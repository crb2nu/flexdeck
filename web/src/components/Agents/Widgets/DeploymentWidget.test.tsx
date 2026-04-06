/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deploymentWidgetMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  modelsApi: {
    list: deploymentWidgetMocks.list,
  },
}));

import DeploymentWidget from './DeploymentWidget';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DeploymentWidget', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    deploymentWidgetMocks.list.mockReset();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
  });

  it('renders static deployments without calling discovery', async () => {
    cleanup = mount(() => (
      <DeploymentWidget
        data={{
          deployments: [
            {
              name: 'alpha-deploy',
              namespace: 'flexinfer-system',
              replicas: 2,
              ready: 2,
              status: 'deployed',
              model: 'alpha',
              backend: 'vllm',
            },
          ],
        }}
      />
    ));

    await flush();

    expect(deploymentWidgetMocks.list).not.toHaveBeenCalled();
    const pageText = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain('Model Deployments');
    expect(pageText).toContain('alpha');
    expect(pageText).toContain('1/1running');
    expect(pageText).toContain('2/2');
  });

  it('discovers deployments through the models API', async () => {
    deploymentWidgetMocks.list.mockResolvedValue({
      models: [
        {
          id: 'alpha',
          name: 'alpha',
          source: 'huggingface',
          source_id: 'hf/alpha',
          source_url: 'https://huggingface.co/hf/alpha',
          type: 'llm',
          description: 'alpha',
          tags: [],
          size: 1,
          local_path: '/models/alpha',
          download_status: 'completed',
          download_progress: 100,
          deployment_status: 'deployed',
          deployment_name: 'alpha-svc',
          deployment_ns: 'ai',
          replicas: 3,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
          metadata: {
            backend: 'vllm',
            hardware: 'a100',
          },
        },
        {
          id: 'beta',
          name: 'beta',
          source: 'huggingface',
          source_id: 'hf/beta',
          source_url: 'https://huggingface.co/hf/beta',
          type: 'llm',
          description: 'beta',
          tags: [],
          size: 1,
          local_path: '/models/beta',
          download_status: 'completed',
          download_progress: 100,
          deployment_status: 'stopped',
          replicas: 0,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
    });

    cleanup = mount(() => <DeploymentWidget data={{ autoDiscover: true }} />);
    await flush();

    expect(deploymentWidgetMocks.list).toHaveBeenCalledTimes(1);
    const pageText = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain('alpha');
    expect(pageText).toContain('ai');
    expect(pageText).toContain('a100');
    expect(pageText).toContain('1/1running');
    expect(pageText).toContain('3/3');
    expect(pageText).not.toContain('beta');
  });
});
