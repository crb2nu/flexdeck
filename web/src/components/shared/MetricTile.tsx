import { Component, Show } from 'solid-js';
import { toneTextClass, type BadgeTone } from './Badge';

export interface MetricTileProps {
  label: string;
  value: string;
  tone?: BadgeTone;
  /** Optional secondary line under the value. */
  hint?: string;
}

/**
 * A compact stat tile: heading-label caption over a large tabular-nums value
 * colored by tone. The standard top-of-panel summary unit.
 */
const MetricTile: Component<MetricTileProps> = (props) => (
  <div class="surface px-3 py-2">
    <div class="heading-label">{props.label}</div>
    <div class={`mt-1 text-lg font-semibold tabular-nums ${toneTextClass[props.tone ?? 'default']}`}>
      {props.value}
    </div>
    <Show when={props.hint}>
      <div class="text-[11px] text-text-muted">{props.hint}</div>
    </Show>
  </div>
);

export default MetricTile;
