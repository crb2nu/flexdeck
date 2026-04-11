import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import EmptyState from '../shared/EmptyState';

export interface SecretsTableProps {
  secrets: any[];
  expanded: Set<string>;
  secretData: Record<string, any>;
  revealedKeys: Set<string>;
  onToggle: (ns: string, name: string) => void;
  onRevealKey: (key: string) => void;
}

const SecretsTable: Component<SecretsTableProps> = (props) => (
  <Show
    when={props.secrets.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        }
        title="No secrets found"
      />
    }
  >
    <div class="divide-y divide-white/5">
      <For each={props.secrets}>
        {(secret) => {
          const key = `${secret.metadata?.namespace}/${secret.metadata?.name}`;
          const isExpanded = props.expanded.has(key);
          const secretType = secret.type || 'Opaque';
          const dataKeys = Object.keys(secret.data || {});

          return (
            <div>
              <div
                class="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer group"
                onClick={() => props.onToggle(secret.metadata?.namespace || 'default', secret.metadata?.name || '')}
              >
                <span class={`text-[10px] text-text-dim transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  &#9656;
                </span>
                <span class="font-medium text-text-main text-sm group-hover:text-white transition-colors">
                  {secret.metadata?.name}
                </span>
                <span class="text-text-dim text-xs">{secret.metadata?.namespace}</span>
                <span class="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-text-dim">
                  {secretType}
                </span>
                <span class="text-text-dim/50 text-xs ml-auto">{dataKeys.length} keys</span>
                <span class="text-text-muted text-xs">
                  {secret.metadata?.creationTimestamp ? formatRelativeTime(secret.metadata.creationTimestamp) : '-'}
                </span>
              </div>
              <Show when={isExpanded}>
                <div class="px-4 pb-3 ml-8">
                  <Show when={props.secretData[key]} fallback={
                    <div class="text-xs text-text-dim animate-pulse py-2">Loading...</div>
                  }>
                    <div class="rounded-md bg-white/[0.02] overflow-hidden">
                      <For each={Object.entries(props.secretData[key]?.data || {})}>
                        {([k, v]) => {
                          const revealKey = `${key}/${k}`;
                          const isRevealed = props.revealedKeys.has(revealKey);
                          return (
                            <div class="border-b border-white/5 last:border-0 px-3 py-1.5">
                              <div class="flex items-center gap-2">
                                <span class="text-xs font-mono text-text-dim">{k}</span>
                                <button
                                  class="text-[10px] text-text-dim hover:text-text-dim transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    props.onRevealKey(revealKey);
                                  }}
                                >
                                  {isRevealed ? 'Hide' : 'Reveal'}
                                </button>
                              </div>
                              <div class="text-[11px] text-text-muted font-mono mt-0.5">
                                {isRevealed ? String(v) : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                              </div>
                            </div>
                          );
                        }}
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

export default SecretsTable;
