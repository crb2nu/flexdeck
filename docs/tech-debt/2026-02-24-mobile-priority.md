# Technical Debt Priority Ranking

Scored using weighted model: impact 35%, risk reduction 30%, drag reduction 20%, effort inverse 15%.

| Rank | ID | Title | Issue | Component | Impact | Risk | Drag | Effort | Score |
|---:|---|---|---|---:|---:|---:|---:|---:|
| 1 | MOB-001 | Mobile Navigation / Hamburger Menu | [#26](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/26) | Navigation | 1.00 | 0.40 | 0.80 | 2.0 | 75.00 |
| 2 | MOB-004 | Layout Refinement for Small Viewports (<375px) | [#29](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/29) | Shared UI | 0.60 | 1.00 | 0.40 | 2.0 | 71.00 |
| 3 | MOB-003 | Touch Interaction Support for Visualizations | [#28](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/28) | HoloDeck | 0.80 | 0.60 | 0.60 | 3.0 | 67.00 |
| 4 | MOB-002 | Responsive Sidebar / Drawer for Widgets | [#27](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/27) | Dashboard | 0.80 | 0.40 | 0.60 | 3.0 | 61.00 |
| 5 | MOB-005 | Low-Power Device Auto-Detection / Quality Tuning | [#30](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/30) | HoloDeck | 0.60 | 0.80 | 0.40 | 4.0 | 59.00 |

## Suggested Cut Lines

- Wave 1: top 20-30% by score, low dependency risk
- Wave 2: next 30-40%, medium effort and moderate coupling
- Wave 3: remaining strategic refactors with cross-team dependencies
