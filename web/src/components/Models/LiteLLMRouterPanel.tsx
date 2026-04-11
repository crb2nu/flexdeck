import { Component, createSignal, For, Show } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { litellm } from '../../lib/api';
import type { LiteLLMRouterResponse, LiteLLMModelEntry } from '../../lib/types';

const LiteLLMRouterPanel: Component = () => {
  const [data, setData] = createSignal<LiteLLMRouterResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');

  const fetchRouter = async () => {
    try {
      const result = await litellm.router();
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch router info');
    } finally {
      setLoading(false);
    }
  };

  createPolling('models-litellm-router', fetchRouter, 30000);

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="surface p-3 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && !data()}>
        <div class="surface flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading router info...</div>
        </div>
      </Show>

      <Show when={data()}>
        {/* Health status */}
        <div class="surface px-4 py-3 flex items-center gap-3">
          <div class={`w-2 h-2 rounded-full ${data()!.healthy ? 'bg-status-ok' : 'bg-status-error'}`} />
          <span class="text-sm font-medium text-text-main">LiteLLM Proxy</span>
          <span class="text-xs text-text-dim">
            {data()!.healthy ? 'Healthy' : 'Unhealthy'}
          </span>
          <span class="text-xs text-text-dim ml-auto">
            {(data()!.modelInfo || []).length} models configured
          </span>
        </div>

        {/* Model routing table */}
        <div class="surface overflow-hidden">
          <div class="px-4 py-2 border-b border-white/5">
            <span class="text-xs font-mono text-text-main uppercase tracking-wider">Model Routing Table</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-white/5 text-text-dim">
                  <th class="text-left px-4 py-2 font-medium">Model Name</th>
                  <th class="text-left px-4 py-2 font-medium">Backend</th>
                  <th class="text-left px-4 py-2 font-medium">Mode</th>
                  <th class="text-right px-4 py-2 font-medium">Max Tokens</th>
                  <th class="text-right px-4 py-2 font-medium">RPM</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <For each={data()!.modelInfo || []}>
                  {(model: LiteLLMModelEntry) => (
                    <tr class="hover:bg-white/5 transition-colors">
                      <td class="px-4 py-2 font-mono text-text-main">{model.model_name}</td>
                      <td class="px-4 py-2 text-text-dim font-mono">
                        {model.litellm_params?.api_base || model.litellm_params?.model || '\u2014'}
                      </td>
                      <td class="px-4 py-2 text-text-dim">
                        {model.model_info?.mode || '\u2014'}
                      </td>
                      <td class="px-4 py-2 text-right text-text-dim">
                        {model.model_info?.max_tokens?.toLocaleString() || '\u2014'}
                      </td>
                      <td class="px-4 py-2 text-right text-text-dim">
                        {model.litellm_params?.rpm || '\u2014'}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default LiteLLMRouterPanel;
