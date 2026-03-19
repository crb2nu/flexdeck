import { Component, For, Show } from 'solid-js';
import type { K8sService } from '../../lib/types';
import EmptyState from '../shared/EmptyState';

const ServicesTable: Component<{ services: K8sService[] }> = (props) => (
  <Show
    when={props.services.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        }
        title="No services found"
      />
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-[#0b1020]">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Type</th>
          <th class="px-4 py-3">Cluster IP</th>
          <th class="px-4 py-3">Ports</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.services}>
          {(s) => {
            const ports =
              s.spec?.ports?.map((p) => `${p.port}/${p.protocol}`).join(', ') || '-';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {s.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{s.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span
                    class={`rounded px-2 py-0.5 text-xs ${
                      s.spec?.type === 'LoadBalancer'
                        ? 'bg-neon-cyan/10 text-neon-cyan'
                        : s.spec?.type === 'NodePort'
                          ? 'bg-neon-purple/10 text-neon-purple'
                          : 'bg-white/5 text-text-muted'
                    }`}
                  >
                    {s.spec?.type}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">
                  {s.spec?.clusterIP || '-'}
                </td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">{ports}</td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

export default ServicesTable;
