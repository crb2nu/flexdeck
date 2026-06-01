# Research Brief — FlexInfer Flicker And Sidebar Link Failures (2026-04-12)

## Problem Statement
The current FlexInfer workbench is mixing two navigation models:
- app-level route navigation under `HashRouter`
- page-level section navigation implemented by directly reading and rewriting `window.location.hash`

That combination creates a likely route-clobbering bug, and it also exposes a gap in the shared `OperationsSidebarNav` primitive: the primitive only knows how to behave like a stateful button list, not like a router-aware link rail.

## Method
- Verified runtime/index readiness so the planning bundle is sourced to the current environment.
- Inspected the app router, top-level nav, FlexInfer workbench, shared sidebar primitive, and the current tests.
- Compared production routing assumptions to test harness assumptions.

Commands used:
- `git status --short --branch`
- `python $CODEX_HOME/skills/plan-loom-core/scripts/workspace_snapshot.py --root .`
- `rg -n "<Route|path=|HashRouter|/flexinfer|/models" web/src`
- `rg -n "hash|replaceState|scrollSectionIntoView|setActiveSection|OperationsSidebarNav" web/src/components/FlexInfer/Workbench.tsx web/src/components/shared/OperationsSidebarNav.tsx`
- `nl -ba web/src/index.tsx | sed -n '1,120p'`
- `nl -ba web/src/lib/featureFlags.ts | sed -n '1,120p'`
- `nl -ba web/src/components/FlexInfer/Workbench.tsx | sed -n '1,260p'`
- `nl -ba web/src/components/FlexInfer/Workbench.tsx | sed -n '340,430p'`
- `nl -ba web/src/components/FlexInfer/Workbench.tsx | sed -n '430,500p'`
- `nl -ba web/src/components/FlexInfer/Workbench.tsx | sed -n '1170,1235p'`
- `nl -ba web/src/components/shared/OperationsSidebarNav.tsx | sed -n '1,160p'`
- `nl -ba web/src/components/FlexInfer/Workbench.test.tsx | sed -n '230,360p'`
- `nl -ba web/src/hooks/useKeyboardShortcuts.ts | sed -n '1,120p'`
- `nl -ba web/src/components/QuickLaunch/CommandPalette.tsx | sed -n '1,120p'`

## Facts Found

### 1. Production routing is hash-based, and FlexInfer already has a canonical route
- The app mounts under `HashRouter`, not `BrowserRouter`: `web/src/index.tsx:3-47`.
- FlexInfer is reachable via both `/flexinfer` and `/models`, but `/flexinfer` is already treated as canonical in the primary nav and keyboard/command navigation surfaces: `web/src/index.tsx:39-40`, `web/src/lib/featureFlags.ts:38-68`, `web/src/hooks/useKeyboardShortcuts.ts:25-34`, `web/src/components/QuickLaunch/CommandPalette.tsx:44-50`.

### 2. FlexInfer section state currently rewrites the same hash that the router owns
- The workbench defines section hashes like `#flexinfer-telemetry`: `web/src/components/FlexInfer/Workbench.tsx:72`.
- On mount it reads `window.location.hash` and, when no matching section is present, immediately calls `syncWorkbenchSectionHash(activeSection())`: `web/src/components/FlexInfer/Workbench.tsx:156-163`.
- `changeSection` also syncs section state back into the hash before scrolling: `web/src/components/FlexInfer/Workbench.tsx:205-215`.
- `syncWorkbenchSectionHash` uses `window.history.replaceState(..., \`${window.location.pathname}${window.location.search}${nextHash}\`)`, which replaces the fragment rather than composing with the router fragment: `web/src/components/FlexInfer/Workbench.tsx:1195-1200`.

Inference from the code above:
- under `HashRouter`, the route already lives in `window.location.hash` as something like `#/flexinfer`
- replacing that fragment with `#flexinfer-telemetry` can drop the router path entirely
- that explains both broken sidebar link behavior and the visible route flicker/reset the user reported

