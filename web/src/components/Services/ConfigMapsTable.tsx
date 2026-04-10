import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import EmptyState from '../shared/EmptyState';

export interface ConfigMapsTableProps {
  configmaps: any[];
  expanded: Set<string>;
  cmData: Record<string, any>;
  onToggle: (ns: string, name: string) => void;
}

const ConfigMapsTable: Component<ConfigMapsTableProps> = (props) => (
  <Show
    when={props.configmaps.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
        title="No configmaps found"
      />
    }
  >
    <div class="divide-y divide-white/5">
      <For each={props.configmaps}>
        {(cm) => {
          const key = `${cm.metadata?.namespace}/${cm.metadata?.name}`;
          const isExpanded = props.expanded.has(key);
          const dataKeys = Object.keys(cm.data || {});

          return (
            <div>
              <div
                class="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer group"
                onClick={() => props.onToggle(cm.metadata?.namespace || 'default', cm.metadata?.name || '')}
              >
                <span class={`text-[10px] text-text-dim transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  &#9656;
                </span>
                <span class="font-medium text-text-main text-sm group-hover:text-white transition-colors">
                  {cm.metadata?.name}
                </span>
                <span class="text-text-dim text-xs">{cm.metadata?.namespace}</span>
                <span class="text-text-dim/50 text-xs ml-auto">{dataKeys.length} keys</span>
                <span class="text-text-muted text-xs">
                  {cm.metadata?.creationTimestamp ? formatRelativeTime(cm.metadata.creationTimestamp) : '-'}
                </span>
              </div>
              <Show when={isExpanded}>
                <div class="px-4 pb-3 ml-8">
                  <Show when={props.cmData[key]} fallback={
                    <div class="text-xs text-text-dim animate-pulse py-2">Loading...</div>
                  }>
                    <div class="rounded-md bg-white/[0.02] overflow-hidden">
                      <For each={Object.entries(props.cmData[key]?.data || {})}>
                        {([k, v]) => (
                          <div class="border-b border-white/5 last:border-0">
                            <div class="px-3 py-1.5 text-xs font-mono text-text-dim">{k}</div>
                            <pre class="px-3 pb-2 text-[11px] text-text-muted font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
                              {String(v)}
                            </pre>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  </Show>
);

export default ConfigMapsTable;
