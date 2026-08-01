# Loom Context Pack

## Current Goal (2026-08-01)
- Keep roadmap and spec artifacts aligned with shipped behavior and live deployment state.
- Treat the completed FlexInfer route-stability plan as history instead of pseudo-backlog.
- Preserve the remaining rollout decisions as operator-owned work. They require explicit prerequisites and approvals.

## Current Status Summary (2026-08-01)
- `main` and `origin/main` are at `2759e26`. Default-branch pipeline `20763` passed for that revision.
- The live health response returned `ok=true` on 2026-08-01. RBAC is enabled. Mills mutations remain dark-launched. Audit Logs and Multi-Cluster remain disabled.
- GitLab issue #31 is the only open issue (`P2`, `roadmap`). There are no open P1 issues.
- All user-visible criteria are satisfied. The original shared-handler criterion is an accepted, documented deviation.
- The linked cross-repo plan separately retains pending monitoring work and an implementing functional-health baseline.
- FlexInfer route-stable navigation shipped in `633f782`. It includes search-parameter state, shared sidebar modes, and production-equivalent router coverage.
- Stack library contract version-drift detection shipped in `58f79fc`; it is no longer Later work.
- The next #31 increment requires an explicit operator decision and rollout plan. Dormant code does not imply rollout authorization.

## Quick Links

- MCP inventory: `00-mcp-inventory.md`
- Research: `10-research.md`
- Product spec: `20-product-spec.md`
- Implementation plan: `30-implementation-plan.md`
- Current RALPH iteration: `31-iteration-plan-roadmap-truth-reconciliation-2026-08-01.md`
- Current RALPH handoff: `42-slice-handoff-roadmap-truth-reconciliation-2026-08-01.md`
- Decisions: `40-decisions.md`
- Worklog: `50-worklog.md`

## Success Criteria For This Cycle
- `ROADMAP.md` reflects current `main`, live health, and the canonical backlog. It does not list shipped features as future work.
- The FlexInfer product spec and implementation plan are explicitly marked complete.
- Code-complete and deployment-enabled states are kept distinct.
- The handoff names one bounded operator-decision follow-up and its blockers.

## Risks
- This documentation refresh grants no authorization to enable flags or provision credentials.
- The health response is a dated snapshot, not a guarantee of future deployment state.
- FlexDeck does not proxy loom-core's non-mutating `route-test` token preflight.

## Sources
- `git log origin/main -20 --date=short --pretty=format:'%h %ad %s'`
- `GET https://deck.flexinfer.ai/api/health` (2026-08-01)
- [GitLab issue #31](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/31)
- [Default-branch pipeline 20763](https://gitlab.flexinfer.ai/services/flexdeck/-/pipelines/20763)
- `agent_plan_get(plan_id="plan-workspace-portfolio-refresh-2026-h2-roadmaps-quality-baselin-f3db23")`
- `git show --stat 633f782`
- `git show --stat 58f79fc`
- `git -C ../loom-core show --stat 2971df9b`
- `../loom-core/cmd/loom-mills-operator/handlers_squads.go:233-297`
- `.loom/30-implementation-plan.md`
- `.loom/50-worklog.md`