### 3. The shared sidebar primitive is button-only, which is too narrow for deep-linkable page rails
- `OperationsSidebarNav` accepts `items`, `active`, and `onChange`, then renders only `<button>` elements with no `href`, no router integration, and no native link affordances: `web/src/components/shared/OperationsSidebarNav.tsx:3-18`, `web/src/components/shared/OperationsSidebarNav.tsx:37-86`.
- That primitive is acceptable for purely local panels such as the Agents registry flow, but it is a bad fit for FlexInfer if the rail is supposed to behave like linkable navigation.

### 4. FlexInfer is behaving like a tabbed shell while also trying to behave like a scroll-linked document
- The sidebar selects one `activeSection` at a time: `web/src/components/FlexInfer/Workbench.tsx:391-397`.
- The section bodies are conditionally hidden rather than presented as one long scrollable document: `web/src/components/FlexInfer/Workbench.tsx:400`, `web/src/components/FlexInfer/Workbench.tsx:472`.
- Even with hidden panels, the workbench still performs `requestAnimationFrame(...scrollSectionIntoView(...))` on mount and on every section change: `web/src/components/FlexInfer/Workbench.tsx:158-160`, `web/src/components/FlexInfer/Workbench.tsx:213-215`.
- The overview focus cards bypass the route/hash helper entirely and call `setActiveSection(...)` directly, so section transitions are already inconsistent inside the same screen: `web/src/components/FlexInfer/Workbench.tsx:444-468`.

Practical takeaway:
- the current implementation is not a stable anchor-scrolling page
- it is a tabbed panel shell with extra scroll/hash behavior layered on top
- that extra layer adds movement and URL churn without giving a coherent navigation model back

### 5. The current tests are not exercising the real routing mode
- The workbench tests set the URL to `/models` and assert bare hashes like `#flexinfer-telemetry`: `web/src/components/FlexInfer/Workbench.test.tsx:253`, `web/src/components/FlexInfer/Workbench.test.tsx:302-346`.
- Those assertions do not model `HashRouter` URLs such as `#/flexinfer`, so they would not catch fragment clobbering in production.

### 6. Naming drift is still present around the canonical FlexInfer route
- The route entry and command surfaces say `FlexInfer`, but the lazy page module is still imported from `./components/Models`, and that wrapper simply renders the FlexInfer workbench: `web/src/index.tsx:19`, `web/src/index.tsx:39-40`, `web/src/components/Models/index.tsx:1-19`.
- This is not the direct flicker bug, but it is part of the reason routing intent is harder to reason about than it should be.

## Recommended Direction
Use a single navigation model for the FlexInfer workbench:
- keep `/flexinfer` as the canonical route
- preserve `/models` only as a compatibility alias or redirect
- stop using raw fragment ownership for section state
- treat the workbench as a tabbed shell unless the product explicitly wants a true scroll-linked document

For the shared primitive:
- extend `OperationsSidebarNav` so items can be router links when needed and local buttons when needed
- adopt the link-capable mode in FlexInfer first
- keep Agents and similar local-only shells on button mode until they need deep links

## Open Questions
- Do we want `/models` to remain as a silent compatibility alias indefinitely, or should it normalize to `/flexinfer` with `replace: true` once the screen loads?
- Is section state worth keeping in the URL at all for FlexInfer, or is in-memory state enough once the route bug is fixed?
- If URL state is retained, should it move to router-aware search params rather than any flavor of raw `window.location.hash`?

## Sources
- `web/src/index.tsx:3-47`
- `web/src/lib/featureFlags.ts:38-68`
- `web/src/hooks/useKeyboardShortcuts.ts:25-34`
- `web/src/components/QuickLaunch/CommandPalette.tsx:44-50`
- `web/src/components/FlexInfer/Workbench.tsx:72`
- `web/src/components/FlexInfer/Workbench.tsx:156-215`
- `web/src/components/FlexInfer/Workbench.tsx:391-472`
- `web/src/components/FlexInfer/Workbench.tsx:444-468`
- `web/src/components/FlexInfer/Workbench.tsx:1186-1200`
- `web/src/components/shared/OperationsSidebarNav.tsx:3-86`
- `web/src/components/FlexInfer/Workbench.test.tsx:236-346`
- `web/src/components/Models/index.tsx:1-19`
