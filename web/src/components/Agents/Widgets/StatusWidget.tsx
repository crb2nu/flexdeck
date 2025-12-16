import { Component, For } from 'solid-js';

interface StatusWidgetProps {
  data: {
    status: 'healthy' | 'warning' | 'critical';
    message: string;
    metrics?: Record<string, string>;
  };
}

const StatusWidget: Component<StatusWidgetProps> = (props) => {
  const getColor = () => {
    switch (props.data.status) {
      case 'healthy': return 'text-status-ok border-status-ok/30 bg-status-ok/10';
      case 'warning': return 'text-status-warn border-status-warn/30 bg-status-warn/10';
      case 'critical': return 'text-status-error border-status-error/30 bg-status-error/10';
      default: return 'text-text-dim border-white/10 bg-white/5';
    }
  };

  return (
    <div class={`rounded-lg border p-4 ${getColor()}`}>
      <div class="flex items-center justify-between mb-2">
        <span class="font-bold uppercase tracking-wider text-xs">System Status</span>
        <span class="relative flex h-2 w-2">
            <span class={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current`}></span>
            <span class={`relative inline-flex rounded-full h-2 w-2 bg-current`}></span>
        </span>
      </div>
      
      <div class="text-sm font-mono mb-3">
        {props.data.message}
      </div>

      {props.data.metrics && (
        <div class="grid grid-cols-2 gap-2 border-t border-black/20 pt-3 mt-3">
            <For each={Object.entries(props.data.metrics)}>
                {([key, val]) => (
                    <div class="flex justify-between text-xs">
                        <span class="opacity-70 capitalize">{key}:</span>
                        <span class="font-bold">{val}</span>
                    </div>
                )}
            </For>
        </div>
      )}
    </div>
  );
};

export default StatusWidget;
