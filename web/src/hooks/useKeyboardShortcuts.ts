import { onMount, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";

/**
 * Global keyboard shortcuts for power-user navigation.
 * Uses 'g' prefix (vim-style) for navigation:
 *   g then d → Dashboard
 *   g then s → Services
 *   g then l → Logs
 *   g then m → FlexInfer
 *   g then a → Loom HUD
 *   g then f → Flux
 *   g then p → Pipeline
 *   g then w → Website metrics
 *   g then x → Metrics
 *
 * Direct shortcuts:
 *   ? → Show shortcut help (dispatches custom event)
 *   Escape → Clear any pending prefix
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  let prefixTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPrefix = "";

  const NAV_MAP: Record<string, string> = {
    d: "/",
    s: "/services",
    l: "/logs",
    m: "/flexinfer",
    a: "/loom-hud",
    f: "/flux",
    p: "/pipeline",
    w: "/website-metrics",
    x: "/metrics",
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore if user is typing in an input/textarea/contenteditable
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    // ⌘K is handled by CommandPalette — skip it here
    if ((e.metaKey || e.ctrlKey) && e.key === "k") return;

    // Escape clears prefix
    if (e.key === "Escape") {
      pendingPrefix = "";
      if (prefixTimer) clearTimeout(prefixTimer);
      return;
    }

    // '?' shows help
    if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
      window.dispatchEvent(new CustomEvent("flexdeck:show-shortcuts"));
      e.preventDefault();
      return;
    }

    // 'g' prefix mode
    if (pendingPrefix === "g") {
      const route = NAV_MAP[e.key];
      if (route) {
        navigate(route);
        e.preventDefault();
      }
      pendingPrefix = "";
      if (prefixTimer) clearTimeout(prefixTimer);
      return;
    }

    // Start 'g' prefix
    if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      pendingPrefix = "g";
      if (prefixTimer) clearTimeout(prefixTimer);
      prefixTimer = setTimeout(() => {
        pendingPrefix = "";
      }, 800); // 800ms window to press second key
      return;
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    if (prefixTimer) clearTimeout(prefixTimer);
  });
}
