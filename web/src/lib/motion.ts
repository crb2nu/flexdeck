/**
 * The global reduced-motion CSS overrides (styles/global.css) cannot reach
 * JS-driven animation: requestAnimationFrame loops, canvas 2D painting,
 * three.js render loops, and d3 transitions. Those sites gate on this
 * helper instead.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
