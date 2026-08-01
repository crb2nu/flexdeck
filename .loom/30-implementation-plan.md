# Implementation Plan — FlexInfer Route-Stable Section Navigation (2026-04-12)

> Status: Completed on `main`
> Shipped: `633f782` (`fix(flexinfer): stabilize sidebar routing`)
> Completion: The M1–M5 user-visible outcomes and validation gates are complete.
> M2 uses one route-state contract through separate callback/link mechanisms,
> not one shared JavaScript handler. This semantic deviation is accepted.
> There is no remaining implementation slice in this plan; current rollout
> decisions are tracked in `ROADMAP.md` and GitLab issue #31.
> Lifecycle: Sections before the RALPH addendum preserve the original plan in
> completed form. They do not describe current defects or pending tasks.

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

## Root Cause Addressed

At planning time, the app used `HashRouter` while the FlexInfer workbench also
treated `window.location.hash` as section state. Sidebar changes could overwrite
the route fragment. The shared sidebar supported only button callbacks.

Commit `633f782` removed that conflict. The workbench now uses search-parameter
state, and the sidebar supports both button callbacks and router-aware links.

## Implemented Shape

The shipped workbench remains a tabbed shell and does not claim raw fragment
ownership for section state.

Why this shape was chosen:
- inactive sections were already hidden, so the UI was a tabbed panel shell rather than an anchored document: `web/src/components/FlexInfer/Workbench.tsx:635`, `web/src/components/FlexInfer/Workbench.tsx:729`
- removing the hash/scroll layer is a smaller, lower-risk fix than converting the screen into a real anchor document
- a tabbed-shell model maps cleanly onto a shared sidebar primitive that can render either buttons or router links

## Completed Milestones

### M1. Introduce Router-Safe Section State — Complete
- Ownership:
  - `web/src/components/FlexInfer/Workbench.tsx`
- Delivered:
  - replaced the raw-hash helpers with router-aware section state
  - used router search parameters without writing section fragments into `window.location.hash`
  - removed the `hashchange` listener and bare-hash ownership
- Evidence:
  - the active FlexInfer route remains intact before and after section changes

### M2. Remove Tab/Scroll Hybrid Behavior — Complete
- Ownership:
  - `web/src/components/FlexInfer/Workbench.tsx`
- Delivered:
  - deleted section scrolling that only supported the old hash flow
  - routed overview cards through `changeSection` and the sidebar through links
  - kept both mechanisms on the same route-safe `?section=` contract
  - retained the one-active-section layout
- Evidence:
  - section switches no longer schedule unnecessary scroll movement or URL churn

### M3. Upgrade `OperationsSidebarNav` — Complete
- Ownership:
  - `web/src/components/shared/OperationsSidebarNav.tsx`
  - consumers in `web/src/components/FlexInfer/Workbench.tsx`
  - optional spot-check consumer in `web/src/components/Agents/index.tsx`
- Delivered:
  - extended the item contract so a consumer can supply either:
    - `onChange`/button behavior
    - link metadata for router-aware navigation
  - preserved styling and active-state visuals across both interaction modes
  - migrated FlexInfer to router-aware links
  - left button-mode consumers unchanged
- Evidence:
  - the primitive no longer forces deep-linkable navigation to masquerade as a button list

### M4. Canonical Path Cleanup — Complete
- Ownership:
  - `web/src/index.tsx`
  - optional helper sites that still encode legacy naming
- Delivered:
  - kept `/flexinfer` canonical
  - retained `/models` as a compatibility alias
  - preserved nav, command-palette, and keyboard-shortcut targets: `web/src/lib/featureFlags.ts:49`, `web/src/hooks/useKeyboardShortcuts.ts:32`, `web/src/components/QuickLaunch/CommandPalette.tsx:65-72`
- Evidence:
  - route ownership is easier to reason about and no screen relies on ambiguous naming to work

