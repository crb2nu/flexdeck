import { Component, For, Show } from 'solid-js';
import type { K8sIngress } from '../../lib/types';
import EmptyState from '../shared/EmptyState';

const IngressesTable: Component<{ ingresses: K8sIngress[] }> = (props) => (
  <Show
    when={props.ingresses.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        }
        title="No ingresses found"
      />
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Hosts</th>
          <th class="px-4 py-3">Class</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.ingresses}>
          {(i) => {
            const hosts = i.spec?.rules?.map((r) => r.host).filter(Boolean) || [];

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {i.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{i.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <For each={hosts}>
                    {(host) => (
                      <a
                        href={`https://${host}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mr-2 text-neon-cyan hover:underline"
                      >
                        {host}
                      </a>
                    )}
                  </For>
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {i.spec?.ingressClassName || '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

export default IngressesTable;
