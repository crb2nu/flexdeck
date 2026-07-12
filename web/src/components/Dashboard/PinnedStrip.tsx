import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Input from '../shared/Input';
import { buildNavCommands, rankCommands, type PaletteCommand } from '../QuickLaunch/commands';
import { fetchEntityCommands } from '../QuickLaunch/entities';
import { healthStore } from '../../stores/health';
import { MAX_PINS, addPin, isPinned, pins, removePin, type PinnedItem } from '../../stores/pins';

function pinIcon(section: string): string {
  switch (section) {
    case 'Repos':
      return '⌥';
    case 'Workloads':
      return '◈';
    case 'Models':
      return '◉';
    case 'Loom':
      return '❋';
    case 'FlexInfer':
      return '▣';
    default:
      return '➜';
  }
}

/**
 * Pinned resources: user-chosen quick links (repos, workloads, models, pages)
 * on the dashboard home. The add-pin picker reuses the palette's entity
 * search, so anything findable via ⌘K is pinnable here.
 */
const PinnedStrip: Component = () => {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [candidates, setCandidates] = createSignal<PaletteCommand[]>([]);
  let pickerRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!pickerOpen()) return;
    setTimeout(() => inputRef?.focus(), 30);
    void fetchEntityCommands().then((entities) => {
      setCandidates([...buildNavCommands(healthStore.features || {}), ...entities]);
    });
  });

  const results = createMemo(() => {
    if (!pickerOpen()) return [];
    return rankCommands(candidates(), query(), [])
      .filter((c) => c.href && !isPinned(c.id))
      .slice(0, 8);
  });

  const closePicker = () => {
    setPickerOpen(false);
    setQuery('');
  };

  const onDocumentClick = (event: MouseEvent) => {
    if (pickerOpen() && pickerRef && !pickerRef.contains(event.target as Node)) closePicker();
  };
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (pickerOpen() && event.key === 'Escape') closePicker();
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  onCleanup(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
  });

  const pinCommand = (cmd: PaletteCommand) => {
    addPin({
      id: cmd.id,
      name: cmd.name,
      description: cmd.description,
      href: cmd.href!,
      section: cmd.section,
    });
    closePicker();
  };

  return (
    <div class="space-y-2 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <span class="heading-section">Pinned</span>
        <div class="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => (pickerOpen() ? closePicker() : setPickerOpen(true))}
            aria-expanded={pickerOpen()}
            aria-haspopup="dialog"
            disabled={pins().length >= MAX_PINS}
            class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-white/10 hover:text-text-main disabled:opacity-50"
            title={pins().length >= MAX_PINS ? `Limit of ${MAX_PINS} pins reached` : 'Pin a repo, workload, model, or page'}
          >
            + Pin
          </button>

          <Show when={pickerOpen()}>
            <div
              role="dialog"
              aria-label="Pin a resource"
              class="absolute right-0 top-full z-dropdown mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-white/10 bg-[#0a1020]/95 shadow-2xl"
            >
              <div class="border-b border-white/5 p-2">
                <Input
                  ref={inputRef}
                  type="search"
                  size="sm"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  placeholder="Search repos, workloads, models, pages…"
                  aria-label="Search pinnable resources"
                />
              </div>
              <div class="max-h-72 overflow-y-auto p-1">
                <For
                  each={results()}
                  fallback={
                    <div class="px-3 py-4 text-center text-xs text-text-dim">
                      {candidates().length === 0 ? 'Loading…' : 'Nothing left to pin for that search.'}
                    </div>
                  }
                >
                  {(cmd) => (
                    <button
                      type="button"
                      onClick={() => pinCommand(cmd)}
                      class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-xs text-text-dim">
                        {pinIcon(cmd.section)}
                      </span>
                      <span class="min-w-0">
                        <span class="block truncate text-xs font-medium text-text-main">{cmd.name}</span>
                        <span class="block truncate text-[10px] text-text-muted">{cmd.description}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <Show
        when={pins().length > 0}
        fallback={
          <div class="rounded-md border border-dashed border-white/10 px-4 py-3 text-xs text-text-dim">
            Nothing pinned yet — pin repos, workloads, or models for one-click access from here.
          </div>
        }
      >
        <div class="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <For each={pins()}>
            {(pin: PinnedItem) => (
              <div class="surface group/pin flex items-center gap-2.5 p-2.5">
                <button
                  type="button"
                  onClick={() => navigate(pin.href)}
                  class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  title={pin.description}
                >
                  <span class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-sm text-text-dim">
                    {pinIcon(pin.section)}
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate text-xs font-medium text-text-main">{pin.name}</span>
                    <span class="block truncate text-[10px] text-text-muted">{pin.description}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removePin(pin.id)}
                  aria-label={`Unpin ${pin.name}`}
                  class="flex-shrink-0 rounded-md px-1.5 py-0.5 text-xs text-text-dim opacity-0 transition-opacity hover:bg-white/10 hover:text-text-main focus-visible:opacity-100 group-hover/pin:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default PinnedStrip;
