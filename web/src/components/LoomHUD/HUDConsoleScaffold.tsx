import { Component, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';

export interface HUDConsoleMetric {
  label: string;
  value: string;
  detail?: string;
  tone?: 'ok' | 'warn' | 'error' | 'cyan' | 'purple';
}

export interface HUDConsoleAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface HUDConsoleAlert {
  title: string;
  message: string;
  tone?: 'warn' | 'error' | 'ok';
}

export interface HUDConsoleScaffoldProps {
  title: string;
  subtitle: string;
  badge?: string;
  modeLabel?: string;
  modeDescription?: string;
  metrics: HUDConsoleMetric[];
  actions?: HUDConsoleAction[];
  alert?: HUDConsoleAlert;
  children?: JSX.Element;
}

const metricToneClasses: Record<NonNullable<HUDConsoleMetric['tone']>, string> = {
  ok: 'text-status-ok',
  warn: 'text-status-warn',
  error: 'text-status-error',
  cyan: 'text-neon-cyan',
  purple: 'text-neon-purple',
};

const HUDConsoleScaffold: Component<HUDConsoleScaffoldProps> = (props) => {
  return (
    <div class="glass-panel corner-accents overflow-hidden border border-neon-cyan/10 bg-gradient-to-br from-[#06111f] via-[#081627] to-[#050a12] shadow-[0_0_50px_rgba(0,240,255,0.06)]">
      <div class="relative px-4 py-4 md:px-5 md:py-5">
        <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/70 to-transparent opacity-80" />
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-neon-cyan">
                Loom HUD
              </span>
              <Show when={props.badge}>
                <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-text-dim">
                  {props.badge}
                </span>
              </Show>
            </div>
            <div class="max-w-3xl space-y-1">
              <h2 class="text-2xl font-semibold tracking-tight text-text-main md:text-3xl">
                {props.title}
              </h2>
              <p class="max-w-2xl text-sm leading-6 text-text-dim md:text-[15px]">
                {props.subtitle}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <For each={props.actions || []}>
              {(action) => (
                <button
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    action.variant === 'primary'
                      ? 'bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30'
                      : action.variant === 'danger'
                        ? 'bg-status-error/20 text-status-error hover:bg-status-error/30'
                        : 'bg-white/10 text-text-main hover:bg-white/20'
                  }`}
                >
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <For each={props.metrics}>
            {(metric) => (
              <div class="rounded-xl border border-white/8 bg-white/5 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] font-mono uppercase tracking-[0.2em] text-text-dim">
                    {metric.label}
                  </span>
                  <Show when={metric.detail}>
                    <span class="text-[10px] text-text-dim">
                      {metric.detail}
                    </span>
                  </Show>
                </div>
                <div class={`mt-2 text-lg font-semibold tabular-nums ${metricToneClasses[metric.tone || 'cyan']}`}>
                  {metric.value}
                </div>
              </div>
            )}
          </For>
        </div>

        <Show when={props.modeLabel || props.modeDescription || props.alert}>
          <div class="mt-4 flex flex-col gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div class="space-y-1">
              <Show when={props.modeLabel}>
                <div class="text-[10px] font-mono uppercase tracking-[0.2em] text-neon-cyan/80">
                  {props.modeLabel}
                </div>
              </Show>
              <Show when={props.modeDescription}>
                <div class="text-xs text-text-dim">
                  {props.modeDescription}
                </div>
              </Show>
            </div>

            <Show when={props.alert}>
              {(alert) => (
                <div class={`rounded-lg border px-3 py-2 text-xs ${
                  alert().tone === 'error'
                    ? 'border-status-error/30 bg-status-error/10 text-status-error'
                    : alert().tone === 'ok'
                      ? 'border-status-ok/30 bg-status-ok/10 text-status-ok'
                      : 'border-status-warn/30 bg-status-warn/10 text-status-warn'
                }`}>
                  <div class="font-medium">{alert().title}</div>
                  <div class="mt-0.5 text-text-main/90">{alert().message}</div>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>

      <div class="border-t border-white/8 px-4 py-4 md:px-5 md:py-5">
        {props.children}
      </div>
    </div>
  );
};

export default HUDConsoleScaffold;
