# FlexDeck Roadmap

> Last Updated: 2026-07-02
> Tier: 1 (see workspace AGENTS.md "Portfolio Tiers")
> Tracking Issue: https://gitlab.flexinfer.ai/services/flexdeck/-/issues/31

<!--
Convention (portfolio-refresh 2026-H2, see libs/STANDARDS.md "Roadmap & Backlog"):
- This file states CURRENT TRUTH, derived from git activity and deployed state —
  never re-date stale content. Each refresh MR must cite its evidence (git-log
  window inspected, deploy-state query used).
- Backlog lives in GitLab issues (P1/P2/P3 labels + milestones), NOT in this file.
  This file links the backlog; it does not duplicate it.
- If a live plan exists in the agent-context plan store, reference its plan_id
  here; the store is canonical and this file is a rendered summary.
- Staleness SLO: Tier 1/2 repos must have this file dated within 90 days.
  `bin/portfolio-inventory --roadmaps` reports conformance.
-->

## Current Status

FlexDeck is the Go + SolidJS dashboard for the flexinfer.ai homelab: K8s
workloads, Flux GitOps visualization, FlexInfer model CRDs and inference
metrics, observability proxies, workspace Stack Explorer, and a fast-growing
Loom control-plane surface. The last-20 commit window (2026-06-30 → 2026-07-02,
`git log origin/main -20`) landed Loom control-plane slices 2–6 (Plans surface,
Mills read-only operator proxy + view, Fleet/Projects consolidation into the
Loom section, Flightdeck Stall Board + Context Ledger, and RBAC-gated
dark-launched Mills operational controls), a shared web-primitives rollout
across Pipeline/Dashboard/Models/Logs with app-wide scrolling/viewport fixes,
and the FlexInfer GPU-fleet gaming/node-mode surface. RBAC has been enforcing
in production since 2026-06-17; Audit Logs and Multi-Cluster are implemented
behind flags but off by default.

- **Plan store**: `plan-workspace-portfolio-refresh-2026-h2-roadmaps-quality-baselin-f3db23` (active cross-repo plan)
- **Deployed**: k3s via Flux (flexdeck backend + web frontend)
- **CI**: platform/gitops Go template family; default-branch pipeline success 2026-07-01 at the 2026-07-02 baseline capture

## Now

- [ ] Loom control-plane surface build-out: slices 2–6 merged 2026-06-30 → 07-01, stabilization + follow-through (#31, P2)
- [ ] Shared web-primitives rollout hardening after the 2026-07-02 app-wide adoption (#31, P2)

## Next

- [ ] Enablement decision for the dark-launched, RBAC-gated Mills operational controls (#31)
- [ ] Audit Logs / Multi-Cluster enablement decisions (implemented, off by default) (#31)
- [ ] Pod-level workload health reasons (crashloop/imagepull) + Jobs/CronJobs in service-to-cluster binding (#31)

## Later

- Library contract version-drift detection in Stack Explorer
- Projects risk lifecycle from the UI: status update/close shipped 2026-07-04
  (inline per-risk status control over `PATCH /api/projects/{id}/risks/{riskId}`,
  following the 2026-07-04 inline risk-capture form). Risk links to
  tasks/issues/decisions shipped in the 2026-07-05 risk-linking slice.
  Remaining: inline editing for non-status fields (title, likelihood, impact,
  mitigation, owner) if operators need it.

## Backlog

Full backlog: [P1 issues](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/?label_name%5B%5D=P1) ·
[P2](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/?label_name%5B%5D=P2) ·
[P3](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/?label_name%5B%5D=P3) ·
[Milestones](https://gitlab.flexinfer.ai/services/flexdeck/-/milestones)
