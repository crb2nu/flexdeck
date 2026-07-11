import { Component, createSignal, onMount, onCleanup, For, Show } from 'solid-js';

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation (g + key)',
    shortcuts: [
      { keys: ['g', 'd'], action: 'Dashboard' },
      { keys: ['g', 's'], action: 'Services' },
      { keys: ['g', 't'], action: 'Stack' },
      { keys: ['g', 'l'], action: 'Logs' },
      { keys: ['g', 'm'], action: 'FlexInfer' },
      { keys: ['g', 'a'], action: 'Loom HUD' },
      { keys: ['g', 'f'], action: 'Flux' },
      { keys: ['g', 'p'], action: 'Pipeline' },
      { keys: ['g', 'w'], action: 'Website Metrics' },
      { keys: ['g', 'x'], action: 'Metrics' },
    ],
  },
  {
    title: 'Quick Actions',
    shortcuts: [
      { keys: ['⌘', 'K'], action: 'Command Palette' },
      { keys: ['?'], action: 'Show Shortcuts' },
      { keys: ['Esc'], action: 'Close / Cancel' },
    ],
  },
];

const ShortcutsOverlay: Component = () => {
  const [visible, setVisible] = createSignal(false);

  const handleShow = () => setVisible(true);
  const handleHide = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setVisible(false);
  };

  onMount(() => {
    window.addEventListener('flexdeck:show-shortcuts', handleShow);
    document.addEventListener('keydown', handleHide);
  });

  onCleanup(() => {
    window.removeEventListener('flexdeck:show-shortcuts', handleShow);
    document.removeEventListener('keydown', handleHide);
  });

  return (
    <Show when={visible()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        class="fixed inset-0 z-overlay flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setVisible(false)}
      >
        <div
          class="surface max-w-lg w-full mx-4 p-6 animate-fadeInScale"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-lg font-bold text-text-main flex items-center gap-2">
              <span class="text-white">⌨</span>
              Keyboard Shortcuts
            </h2>
            <button
              onClick={() => setVisible(false)}
              aria-label="Close shortcuts"
              class="text-text-dim hover:text-text-main transition-colors text-sm"
            >
              ✕
            </button>
          </div>

          {/* Groups */}
          <div class="space-y-5">
            <For each={SHORTCUT_GROUPS}>
              {(group) => (
                <div>
                  <h3 class="text-xs font-bold uppercase tracking-wider text-text-dim mb-2">
                    {group.title}
                  </h3>
                  <div class="space-y-1">
                    <For each={group.shortcuts}>
                      {(shortcut) => (
                        <div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/5 transition-colors">
                          <span class="text-sm text-text-muted">{shortcut.action}</span>
                          <div class="flex items-center gap-1">
                            <For each={shortcut.keys}>
                              {(key, i) => (
                                <>
                                  <kbd class="min-w-[24px] h-6 flex items-center justify-center rounded border border-white/10 bg-white/5 px-1.5 text-xs font-mono text-text-main shadow-sm">
                                    {key}
                                  </kbd>
                                  <Show when={i() < shortcut.keys.length - 1}>
                                    <span class="text-text-dim text-xs">+</span>
                                  </Show>
                                </>
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* Footer */}
          <div class="mt-5 pt-3 border-t border-white/5 text-center">
            <span class="text-[10px] text-text-dim font-mono">
              Press <kbd class="px-1 py-0.5 rounded border border-white/10 bg-white/5 text-text-main">Esc</kbd> to close
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ShortcutsOverlay;
