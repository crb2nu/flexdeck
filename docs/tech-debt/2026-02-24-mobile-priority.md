# Technical Debt Priority Ranking

Scored using weighted model: impact 35%, risk reduction 30%, drag reduction 20%, effort inverse 15%.

| Rank | ID | Title | Component | Impact | Risk | Drag | Effort | Score |
|---:|---|---|---|---:|---:|---:|---:|---:|
| 1 | MOB-001 | Mobile Navigation / Hamburger Menu | Navigation | 1.00 | 0.40 | 0.80 | 2.0 | 75.00 |
| 2 | MOB-004 | Layout Refinement for Small Viewports (<375px) | Shared UI | 0.60 | 1.00 | 0.40 | 2.0 | 71.00 |
| 3 | MOB-003 | Touch Interaction Support for Visualizations | HoloDeck | 0.80 | 0.60 | 0.60 | 3.0 | 67.00 |
| 4 | MOB-002 | Responsive Sidebar / Drawer for Widgets | Dashboard | 0.80 | 0.40 | 0.60 | 3.0 | 61.00 |
| 5 | MOB-005 | Low-Power Device Auto-Detection / Quality Tuning | HoloDeck | 0.60 | 0.80 | 0.40 | 4.0 | 59.00 |

## Suggested Cut Lines

- Wave 1: top 20-30% by score, low dependency risk
- Wave 2: next 30-40%, medium effort and moderate coupling
- Wave 3: remaining strategic refactors with cross-team dependencies
