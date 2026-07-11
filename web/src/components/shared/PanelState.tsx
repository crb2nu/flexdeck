import { Component, Match, Show, Switch } from 'solid-js';
import { sanitizeError } from '../../lib/sanitizeError';
import LoadingState from './LoadingState';
import { SkeletonRows, SkeletonTiles } from './Skeleton';

export interface PanelStateProps {
  error: string | null;
  loaded: boolean;
  /** Copy shown once loaded with no rows. */
  empty: string;
  /**
   * Friendly copy substituted when the error indicates the upstream source is
   * disabled (proxy feature flag off), e.g. 'Mills operator unavailable.'
   */
  offlineLabel?: string;
  /**
   * Optional shape-faithful placeholder rendered while loading instead of the
   * default 'Loading…' text: 'rows' for lists, 'tiles' for metric tiles,
   * 'block' for a generic panel shimmer. Omit to keep the text.
   */
  skeleton?: 'rows' | 'tiles' | 'block';
  /** Row/tile count for the skeleton variants (default 3). */
  skeletonCount?: number;
}

/**
 * The loading / error / empty terminal state for a polled panel. Errors are
 * sanitized so raw backend strings never reach the user.
 */
const PanelState: Component<PanelStateProps> = (props) => {
  const message = () => {
    const err = props.error;
    if (!err) return '';
    if (props.offlineLabel && err.includes('disabled')) return props.offlineLabel;
    return sanitizeError(err);
  };

  const showSkeleton = () => !props.error && !props.loaded && props.skeleton != null;

  return (
    <Switch
      fallback={
        <div class="surface px-4 py-6 text-center text-sm">
          <Show
            when={props.error}
            fallback={
              <span class="text-text-dim" aria-live="polite">
                {props.loaded ? props.empty : 'Loading…'}
              </span>
            }
          >
            <span class="text-status-error" role="alert">{message()}</span>
          </Show>
        </div>
      }
    >
      <Match when={showSkeleton() && props.skeleton === 'rows'}>
        <SkeletonRows surface count={props.skeletonCount ?? 3} />
      </Match>
      <Match when={showSkeleton() && props.skeleton === 'tiles'}>
        <SkeletonTiles count={props.skeletonCount ?? 3} />
      </Match>
      <Match when={showSkeleton() && props.skeleton === 'block'}>
        <div class="surface" aria-hidden="true">
          <LoadingState variant="skeleton" />
        </div>
      </Match>
    </Switch>
  );
};

export default PanelState;
