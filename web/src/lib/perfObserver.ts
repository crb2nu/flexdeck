/**
 * Dev-only PerformanceObserver that logs long tasks (>50 ms) to the console.
 * Gated behind import.meta.env.DEV so it tree-shakes out of production builds.
 */
export function initPerfObserver() {
  if (!import.meta.env.DEV) return;
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 50) {
        console.warn('[perf] long task:', entry.duration.toFixed(0) + 'ms', entry);
      }
    }
  });
  obs.observe({ type: 'longtask', buffered: true });
}
