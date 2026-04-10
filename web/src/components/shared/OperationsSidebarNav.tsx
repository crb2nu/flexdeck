import { Component, For, Show, createMemo } from 'solid-js';

export interface OperationsSidebarItem {
  id: string;
  label: string;
  eyebrow?: string;
  detail?: string;
  value?: string;
  group?: string;
}

export interface OperationsSidebarNavProps {
  title: string;
  description: string;
  items: OperationsSidebarItem[];
  active: string;
  onChange: (id: string) => void;
}

const OperationsSidebarNav: Component<OperationsSidebarNavProps> = (props) => {
  const groupedItems = createMemo(() => {
    const groups: Array<{ name: string; items: OperationsSidebarItem[] }> = [];

    for (const item of props.items) {
      const groupName = item.group || 'Sections';
      const existing = groups.find((group) => group.name === groupName);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.push({ name: groupName, items: [item] });
      }
    }

    return groups;
  });

  const activeItem = createMemo(() => props.items.find((item) => item.id === props.active) ?? props.items[0]);

  return (
    <aside class="glass-panel h-fit overflow-hidden p-3 backdrop-blur-xl xl:sticky xl:top-4">
      <div class="px-1 pb-3">
        <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">{props.title}</div>
        <div class="mt-2 text-xs leading-5 text-text-dim">{props.description}</div>
      </div>

      <div class="space-y-3">
        <For each={groupedItems()}>
          {(group) => (
            <div>
              <div class="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim/80">
                {group.name}
              </div>
              <div class="mt-2 flex flex-col gap-2.5">
                <For each={group.items}>
                  {(item) => (
                    <button
                      type="button"
                      aria-pressed={props.active === item.id}
                      aria-current={props.active === item.id ? 'true' : undefined}
                      data-operations-nav-id={item.id}
                      onClick={() => props.onChange(item.id)}
                      class={`group relative overflow-hidden rounded-[20px] border p-3 text-left transition-all duration-200 ${
                        props.active === item.id
                          ? 'border-white/15 bg-white/10'
                          : 'border-white/8 bg-white/5 hover:border-white/12 hover:bg-white/7'
                      }`}
                    >
                      <div
                        class={`pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-full transition-all duration-200 ${
                          props.active === item.id
                            ? 'bg-white/50'
                            : 'bg-transparent group-hover:bg-white/20'
                        }`}
                      />
                      <div class="flex items-start justify-between gap-3 pl-2">
                        <div class="min-w-0">
                          <Show when={item.eyebrow}>
                            <div class={`text-[10px] font-semibold uppercase tracking-[0.18em] ${props.active === item.id ? 'text-text-muted' : 'text-text-dim'}`}>
                              {item.eyebrow}
                            </div>
                          </Show>
                          <div class={`text-sm font-medium ${props.active === item.id ? 'text-text-main' : 'text-text-muted'}`}>
                            {item.label}
                          </div>
                          <Show when={item.detail}>
                            <div class="mt-1 text-[11px] text-text-dim">{item.detail}</div>
                          </Show>
                        </div>
                        <div class="flex shrink-0 flex-col items-end gap-2">
                          <Show when={item.value}>
                            <div class={`text-xl font-semibold leading-none ${props.active === item.id ? 'text-white' : 'text-text-main'}`}>
                              {item.value}
                            </div>
                          </Show>
                          <span class={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${
                            props.active === item.id
                              ? 'border-white/20 bg-white/10 text-white'
                              : 'border-white/10 bg-white/5 text-text-dim/75'
                          }`}>
                            {props.active === item.id ? 'Visible' : 'Switch'}
                          </span>
                        </div>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="mt-3 rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.18))] p-3">
        <div class="flex items-center justify-between gap-2">
          <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">Current focus</div>
          <span class="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white">
            {activeItem()?.eyebrow || 'Active'}
          </span>
        </div>
        <div class="mt-2 text-sm font-medium text-text-main">{activeItem()?.label}</div>
        <Show when={activeItem()?.detail}>
          <div class="mt-1 text-xs text-text-dim">{activeItem()?.detail}</div>
        </Show>
      </div>
    </aside>
  );
};

export default OperationsSidebarNav;
