import { Component, createSignal, createEffect, onMount, onCleanup, Show, For } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { modelsApi } from '../../lib/api';
import { fetchHealth } from '../../stores/health';

interface Command {
  id: string;
  name: string;
  description: string;
  action: () => void | Promise<void>;
  keywords: string[];
}

const CommandPalette: Component = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const navigate = useNavigate();
  let inputRef: HTMLInputElement | undefined;

  // Command Registry
  const commands: Command[] = [
    {
      id: 'nav-dashboard',
      name: 'Go to Dashboard',
      description: 'Navigate to main dashboard',
      keywords: ['home', 'main', 'dashboard'],
      action: () => navigate('/'),
    },
    {
      id: 'nav-services',
      name: 'Go to Services',
      description: 'Manage Kubernetes services',
      keywords: ['k8s', 'workloads', 'pods', 'deployments'],
      action: () => navigate('/services'),
    },
    {
      id: 'nav-logs',
      name: 'Go to Logs',
      description: 'View system logs',
      keywords: ['loki', 'search', 'debug'],
      action: () => navigate('/logs'),
    },
    {
      id: 'nav-flexinfer',
      name: 'Go to FlexInfer',
      description: 'Manage FlexInfer models and controller',
      keywords: ['llm', 'ai', 'inference', 'models', 'crd'],
      action: () => navigate('/flexinfer'),
    },
    {
      id: 'nav-loom-hud',
      name: 'Go to Loom HUD',
      description: 'Monitor Loom agents, tasks, and workflows',
      keywords: ['bots', 'assistants', 'agents', 'hud', 'workflows'],
      action: () => navigate('/loom-hud'),
    },
    {
      id: 'nav-flux',
      name: 'Go to Flux',
      description: 'View GitOps Flux sync status',
      keywords: ['gitops', 'kustomization', 'helm', 'reconcile', 'deploy'],
      action: () => navigate('/flux'),
    },
    {
      id: 'nav-pipeline',
      name: 'Go to Pipeline',
      description: 'View CI/CD pipelines',
      keywords: ['ci', 'cd', 'gitlab', 'build', 'jobs'],
      action: () => navigate('/pipeline'),
    },
    {
      id: 'nav-metrics',
      name: 'Go to Metrics',
      description: 'View Prometheus metrics',
      keywords: ['prometheus', 'graphs', 'monitoring'],
      action: () => navigate('/metrics'),
    },
    {
      id: 'nav-website-metrics',
      name: 'Go to Website Metrics',
      description: 'View public website traffic, page views, and tracking health',
      keywords: ['website', 'traffic', 'analytics', 'ingress', 'page views', 'public'],
      action: () => navigate('/website-metrics'),
    },
    {
      id: 'action-discover-flexinfer',
      name: 'Discover FlexInfer Models',
      description: 'Sync FlexInfer models from the controller',
      keywords: ['sync', 'k8s', 'flexinfer', 'discover', 'refresh models', 'crd'],
      action: async () => {
        try {
          await modelsApi.discover();
        } catch { /* silent */ }
      },
    },
    {
      id: 'action-refresh-health',
      name: 'Refresh Health',
      description: 'Re-check all subsystem health status',
      keywords: ['health', 'check', 'status', 'system'],
      action: () => fetchHealth(),
    },
    {
      id: 'sys-reload',
      name: 'Reload UI',
      description: 'Refresh the application',
      keywords: ['refresh', 'f5'],
      action: () => window.location.reload(),
    },
  ];

  const filteredCommands = () => {
    const q = query().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.description.toLowerCase().includes(q) ||
      c.keywords.some(k => k.includes(q))
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setIsOpen(!isOpen());
    }

    if (!isOpen()) return;

    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filteredCommands().length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands()[selectedIndex()];
      if (cmd) {
        cmd.action();
        setIsOpen(false);
        setQuery('');
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  createEffect(() => {
    if (isOpen()) {
      setTimeout(() => inputRef?.focus(), 50);
      setSelectedIndex(0);
    }
  });

  return (
    <Show when={isOpen()}>
      <div 
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[20vh]"
        onClick={() => setIsOpen(false)}
      >
        <div 
          class="w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-[#0a1020]/95 shadow-2xl animate-fade-in-scale"
          onClick={e => e.stopPropagation()}
        >
          {/* Input Area */}
          <div class="flex items-center gap-3 border-b border-white/5 px-4 py-3">
            <span class="text-white text-lg">›</span>
            <input
              ref={inputRef}
              type="text"
              value={query()}
              onInput={e => setQuery(e.currentTarget.value)}
              placeholder="Type a command..."
              class="flex-1 bg-transparent text-lg text-text-main placeholder-text-dim/50 outline-none"
            />
            <div class="flex gap-2 text-[10px] text-text-muted">
              <span class="rounded bg-white/5 px-1.5 py-0.5">↑↓</span>
              <span>to navigate</span>
              <span class="rounded bg-white/5 px-1.5 py-0.5">⏎</span>
              <span>to select</span>
              <span class="rounded bg-white/5 px-1.5 py-0.5">ESC</span>
              <span>to close</span>
            </div>
          </div>

          {/* Results */}
          <div class="max-h-[60vh] overflow-y-auto p-2">
            <For each={filteredCommands()} fallback={
              <div class="p-8 text-center text-text-muted">No commands found.</div>
            }>
              {(cmd, i) => (
                <div
                  class={`flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 transition-colors ${
                    i() === selectedIndex() ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                  onClick={() => {
                    cmd.action();
                    setIsOpen(false);
                    setQuery('');
                  }}
                  onMouseEnter={() => setSelectedIndex(i())}
                >
                  <div class="flex items-center gap-3">
                    <div class={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 ${
                       i() === selectedIndex() ? 'bg-white/10 text-white' : 'bg-white/5 text-text-dim'
                    }`}>
                      {/* Simple Icon based on ID prefix */}
                      {cmd.id.startsWith('nav') ? '➜' : '⚡'}
                    </div>
                    <div>
                      <div class={`font-medium ${i() === selectedIndex() ? 'text-text-main' : 'text-text-dim'}`}>
                        {cmd.name}
                      </div>
                      <div class="text-xs text-text-muted">{cmd.description}</div>
                    </div>
                  </div>
                  <Show when={i() === selectedIndex()}>
                    <span class="text-xs text-white">Press Enter</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default CommandPalette;
