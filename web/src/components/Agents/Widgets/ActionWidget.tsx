import { Component, createSignal, Show, For } from 'solid-js';
import { k8s } from '../../../lib/api';

interface ActionWidgetProps {
  data: {
    title?: string;
    actions: ActionItem[];
  };
}

interface ActionItem {
  label: string;                // Button label
  description?: string;         // What this action does
  type: 'restart' | 'scale';    // Action type
  namespace: string;
  deployment: string;
  replicas?: number;            // For scale actions
  variant?: 'default' | 'danger';
}

const ActionWidget: Component<ActionWidgetProps> = (props) => {
  const [executing, setExecuting] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<Record<string, { ok: boolean; message: string }>>({});

  const handleAction = async (action: ActionItem) => {
    const key = `${action.type}-${action.namespace}-${action.deployment}`;
    setExecuting(key);
    
    try {
      if (action.type === 'restart') {
        await k8s.restartDeployment(action.namespace, action.deployment);
        setResults(prev => ({ ...prev, [key]: { ok: true, message: `Restarted ${action.deployment}` } }));
      } else if (action.type === 'scale') {
        await k8s.scaleDeployment(action.namespace, action.deployment, action.replicas ?? 1);
        setResults(prev => ({ 
          ...prev, 
          [key]: { ok: true, message: `Scaled ${action.deployment} to ${action.replicas} replicas` } 
        }));
      }
    } catch (err) {
      setResults(prev => ({ 
        ...prev, 
        [key]: { ok: false, message: err instanceof Error ? err.message : 'Action failed' } 
      }));
    } finally {
      setExecuting(null);
    }
  };

  const getActionKey = (action: ActionItem) => 
    `${action.type}-${action.namespace}-${action.deployment}`;

  const buttonStyle = (action: ActionItem) => {
    const key = getActionKey(action);
    const result = results()[key];
    
    if (result?.ok) return 'border-status-ok/30 text-status-ok bg-status-ok/10';
    if (result && !result.ok) return 'border-red-500/30 text-red-400 bg-red-500/10';
    if (executing() === key) return 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10';
    
    return action.variant === 'danger'
      ? 'border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10'
      : 'border-white/15 text-white bg-white/5 hover:bg-white/10';
  };

  return (
    <div class="rounded-lg border border-white/10 bg-black/20 p-4">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xs text-text-muted">⚡</span>
        <span class="text-xs font-bold uppercase tracking-wider text-text-dim">
          {props.data.title || 'Quick Actions'}
        </span>
      </div>

      <div class="flex flex-wrap gap-2">
        <For each={props.data.actions}>
          {(action) => {
            const key = getActionKey(action);
            const result = () => results()[key];
          
            return (
              <div class="flex flex-col gap-1">
                <button
                  onClick={() => handleAction(action)}
                  disabled={executing() !== null}
                  class={`rounded-lg border px-3 py-2 text-xs font-mono transition-all disabled:opacity-50 ${buttonStyle(action)}`}
                >
                  <Show when={executing() === key} fallback={action.label}>
                    ⟳ Executing...
                  </Show>
                </button>
                <Show when={action.description}>
                  <span class="text-[9px] text-text-dim text-center">{action.description}</span>
                </Show>
                <Show when={result()}>
                  <span class={`text-[9px] text-center ${result()!.ok ? 'text-status-ok' : 'text-red-400'}`}>
                    {result()!.ok ? '✓' : '✗'} {result()!.message}
                  </span>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default ActionWidget;
