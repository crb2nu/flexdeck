# Mobile Experience Remediation Plan (2026-02-24)

## Summary

- Planning date: 2026-02-24
- Scope: Frontend Navigation, Dashboard Layout, and 3D Visualization Touch Support
- Total items considered: 5

## Scoring Snapshot

- Ranking artifact: `docs/tech-debt/2026-02-24-mobile-priority.md`
- Scoring model: impact 35%, risk reduction 30%, drag reduction 20%, effort inverse 15%

## Wave 1 (Immediate: Accessibility & Foundation)

- Goal: Enable basic navigation and readable layouts for mobile users.
- Items:
  - **MOB-001**: Mobile Navigation / Hamburger Menu. ([Issue #26](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/26))
  - **MOB-004**: Layout Refinement for Small Viewports (<375px). ([Issue #29](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/29))
- Acceptance criteria:
  - Navigation menu accessible via hamburger icon on screens < 768px.
  - Pulse cards and dashboard grid wrap correctly without horizontal overflow on iPhone SE (320px).
- Risks/mitigations:
  - Low technical risk; primarily CSS/layout changes.

## Wave 2 (Near-Term: Interaction & Observability)

- Goal: Restore observability visibility and enable interaction on touch devices.
- Items:
  - **MOB-003**: Touch Interaction Support for Visualizations. ([Issue #28](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/28))
  - **MOB-002**: Responsive Sidebar / Drawer for Widgets. ([Issue #27](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/27))
- Acceptance criteria:
  - Tapping a node/pod in HoloDeck opens the detail panel (replaces hover).
  - Sidebar widgets (Alerts, Events) accessible via a bottom-sheet or toggle on mobile.
- Risks/mitigations:
  - Touch event collision with OrbitControls; require explicit "Inspect" mode or tap-timeout logic.

## Wave 3 (Strategic: Performance Tuning)

- Goal: Ensure smooth performance on low-end mobile hardware.
- Items:
  - **MOB-005**: Low-Power Device Auto-Detection / Quality Tuning. ([Issue #30](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/30))
- Acceptance criteria:
  - App detects mobile environment and defaults HoloDeck to 'low' quality.
  - User can manually toggle back to high quality if desired.
- Risks/mitigations:
  - Device detection can be brittle; prefer feature detection (GPU Tier) or simple user-agent/screen-size heuristics.

## Backlog Conversion

| Debt ID | Backlog ID | Owner | Target Milestone | Status |
|---|---|---|---|---|
| MOB-001 | [#26](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/26) | UI | Q1 | Completed |
| MOB-004 | [#29](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/29) | UI | Q1 | Completed |
| MOB-003 | [#28](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/28) | Frontend | Q1 | Completed |
| MOB-002 | [#27](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/27) | Frontend | Q2 | Completed |
| MOB-005 | [#30](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/30) | Frontend | Q2 | Completed |

## Deferred / Not In Scope

- Native iOS/Android applications (maintain web-first focus).
- Offline mode support.
