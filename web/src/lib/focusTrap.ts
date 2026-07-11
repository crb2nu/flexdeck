// Keyboard focus containment for modal dialogs. Dialogs here already own an
// Escape handler; this adds the Tab/Shift+Tab wrap so keyboard focus cannot
// escape into the page behind the overlay.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Call from a keydown handler while a dialog is open. Wraps Tab / Shift+Tab
 * focus movement at the edges of `container`, and pulls focus back inside if
 * it has strayed (e.g. the trigger button behind the overlay).
 */
export function trapFocus(container: HTMLElement | undefined, e: KeyboardEvent): void {
  if (!container || e.key !== 'Tab') return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && container.contains(active);

  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
