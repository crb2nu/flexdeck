import { Component, Index } from 'solid-js';

export interface SkeletonRowsProps {
  /** Number of placeholder rows (default 5). */
  count?: number;
  /**
   * Render each row as its own surface card (standalone lists). Default is
   * plain divided rows for use inside an existing panel surface.
   */
  surface?: boolean;
  class?: string;
}

/**
 * Shape-faithful list placeholder: N ListRow-sized shimmer rows (leading dot,
 * two text lines, trailing badge) so content doesn't jump when data arrives.
 * Shimmer respects prefers-reduced-motion via the .skeleton rule in global.css.
 */
export const SkeletonRows: Component<SkeletonRowsProps> = (props) => (
  <div
    class={`animate-fade-in ${props.surface ? 'space-y-2' : 'divide-y divide-white/5'} ${props.class ?? ''}`}
    aria-hidden="true"
  >
    <Index each={Array.from({ length: props.count ?? 5 })}>
      {() => (
        <div class={`flex items-center gap-3 px-3 py-2 ${props.surface ? 'surface' : ''}`}>
          <div class="skeleton h-2 w-2 flex-shrink-0 rounded-full" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="skeleton h-3 w-2/5 rounded" />
            <div class="skeleton h-2.5 w-3/5 rounded" />
          </div>
          <div class="skeleton h-4 w-14 flex-shrink-0 rounded" />
        </div>
      )}
    </Index>
  </div>
);

export interface SkeletonTilesProps {
  /** Number of placeholder tiles (default 4). */
  count?: number;
  /** Grid container classes; defaults to the standard summary-tile grid. */
  class?: string;
}

/** MetricTile-shaped placeholders: caption line over a large value line. */
export const SkeletonTiles: Component<SkeletonTilesProps> = (props) => (
  <div
    class={`animate-fade-in ${props.class ?? 'grid grid-cols-2 gap-2 sm:grid-cols-4'}`}
    aria-hidden="true"
  >
    <Index each={Array.from({ length: props.count ?? 4 })}>
      {() => (
        <div class="surface px-3 py-2">
          <div class="skeleton h-2.5 w-16 rounded" />
          <div class="skeleton mt-2 h-6 w-14 rounded" />
        </div>
      )}
    </Index>
  </div>
);

export interface SkeletonTableProps {
  /** Number of placeholder body rows (default 8). */
  rows?: number;
  class?: string;
}

/** DataTable-shaped placeholder: header band over N cell rows. */
export const SkeletonTable: Component<SkeletonTableProps> = (props) => (
  <div class={`animate-fade-in ${props.class ?? ''}`} aria-hidden="true">
    <div class="flex items-center gap-4 border-b border-white/5 px-4 py-2.5">
      <div class="skeleton h-3 w-24 rounded" />
      <div class="skeleton h-3 w-20 rounded" />
      <div class="skeleton h-3 w-16 rounded" />
      <div class="skeleton ml-auto h-3 w-14 rounded" />
    </div>
    <div class="divide-y divide-white/5">
      <Index each={Array.from({ length: props.rows ?? 8 })}>
        {() => (
          <div class="flex items-center gap-4 px-4 py-2.5">
            <div class="skeleton h-2 w-2 flex-shrink-0 rounded-full" />
            <div class="skeleton h-3 w-1/4 rounded" />
            <div class="skeleton h-3 w-20 rounded" />
            <div class="skeleton h-3 w-16 rounded" />
            <div class="skeleton ml-auto h-3 w-14 rounded" />
          </div>
        )}
      </Index>
    </div>
  </div>
);
