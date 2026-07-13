import { Component, createSignal, createEffect, createMemo, createUniqueId, onMount, onCleanup, Show, For } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { modelsApi } from '../../lib/api';
import { fetchHealth, healthStore } from '../../stores/health';
import { trapFocus } from '../../lib/focusTrap';
import { buildNavCommands, loadRecents, rankCommands, recordRecent, type PaletteCommand } from './commands';
import { fetchEntityCommands } from './entities';

interface RunnableCommand extends PaletteCommand {
  action: () => void | Promise<void>;
}

const CommandPalette: Component = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [recents, setRecents] = createSignal<string[]>(loadRecents());
  const navigate = useNavigate();
  let inputRef: HTMLInputElement | undefined;
  let dialogRef: HTMLDivElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // One-shot actions that aren't navigation. Nav commands come from the same
  // feature-gated registry as the top nav, so the palette tracks flags.
  const actionCommands: RunnableCommand[] = [
    {
      id: 'action:discover-flexinfer',
      name: 'Discover FlexInfer Models',
      description: 'Sync FlexInfer models from the controller',
      keywords: ['sync', 'k8s', 'flexinfer', 'discover', 'refresh models', 'crd'],
      section: 'Actions',
      action: async () => {
        try {
          await modelsApi.discover();
        } catch { /* silent */ }
      },
    },
    {
      id: 'action:refresh-health',
      name: 'Refresh Health',
      description: 'Re-check all subsystem health status',
      keywords: ['health', 'check', 'status', 'system'],
      section: 'Actions',
      action: () => fetchHealth(),
    },
    {
      id: 'action:reload',
      name: 'Reload UI',
      description: 'Refresh the application',
      keywords: ['refresh', 'f5'],
      section: 'Actions',
      action: () => window.location.reload(),
    },
  ];

  // Live entities (repos, workloads, models) load lazily on open — they only
  // join the results once the user types, so the empty-query list stays a
  // navigable command menu instead of a resource dump.
  const [entities, setEntities] = createSignal<PaletteCommand[]>([]);
  createEffect(() => {
    if (!isOpen()) return;
    void fetchEntityCommands().then(setEntities);
  });

  const commands = createMemo<RunnableCommand[]>(() => {
    const withNav = (cmd: PaletteCommand): RunnableCommand => ({
      ...cmd,
      action: () => navigate(cmd.href!),
    });
    const nav = buildNavCommands(healthStore.features || {}).map(withNav);
    const entityCommands = query().trim() ? entities().map(withNav) : [];
    return [...nav, ...actionCommands, ...entityCommands];
  });

  const filteredCommands = createMemo(() => rankCommands(commands(), query(), recents()) as RunnableCommand[]);

  const runCommand = (cmd: RunnableCommand) => {
    setRecents(recordRecent(cmd.id));
    void cmd.action();
    setIsOpen(false);
    setQuery('');
  };

  const scrollSelectedIntoView = (index: number) => {
    listRef?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setIsOpen(!isOpen());
    }

    if (!isOpen()) return;

    trapFocus(dialogRef, e);

    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => {
        const next = Math.min(i + 1, filteredCommands().length - 1);
        scrollSelectedIntoView(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => {
        const next = Math.max(i - 1, 0);
        scrollSelectedIntoView(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands()[selectedIndex()];
      if (cmd) runCommand(cmd);
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  let previouslyFocused: HTMLElement | null = null;
  createEffect(() => {
    if (isOpen()) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTimeout(() => inputRef?.focus(), 50);
      setSelectedIndex(0);
    } else {
      previouslyFocused?.focus();
      previouslyFocused = null;
    }
  });

  // Reset the highlight when the result list changes under the cursor.
  createEffect(() => {
    query();
    setSelectedIndex(0);
  });

  const listboxId = `command-palette-results-${createUniqueId()}`;

  const sectionIcon = (cmd: PaletteCommand): string => {
    switch (cmd.section) {
      case 'Actions':
        return '⚡';
      case 'Loom':
        return '❋';
      case 'FlexInfer':
        return '▣';
      case 'Repos':
        return '⌥';
      case 'Workloads':
        return '◈';
      case 'Models':
        return '◉';
      default:
        return '➜';
    }
  };

  return (
    <Show when={isOpen()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        class="fixed inset-0 z-modal flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[20vh]"
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
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={filteredCommands().length > 0 ? `${listboxId}-opt-${selectedIndex()}` : undefined}
              value={query()}
              onInput={e => setQuery(e.currentTarget.value)}
              placeholder="Search pages, surfaces, actions..."
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
          <div id={listboxId} ref={listRef} role="listbox" aria-label="Commands" class="max-h-[60vh] overflow-y-auto p-2">
            <For each={filteredCommands()} fallback={
              <div class="p-8 text-center text-text-muted">No commands found.</div>
            }>
              {(cmd, i) => (
                <div
                  id={`${listboxId}-opt-${i()}`}
                  role="option"
                  aria-selected={i() === selectedIndex()}
                  data-index={i()}
                  class={`flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 transition-colors ${
                    i() === selectedIndex() ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                  onClick={() => runCommand(cmd)}
                  onMouseEnter={() => setSelectedIndex(i())}
                >
                  <div class="flex min-w-0 items-center gap-3">
                    <div class={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 ${
                       i() === selectedIndex() ? 'bg-white/10 text-white' : 'bg-white/5 text-text-dim'
                    }`}>
                      {sectionIcon(cmd)}
                    </div>
                    <div class="min-w-0">
                      <div class={`truncate font-medium ${i() === selectedIndex() ? 'text-text-main' : 'text-text-dim'}`}>
                        {cmd.name}
                      </div>
                      <div class="truncate text-xs text-text-muted">{cmd.description}</div>
                    </div>
                  </div>
                  <div class="flex flex-shrink-0 items-center gap-2">
                    <Show when={!query().trim() && recents().includes(cmd.id)}>
                      <span class="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-text-dim">recent</span>
                    </Show>
                    <Show when={i() === selectedIndex()}>
                      <span class="text-xs text-white">Press Enter</span>
                    </Show>
                  </div>
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
