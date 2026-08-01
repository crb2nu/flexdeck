# Product Spec — FlexInfer Navigation Stability And Shared Sidebar Primitive Upgrade (2026-04-12)

> Status: Completed on `main` with one documented implementation deviation
> Shipped: `633f782` (`fix(flexinfer): stabilize sidebar routing`)
> Closeout: The production-equivalent `HashRouter` workbench tests and shared
> sidebar tests cover the user-visible contract. Overview cards use the local
> `changeSection` callback, while sidebar links navigate declaratively. Both use
> the same `?section=` router contract rather than one shared function.
> Lifecycle: The requirements below remain the accepted historical contract.

## Summary
Fix the FlexInfer page so section changes do not fight the app router, do not flicker, and do not break deep links. Use that work to harden the shared sidebar primitive so it can support both local button-style panels and router-aware link navigation without forcing every screen into the same interaction model.

## Goals
1. Eliminate FlexInfer route flicker caused by section navigation.
2. Make FlexInfer sidebar items behave as real navigation, not just state toggles.
3. Keep `/flexinfer` as the canonical entry point while preserving `/models` compatibility.
4. Upgrade the shared sidebar primitive so other screens can opt into proper link semantics when needed.
5. Cover the fix with tests that reflect the same routing mode production uses.

## Non-Goals
- Replacing `HashRouter` across the whole app.
- Redesigning the full FlexInfer visual language.
- Removing every legacy `/models` reference in one pass.
- Refactoring unrelated shared primitives unless they are needed to support the sidebar fix.

## User Stories
- As an operator, when I click a section in the FlexInfer sidebar, the active lane changes without route flicker or jumping to the wrong page.
- As an operator, when I reload or share the FlexInfer page, the URL remains valid and lands on the intended screen.
- As a developer, I can use the same sidebar primitive for both state-only sections and router-backed links without cloning styles into bespoke components.

## Functional Requirements

### FR1. Canonical FlexInfer Route
- `/flexinfer` remains the primary route exposed by app nav, command palette, and keyboard shortcuts.
- `/models` continues to resolve to the same screen during the migration window.
- The implementation should define whether `/models` stays as an alias or is normalized to `/flexinfer` via replace-style navigation.

### FR2. Router-Safe Section State
- FlexInfer section selection must stop writing raw values into `window.location.hash`.
- If section state remains URL-addressable, it must use a router-aware mechanism that composes with `HashRouter` instead of overwriting it.
- Section changes must not discard the underlying route.

### FR3. Stable Workbench Interaction Model
- FlexInfer should use one coherent model:
  - tabbed shell with one active section visible at a time, or
  - scroll-linked document with anchorable sections
- The recommended default is the tabbed-shell model because the current UI already hides inactive sections.
- Any scrolling behavior that only exists to support the old hash model should be removed.

### FR4. Shared Sidebar Primitive Upgrade
- `OperationsSidebarNav` should support both:
  - button mode for local state changes
  - link mode for route-aware navigation
- The primitive should keep one visual treatment across both modes so screens do not fork styling just to get correct semantics.

### FR5. Regression Coverage
- Tests must cover the FlexInfer navigation flow under a router configuration that matches production hash routing.
- Tests must verify that section changes preserve the FlexInfer route while updating whatever state marker replaces the old hash behavior.
- The primitive should gain direct behavior coverage for at least one button-mode consumer and one link-mode consumer, or equivalent focused unit coverage.

## Acceptance Criteria
- Clicking FlexInfer sidebar items no longer causes route loss or visible route flicker.
- A section change preserves the FlexInfer route and updates the active workbench state consistently.
- Overview focus cards and sidebar items use the same section-change path.
  - Accepted deviation: they use separate callback/link mechanisms over the same route-safe `?section=` contract.
- `OperationsSidebarNav` can render router-aware links without breaking existing button-mode consumers.
- Tests fail if a future change reintroduces bare-fragment replacement under `HashRouter`.

## UX Notes
- The current sidebar visuals are serviceable; the important change is semantic correctness and motion stability.
- Link-mode items should retain the current visual affordances for active state, value badges, and grouped headings.
- FlexInfer should avoid scroll-jump behavior unless the page is intentionally redesigned as a multi-section document.

## Risks
- If link semantics are added directly into the primitive without a clean API, Agents and other current button-mode consumers may pick up accidental behavior changes.
- If `/models` is removed too aggressively, older bookmarks or muscle memory may break.
- If tests continue to run outside the real routing mode, the regression can return unnoticed.

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
