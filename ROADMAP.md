# FlexDeck Roadmap

> Last Updated: 2026-08-01
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

FlexDeck is the Go + SolidJS dashboard for the flexinfer.ai homelab. It covers
K8s workloads, Flux GitOps, FlexInfer, observability, Stack Explorer, and the
Loom control plane. The inspected last-20 commit window (2026-07-12 →
2026-07-25, `git log origin/main -20`) shows:

- topology/HoloDeck performance work and cross-entity deep-link integrity
- Pipeline URL state, command-palette accessibility, and consistency cleanup
- explicit stale Loom snapshot disclosure
- trusted-LAN access with ingress-header hardening
- keyboard-accessible table sorting

Earlier July slices shipped Stack library version-drift detection, workload
failure reasons plus Jobs/CronJobs, and the Projects risk lifecycle. The
completed FlexInfer route-stability spec retains hash-router regression tests.
It is no longer active backlog.

- **Plan store**: `plan-workspace-portfolio-refresh-2026-h2-roadmaps-quality-baselin-f3db23` remains active. Its monitoring slice is pending, and its functional-health baseline is implementing.
- **Deployed**: k3s via Flux (flexdeck backend + web frontend). The live [health endpoint](https://deck.flexinfer.ai/api/health) returned `ok=true` on 2026-08-01.
  - RBAC is enabled.
  - Mills mutations remain dark-launched.
  - Audit Logs and Multi-Cluster remain disabled.
- **CI**: platform/gitops Go template family. Default-branch [pipeline 20763](https://gitlab.flexinfer.ai/services/flexdeck/-/pipelines/20763) passed for `2759e26` on 2026-07-25.

## Now

- [ ] Decide whether to enable the RBAC-gated Mills operational controls (#31, P2).
  - Prerequisites: provision a valid admin token, approve the rollout, and set `LOOM_MILLS_MUTATIONS_ENABLED=true`.
  - Preflight: loom-core exposes an admin-gated `route-test` diagnostic dry-run. It requires a squad and backlog item.
  - FlexDeck gap: it does not proxy that diagnostic. FlexDeck first observes upstream token validity on a mutation.
- [ ] Decide whether to enable Audit Logs (#31, P2).
  - Prerequisites: configure and verify the backing store, approve the rollout, and set `AUDIT_DISABLED=false`.
- [ ] Decide whether to enable Multi-Cluster (#31, P2).
  - Prerequisites: configure and verify its backing dependencies, approve the rollout, and set `MULTICLUSTER_DISABLED=false`.

## Next

The linked cross-repo plan separately owns monitoring and functional-health
work. Execute those slices through the canonical plan store. No additional #31
product-code slice is queued.

After an operator approves one decision above, define a bounded rollout slice
in #31. Include prerequisites, smoke checks, rollback criteria, and an owner.

## Later

No additional capability is accepted as Later work in this mirror. Add future
work to the P-labeled GitLab backlog before promoting it into this roadmap.

## Backlog

Full backlog: [P1 issues](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/?label_name%5B%5D=P1) ·
[P2](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/?label_name%5B%5D=P2) ·
[P3](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/?label_name%5B%5D=P3) ·
[Milestones](https://gitlab.flexinfer.ai/services/flexdeck/-/milestones)
