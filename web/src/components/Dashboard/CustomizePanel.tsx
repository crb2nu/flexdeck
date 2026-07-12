import { Component, For, Show, createSignal, onCleanup } from 'solid-js';
import { DEFAULT_LAYOUT, sectionLabel, type DashboardSectionId, type LayoutEntry } from './layout';

interface CustomizePanelProps {
  layout: LayoutEntry[];
  onToggle: (id: DashboardSectionId) => void;
  onMove: (id: DashboardSectionId, delta: -1 | 1) => void;
  onReset: () => void;
}

/**
 * "Customize" dropdown for the dashboard home: show/hide and reorder the
 * page sections. Changes apply immediately and persist per browser.
 */
const CustomizePanel: Component<CustomizePanelProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const onDocumentClick = (event: MouseEvent) => {
    if (open() && rootRef && !rootRef.contains(event.target as Node)) setOpen(false);
  };
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (open() && event.key === 'Escape') setOpen(false);
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  onCleanup(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
  });

  const isDefault = () =>
    props.layout.length === DEFAULT_LAYOUT.length &&
    props.layout.every((e, i) => e.id === DEFAULT_LAYOUT[i].id && e.visible === DEFAULT_LAYOUT[i].visible);

  return (
    <div class="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open()}
        aria-haspopup="dialog"
        class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-white/10 hover:text-text-main"
      >
        <span aria-hidden="true">⚙</span>
        Customize
      </button>

      <Show when={open()}>
        <div
          role="dialog"
          aria-label="Customize dashboard sections"
          class="absolute right-0 top-full z-dropdown mt-2 w-64 overflow-hidden rounded-lg border border-white/10 bg-[#0a1020]/95 shadow-2xl"
        >
          <div class="border-b border-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-text-dim">
            Sections
          </div>
          <div class="p-1.5">
            <For each={props.layout}>
              {(entry, i) => (
                <div class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
                  <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs text-text-main">
                    <input
                      type="checkbox"
                      checked={entry.visible}
                      onChange={() => props.onToggle(entry.id)}
                      class="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-white/80"
                    />
                    <span class="truncate" classList={{ 'text-text-dim': !entry.visible }}>
                      {sectionLabel(entry.id)}
                    </span>
                  </label>
                  <div class="flex flex-shrink-0 gap-0.5">
                    <button
                      type="button"
                      aria-label={`Move ${sectionLabel(entry.id)} up`}
                      disabled={i() === 0}
                      onClick={() => props.onMove(entry.id, -1)}
                      class="rounded px-1.5 py-0.5 text-[10px] text-text-dim transition-colors hover:bg-white/10 hover:text-text-main disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${sectionLabel(entry.id)} down`}
                      disabled={i() === props.layout.length - 1}
                      onClick={() => props.onMove(entry.id, 1)}
                      class="rounded px-1.5 py-0.5 text-[10px] text-text-dim transition-colors hover:bg-white/10 hover:text-text-main disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="border-t border-white/5 p-1.5">
            <button
              type="button"
              onClick={() => props.onReset()}
              disabled={isDefault()}
              class="w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-text-main disabled:opacity-40"
            >
              Reset to default
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default CustomizePanel;
