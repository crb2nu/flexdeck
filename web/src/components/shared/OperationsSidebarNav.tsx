import { useHref, useNavigate } from '@solidjs/router';
import { Component, For, Show, createMemo } from 'solid-js';

export interface OperationsSidebarItem {
  id: string;
  label: string;
  eyebrow?: string;
  detail?: string;
  value?: string;
  group?: string;
  href?: string;
  replace?: boolean;
  noScroll?: boolean;
}

export interface OperationsSidebarNavProps {
  title: string;
  description: string;
  items: OperationsSidebarItem[];
  active: string;
  onChange?: (id: string) => void;
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
                  {(item) => {
                    const active = () => props.active === item.id;
                    const itemClass = () =>
                      `relative flex items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors duration-100 ${
                        active()
                          ? 'bg-white/10 text-white'
                          : 'text-text-muted hover:bg-white/5 hover:text-text-dim'
                      }`;

                    return (
                      <Show
                        when={item.href}
                        fallback={
                          <button
                            type="button"
                            aria-pressed={active()}
                            aria-current={active() ? 'true' : undefined}
                            data-operations-nav-id={item.id}
                            onClick={() => props.onChange?.(item.id)}
                            class={itemClass()}
                          >
                            <SidebarItemAccent active={active()} />
                            <SidebarItemContent item={item} />
                          </button>
                        }
                      >
                        <SidebarLinkItem
                          item={item}
                          active={active()}
                          class={itemClass()}
                          onSelect={() => props.onChange?.(item.id)}
                        />
                      </Show>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </aside>
  );
};

const SidebarItemAccent: Component<{ active: boolean }> = (props) => (
  <div
    class={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full transition-colors duration-100 ${
      props.active ? 'bg-white/50' : 'bg-transparent'
    }`}
  />
);

const SidebarItemContent: Component<{ item: OperationsSidebarItem }> = (props) => (
  <>
    <span class="text-sm truncate">{props.item.label}</span>
    <Show when={props.item.value}>
      <span class="ml-2 text-xs font-mono text-text-dim tabular-nums">
        {props.item.value}
      </span>
    </Show>
  </>
);

const SidebarLinkItem: Component<{
  item: OperationsSidebarItem;
  active: boolean;
  class: string;
  onSelect?: () => void;
}> = (props) => {
  const navigate = useNavigate();
  const href = useHref(() => props.item.href!);

  const handleClick = (event: MouseEvent) => {
    props.onSelect?.();
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    void navigate(props.item.href!, {
      replace: props.item.replace,
      scroll: props.item.noScroll === false,
      resolve: false,
    });
  };

  return (
    <a
      href={href()}
      aria-current={props.active ? 'page' : undefined}
      data-operations-nav-id={props.item.id}
      onClick={handleClick}
      class={props.class}
    >
      <SidebarItemAccent active={props.active} />
      <SidebarItemContent item={props.item} />
    </a>
  );
};

export default OperationsSidebarNav;
