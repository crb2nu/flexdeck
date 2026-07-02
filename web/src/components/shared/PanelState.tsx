import { Component, Show } from 'solid-js';
import { sanitizeError } from '../../lib/sanitizeError';

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

  return (
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
  );
};

export default PanelState;
