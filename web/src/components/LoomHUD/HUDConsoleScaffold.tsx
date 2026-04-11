import { Component, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import Button from '../shared/Button';

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
  cyan: 'text-white',
  purple: 'text-text-muted',
};

const HUDConsoleScaffold: Component<HUDConsoleScaffoldProps> = (props) => {
  return (
    <div class="surface overflow-hidden">
      <div class="px-4 py-4 md:px-5 md:py-5">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-1">
            <h2 class="heading-page">
              {props.title}
            </h2>
            <p class="max-w-2xl text-sm text-text-dim">
              {props.subtitle}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <For each={props.actions || []}>
              {(action) => (
                <Button
                  variant={action.variant === 'danger' ? 'danger' : action.variant === 'primary' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.label}
                </Button>
              )}
            </For>
          </div>
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <For each={props.metrics}>
            {(metric) => (
              <div class="surface px-3 py-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="heading-label">
                    {metric.label}
                  </span>
                  <Show when={metric.detail}>
                    <span class="text-[10px] text-text-dim">
                      {metric.detail}
                    </span>
                  </Show>
                </div>
                <div class={`mt-1.5 text-lg font-semibold tabular-nums ${metricToneClasses[metric.tone || 'cyan']}`}>
                  {metric.value}
                </div>
              </div>
            )}
          </For>
        </div>

        <Show when={props.modeLabel || props.modeDescription || props.alert}>
          <div class="mt-4 flex flex-col gap-2 surface px-3 py-2.5 md:flex-row md:items-center md:justify-between">
            <div class="space-y-1">
              <Show when={props.modeLabel}>
                <div class="heading-label">
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
                <div class={`rounded-md border px-3 py-2 text-xs ${
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