### M5. Regression Tests In Real Routing Mode — Complete
- Ownership:
  - `web/src/components/FlexInfer/Workbench.test.tsx`
  - new shared primitive test file if needed
- Delivered:
  - ran FlexInfer tests with production-equivalent hash routing
  - asserted route preservation during section changes
  - asserted direct loading with existing section state
  - added direct primitive link-mode coverage
- Evidence:
  - tests fail if raw fragment replacement comes back

## Delivered Execution Order

1. Added router-safe section state in FlexInfer.
2. Removed hashchange and scroll coupling from the workbench.
3. Upgraded `OperationsSidebarNav` with link-capable navigation.
4. Adopted the new primitive mode in FlexInfer.
5. Retained `/models` as a compatibility alias.
6. Updated and ran the focused tests.

## Validation
- `npm -C web run test -- --run src/components/FlexInfer/Workbench.test.tsx`
- `npm -C web run test -- --run src/AppLayout.test.tsx`
- `npm -C web run test -- --run src/components/shared/OperationsSidebarNav.test.tsx`
- `npm -C web run lint`

The dedicated primitive coverage lives in
`web/src/components/shared/OperationsSidebarNav.test.tsx`.

## Risks And Mitigations (Closed)
- Risk: link semantics could create duplicate sidebar implementations.
  - Mitigation: one shared primitive now supports button and link modes.
- Risk: `/models` and `/flexinfer` could remain ambiguous.
  - Mitigation: `/flexinfer` is canonical, while `/models` remains a tested compatibility alias.
- Risk: router-safe state could become over-engineered.
  - Mitigation: the implementation uses one `?section=` search parameter.

## Original Delivery Recommendation (Completed)

The implementation branch remained focused on:
- `web/src/components/FlexInfer/Workbench.tsx`
- `web/src/components/shared/OperationsSidebarNav.tsx`
- `web/src/components/FlexInfer/Workbench.test.tsx`
- any new primitive test file

Route-wrapper files remained unchanged because the existing canonical path and
compatibility alias satisfied the acceptance criteria.

## RALPH Addendum: FlexInfer Route-Stable Navigation (2026-05-17)

- Roadmap milestone: Phase 3 Deep FlexInfer integration, workbench operator-surface stability.
- Spec section(s): FlexInfer section navigation and shared sidebar primitive.
- Prior decisions preserved: keep `/flexinfer` as the primary route while retaining `/models` as a compatibility route; keep the workbench as a tabbed shell with one visible operator lane.
- Scope in: router search-param section state, link-capable `OperationsSidebarNav`, focused workbench and primitive regression tests.
- Scope out: broad router migration, visual redesign, `/models` removal, unrelated legacy model surface cleanup.
- Acceptance criteria: section changes preserve the `/flexinfer` route, active section loads from `?section=`, old scroll coupling does not run on lane switches, and the sidebar primitive still supports button-mode consumers.
- Accepted deviation: sidebar links and overview cards share the `?section=` contract, but not one handler.
- Validation: focused Vitest coverage passed, the full frontend test suite passed, `npm -C web run typecheck` passed, `npm -C web run lint` passed with 8 pre-existing warnings outside this slice, and a browser smoke confirmed direct-load/click behavior on the FlexInfer section route.

## Sources
- `web/src/index.tsx:38-47`
- `web/src/components/FlexInfer/Workbench.tsx:105-110`
- `web/src/components/FlexInfer/Workbench.tsx:185-195`
- `web/src/components/FlexInfer/Workbench.tsx:525-586`
- `web/src/components/FlexInfer/Workbench.tsx:695-725`
- `web/src/components/shared/OperationsSidebarNav.tsx:74-95`
- `web/src/components/shared/OperationsSidebarNav.tsx:127-167`
- `web/src/components/FlexInfer/Workbench.test.tsx:246-255`
- `web/src/components/FlexInfer/Workbench.test.tsx:378-443`
- `web/src/components/shared/OperationsSidebarNav.test.tsx:53-119`
