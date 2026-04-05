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

  const activeItem = createMemo(() => (
    props.items.find((item) => item.id === props.active) ?? props.items[0]
  ));

  return (
    <aside class="glass-panel h-fit p-3 xl:sticky xl:top-4">
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
              <div class="mt-2 flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
                <For each={group.items}>
                  {(item) => (
                    <button
                      type="button"
                      onClick={() => props.onChange(item.id)}
                      class={`min-w-[196px] rounded-2xl border p-3 text-left transition-colors xl:min-w-0 ${
                        props.active === item.id
                          ? 'border-neon-cyan/30 bg-neon-cyan/10'
                          : 'border-white/8 bg-white/5 hover:border-neon-cyan/20 hover:bg-white/7'
                      }`}
                    >
                      <Show when={item.eyebrow}>
                        <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">
                          {item.eyebrow}
                        </div>
                      </Show>
                      <div class="mt-2 flex items-end justify-between gap-3">
                        <div class="min-w-0">
                          <div class={`text-sm font-medium ${props.active === item.id ? 'text-text-main' : 'text-text-muted'}`}>
                            {item.label}
                          </div>
                          <Show when={item.detail}>
                            <div class="mt-1 text-[11px] text-text-dim">{item.detail}</div>
                          </Show>
                        </div>
                        <Show when={item.value}>
                          <div class={`text-xl font-semibold ${props.active === item.id ? 'text-neon-cyan' : 'text-text-main'}`}>
                            {item.value}
                          </div>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="mt-3 rounded-2xl border border-white/8 bg-black/20 p-3">
        <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">Current focus</div>
        <div class="mt-2 text-sm font-medium text-text-main">{activeItem()?.label}</div>
        <Show when={activeItem()?.detail}>
          <div class="mt-1 text-xs text-text-dim">{activeItem()?.detail}</div>
        </Show>
      </div>
    </aside>
  );
};

export default OperationsSidebarNav;
