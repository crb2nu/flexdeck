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

  return (
    <aside class="surface h-fit overflow-hidden p-2 xl:sticky xl:top-4">
      <div class="px-2.5 pb-2">
        <div class="heading-label">{props.title}</div>
      </div>

      <div class="space-y-3">
        <For each={groupedItems()}>
          {(group) => (
            <div>
              <Show when={groupedItems().length > 1}>
                <div class="px-2.5 heading-label text-text-dim/70 mb-1">
                  {group.name}
                </div>
              </Show>
              <div class="flex flex-col gap-0.5">
                <For each={group.items}>
                  {(item) => (
                    <button
                      type="button"
                      aria-pressed={props.active === item.id}
                      aria-current={props.active === item.id ? 'true' : undefined}
                      data-operations-nav-id={item.id}
                      onClick={() => props.onChange(item.id)}
                      class={`relative flex items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors duration-100 ${
                        props.active === item.id
                          ? 'bg-white/10 text-white'
                          : 'text-text-muted hover:bg-white/5 hover:text-text-dim'
                      }`}
                    >
                      <div
                        class={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full transition-colors duration-100 ${
                          props.active === item.id ? 'bg-white/50' : 'bg-transparent'
                        }`}
                      />
                      <span class="text-sm truncate">{item.label}</span>
                      <Show when={item.value}>
                        <span class="ml-2 text-xs font-mono text-text-dim tabular-nums">
                          {item.value}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </aside>
  );
};

export default OperationsSidebarNav;
