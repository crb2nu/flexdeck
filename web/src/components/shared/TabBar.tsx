import { For, Show, JSX } from 'solid-js';

export interface TabDef<T extends string = string> {
  id: T;
  label: string;
  count?: number | (() => number);
  color?: string;
  icon?: string;
}

export interface TabBarProps<T extends string = string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  variant?: 'pill' | 'underline';
  size?: 'sm' | 'md';
  class?: string;
}

function resolveCount(count: number | (() => number) | undefined): number | undefined {
  if (count === undefined) return undefined;
  return typeof count === 'function' ? count() : count;
}

function TabBar<T extends string = string>(props: TabBarProps<T>): JSX.Element {
  const variant = () => props.variant ?? 'pill';
  const size = () => props.size ?? 'sm';

  return (
    <Show
      when={variant() === 'underline'}
      fallback={
        <div role="tablist" class={`flex max-w-full gap-1 overflow-x-auto rounded-md bg-white/5 p-0.5 no-scrollbar ${props.class ?? ''}`}>
          <For each={props.tabs}>
            {(tab) => {
              const isActive = () => props.active === tab.id;
              return (
                <button
                  role="tab"
                  aria-selected={isActive()}
                  onClick={() => props.onChange(tab.id)}
                  class={`rounded px-3 ${size() === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm'} font-medium transition-colors whitespace-nowrap ${
                    isActive()
                      ? 'bg-white/10 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
                      : 'text-text-dim hover:text-text-main hover:bg-white/5'
                  }`}
                >
                  <Show when={tab.icon}>
                    <span class="mr-1 opacity-70">{tab.icon}</span>
                  </Show>
                  {tab.label}
                  <Show when={resolveCount(tab.count) != null && resolveCount(tab.count)! >= 0}>
                    <span class={`ml-1.5 text-[10px] font-mono tabular-nums ${isActive() ? 'opacity-70' : 'opacity-40'}`}>
                      {resolveCount(tab.count)}
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      }
    >
      <div role="tablist" class={`flex gap-1 border-b border-white/5 pb-px ${props.class ?? ''}`}>
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => props.active === tab.id;
            return (
              <button
                role="tab"
                aria-selected={isActive()}
                onClick={() => props.onChange(tab.id)}
                class={`flex items-center gap-1.5 rounded-t px-3 ${size() === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm'} font-medium transition-colors whitespace-nowrap ${
                  isActive()
                    ? `border-b-2 border-${tab.color ?? 'white'} text-${tab.color ?? 'white'}`
                    : 'text-text-dim hover:text-white/60'
                }`}
              >
                <Show when={tab.icon}>
                  <span class="opacity-70">{tab.icon}</span>
                </Show>
                {tab.label}
                <Show when={resolveCount(tab.count) != null && resolveCount(tab.count)! >= 0}>
                  <span class={`text-[10px] font-mono tabular-nums ${isActive() ? 'opacity-70' : 'opacity-40'}`}>
                    {resolveCount(tab.count)}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

export default TabBar;
