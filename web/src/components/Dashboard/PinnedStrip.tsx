import { Component, For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Input from '../shared/Input';
import { trapFocus } from '../../lib/focusTrap';
import { buildNavCommands, rankCommands, type PaletteCommand } from '../QuickLaunch/commands';
import { fetchEntityCommands } from '../QuickLaunch/entities';
import { healthStore } from '../../stores/health';
import { MAX_PINS, addPin, isPinned, movePin, pins, removePin, type PinnedItem } from '../../stores/pins';

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
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let pickerRef: HTMLDivElement | undefined;
  let dialogRef: HTMLDivElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  const listboxId = `pin-picker-results-${createUniqueId()}`;

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

  // Reset the highlight when the result list changes under the cursor.
  createEffect(() => {
    query();
    setSelectedIndex(0);
  });

  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    setQuery('');
    setSelectedIndex(0);
    if (restoreFocus) triggerRef?.focus();
  };

  const scrollSelectedIntoView = (index: number) => {
    listRef?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const pinCommand = (cmd: PaletteCommand) => {
    addPin({
      id: cmd.id,
      name: cmd.name,
      description: cmd.description,
      href: cmd.href!,
      section: cmd.section,
    });
    closePicker(true);
  };

  const onDocumentClick = (event: MouseEvent) => {
    if (pickerOpen() && pickerRef && !pickerRef.contains(event.target as Node)) closePicker();
  };
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (!pickerOpen()) return;
    trapFocus(dialogRef, event);
    if (event.key === 'Escape') {
      closePicker(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((i) => {
        const next = Math.min(i + 1, Math.max(results().length - 1, 0));
        scrollSelectedIntoView(next);
        return next;
      });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((i) => {
        const next = Math.max(i - 1, 0);
        scrollSelectedIntoView(next);
        return next;
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const cmd = results()[selectedIndex()];
      if (cmd) pinCommand(cmd);
    }
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  onCleanup(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
  });

  return (
    <div class="space-y-2 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <span class="heading-section">Pinned</span>
        <div class="relative" ref={pickerRef}>
          <button
            ref={triggerRef}
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
              ref={dialogRef}
              role="dialog"
              aria-label="Pin a resource"
              class="absolute right-0 top-full z-dropdown mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-white/10 bg-[#0a1020]/95 shadow-2xl"
            >
              <div class="border-b border-white/5 p-2">
                <Input
                  ref={inputRef}
                  type="search"
                  size="sm"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={results().length > 0 ? `${listboxId}-opt-${selectedIndex()}` : undefined}
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  placeholder="Search repos, workloads, models, pages…"
                  aria-label="Search pinnable resources"
                />
              </div>
              <div id={listboxId} ref={listRef} role="listbox" aria-label="Pinnable resources" class="max-h-72 overflow-y-auto p-1">
                <For
                  each={results()}
                  fallback={
                    <div class="px-3 py-4 text-center text-xs text-text-dim">
                      {candidates().length === 0 ? 'Loading…' : 'Nothing left to pin for that search.'}
                    </div>
                  }
                >
                  {(cmd, i) => (
                    <div
                      id={`${listboxId}-opt-${i()}`}
                      role="option"
                      aria-selected={i() === selectedIndex()}
                      data-index={i()}
                      onClick={() => pinCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(i())}
                      class={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                        i() === selectedIndex() ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-xs text-text-dim">
                        {pinIcon(cmd.section)}
                      </span>
                      <span class="min-w-0">
                        <span class="block truncate text-xs font-medium text-text-main">{cmd.name}</span>
                        <span class="block truncate text-[10px] text-text-muted">{cmd.description}</span>
                      </span>
                    </div>
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
            {(pin: PinnedItem, i) => (
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
                {/* Always visible below lg (touch has no hover); hover/focus-revealed on desktop. */}
                <div class="flex flex-shrink-0 items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover/pin:opacity-100">
                  <button
                    type="button"
                    onClick={() => movePin(pin.id, -1)}
                    disabled={i() === 0}
                    aria-label={`Move ${pin.name} up`}
                    class="rounded-md px-1 py-0.5 text-[10px] text-text-dim transition-colors hover:bg-white/10 hover:text-text-main disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePin(pin.id, 1)}
                    disabled={i() === pins().length - 1}
                    aria-label={`Move ${pin.name} down`}
                    class="rounded-md px-1 py-0.5 text-[10px] text-text-dim transition-colors hover:bg-white/10 hover:text-text-main disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removePin(pin.id)}
                    aria-label={`Unpin ${pin.name}`}
                    class="rounded-md px-1.5 py-0.5 text-xs text-text-dim transition-colors hover:bg-white/10 hover:text-text-main"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default PinnedStrip;
