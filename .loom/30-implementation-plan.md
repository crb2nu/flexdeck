# Implementation Plan — FlexInfer Route-Stable Section Navigation (2026-04-12)

## Scope
- Repository: `/Users/cblevins/workspace/services/flexdeck`
- Focus:
  - remove the FlexInfer router/hash conflict
  - make sidebar navigation semantics reusable across FlexInfer and other shells
  - add regression coverage that matches production routing
- Out of scope:
  - broad router migration
  - unrelated visual redesign
  - large cleanup beyond the FlexInfer route surface and the shared sidebar primitive

## Root Cause To Address
The app uses `HashRouter` (`web/src/index.tsx:3-47`), but the FlexInfer workbench also treats `window.location.hash` as if it owns it (`web/src/components/FlexInfer/Workbench.tsx:156-215`, `web/src/components/FlexInfer/Workbench.tsx:1186-1200`). That makes sidebar section changes capable of overwriting the active route fragment. The shared sidebar primitive reinforces the problem because it only supports button callbacks, not route-aware links (`web/src/components/shared/OperationsSidebarNav.tsx:3-86`).

## Recommended Implementation Shape
Keep the workbench as a tabbed shell and stop using raw fragment ownership for section state.

Why this shape:
- inactive sections are already hidden, so the current UI is functionally a tabbed panel shell, not a long-form anchored document: `web/src/components/FlexInfer/Workbench.tsx:391-472`
- removing the hash/scroll layer is a smaller, lower-risk fix than converting the screen into a real anchor document
- a tabbed-shell model maps cleanly onto a shared sidebar primitive that can render either buttons or router links

## Milestones

### M1. Introduce Router-Safe Section State
- Ownership:
  - `web/src/components/FlexInfer/Workbench.tsx`
- Tasks:
  - replace `readWorkbenchSectionFromHash` and `syncWorkbenchSectionHash` with a router-aware state helper
  - use either router search params or an equivalent route-safe mechanism; do not write raw section fragments into `window.location.hash`
  - remove the `hashchange` listener and any section-state code that depends on bare hash ownership
- Success signal:
  - the active FlexInfer route remains intact before and after section changes

### M2. Remove Tab/Scroll Hybrid Behavior
- Ownership:
  - `web/src/components/FlexInfer/Workbench.tsx`
- Tasks:
  - delete section scrolling that only exists to support the old hash flow
  - route all section changes, including overview focus cards, through one shared handler
  - keep the one-active-section layout unless product requirements explicitly change
- Success signal:
  - section switches no longer schedule unnecessary scroll movement or URL churn

### M3. Upgrade `OperationsSidebarNav`
- Ownership:
  - `web/src/components/shared/OperationsSidebarNav.tsx`
  - consumers in `web/src/components/FlexInfer/Workbench.tsx`
  - optional spot-check consumer in `web/src/components/Agents/index.tsx`
- Tasks:
  - extend the item contract so a consumer can supply either:
    - `onChange`/button behavior
    - link metadata for router-aware navigation
  - preserve current styling and active-state visuals across both interaction modes
  - migrate FlexInfer to the link-capable or router-aware mode first
  - leave Agents on button mode unless the change is zero-risk and simpler to standardize
- Success signal:
  - the primitive no longer forces deep-linkable navigation to masquerade as a button list

### M4. Canonical Path Cleanup
- Ownership:
  - `web/src/index.tsx`
  - optional helper sites that still encode legacy naming
- Tasks:
  - keep `/flexinfer` as canonical
  - decide whether `/models` remains a long-lived alias or performs a replace-style normalization
  - avoid breaking existing nav, command palette, and keyboard shortcuts that already target `/flexinfer`: `web/src/lib/featureFlags.ts:38-68`, `web/src/hooks/useKeyboardShortcuts.ts:25-34`, `web/src/components/QuickLaunch/CommandPalette.tsx:44-50`
- Success signal:
  - route ownership is easier to reason about and no screen relies on ambiguous naming to work

### M5. Regression Tests In Real Routing Mode
- Ownership:
  - `web/src/components/FlexInfer/Workbench.test.tsx`
  - new shared primitive test file if needed
- Tasks:
  - update the FlexInfer tests so they run with routing assumptions equivalent to production hash routing
  - assert that route state is preserved during section changes
  - assert that the active section changes correctly when loading the route with section state already present
  - add direct primitive coverage for link mode if the API surface changes materially
- Success signal:
  - tests fail if raw fragment replacement comes back

## Suggested Execution Order
1. Add router-safe section state helper in FlexInfer.
2. Remove hashchange and scroll coupling from the workbench.
3. Upgrade `OperationsSidebarNav` to support link-capable navigation.
4. Adopt the new primitive mode in FlexInfer.
5. Normalize `/models` behavior if needed.
6. Update and run the focused tests.

## Validation
- `npm -C web run test -- --run src/components/FlexInfer/Workbench.test.tsx`
- `npm -C web run test -- --run src/AppLayout.test.tsx`
- `npm -C web run test -- --run src/components/shared/OperationsSidebarNav.test.tsx`
- `npm -C web run lint`

If a dedicated primitive test file does not exist yet, create one as part of M5 and replace the placeholder command above with the actual path.

## Risks And Mitigations
- Risk: migrating FlexInfer first but not updating the primitive cleanly leaves duplicate sidebar implementations.
  - Mitigation: define the primitive API before consumer migration, then keep FlexInfer as the first adopter.
- Risk: keeping both `/models` and `/flexinfer` indefinitely preserves ambiguity.
  - Mitigation: decide explicitly whether aliasing is temporary or permanent and document it in code comments/tests.
- Risk: router-safe URL state becomes over-engineered.
  - Mitigation: default to the smallest mechanism that preserves sharable state; if URL persistence is not valuable, prefer in-memory tab state over clever URL composition.

## Delivery Recommendation
Start with a small implementation branch focused only on:
- `web/src/components/FlexInfer/Workbench.tsx`
- `web/src/components/shared/OperationsSidebarNav.tsx`
- `web/src/components/FlexInfer/Workbench.test.tsx`
- any new primitive test file

Only pull route-wrapper files such as `web/src/index.tsx` into scope if canonical path cleanup is required to finish the fix cleanly.

## RALPH Addendum: FlexInfer Route-Stable Navigation (2026-05-17)

- Roadmap milestone: Phase 3 Deep FlexInfer integration, workbench operator-surface stability.
- Spec section(s): FlexInfer section navigation and shared sidebar primitive.
- Prior decisions preserved: keep `/flexinfer` as the primary route while retaining `/models` as a compatibility route; keep the workbench as a tabbed shell with one visible operator lane.
- Scope in: router search-param section state, link-capable `OperationsSidebarNav`, focused workbench and primitive regression tests.
- Scope out: broad router migration, visual redesign, `/models` removal, unrelated legacy model surface cleanup.
- Acceptance criteria: section changes preserve the `/flexinfer` route, active section loads from `?section=`, old scroll coupling does not run on lane switches, and the sidebar primitive still supports button-mode consumers.
- Validation: focused Vitest coverage passed, the full frontend test suite passed, `npm -C web run typecheck` passed, `npm -C web run lint` passed with 8 pre-existing warnings outside this slice, and a browser smoke confirmed direct-load/click behavior on the FlexInfer section route.

## Sources
- `web/src/index.tsx:3-47`
- `web/src/lib/featureFlags.ts:38-68`
- `web/src/hooks/useKeyboardShortcuts.ts:25-34`
- `web/src/components/QuickLaunch/CommandPalette.tsx:44-50`
- `web/src/components/FlexInfer/Workbench.tsx:156-215`
- `web/src/components/FlexInfer/Workbench.tsx:391-472`
- `web/src/components/FlexInfer/Workbench.tsx:444-468`
- `web/src/components/FlexInfer/Workbench.tsx:1186-1200`
- `web/src/components/shared/OperationsSidebarNav.tsx:3-86`
- `web/src/components/FlexInfer/Workbench.test.tsx:236-346`
