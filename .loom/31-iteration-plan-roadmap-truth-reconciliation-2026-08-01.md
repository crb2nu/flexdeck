# RALPH Iteration Plan — Roadmap/Spec Truth Reconciliation

## Review

- Roadmap milestone: issue #31 stabilization/follow-through closeout and rollout-decision queue
- Spec section(s): completed FlexInfer navigation product spec and M1–M5 implementation plan
- Prior decisions to preserve:
  - feature-gated shipped capabilities remain distinct from enabled deployments
  - Mills mutations remain dark-launched until an operator approves the rollout
  - completed planning artifacts must not become pseudo-backlog

## Align

- Slice name: Roadmap/spec truth reconciliation
- Scope in:
  - refresh `ROADMAP.md` through `main` revision `2759e26`
  - record the dated live health and default-branch CI evidence
  - mark the FlexInfer product spec and implementation plan complete
  - distinguish the three remaining operator rollout decisions
  - update the context index and decision journal
- Scope out:
  - feature implementation or refactoring
  - flag changes, credentials, or backing-store configuration
  - cross-repo GitOps changes
  - issue splitting or milestone mutation
- Acceptance criteria:
  - no shipped capability remains described as future implementation work
  - planning artifacts explicitly mark the FlexInfer route-stability slice complete
  - the accepted shared-route-contract deviation is explicit
  - code-complete and deployment-enabled states are clearly separated
  - Mills, Audit Logs, and Multi-Cluster each retain their prerequisite and operator blocker
  - the branch contains documentation/planning changes only
- Dependencies/blockers:
  - evidence: live issue #31, pipeline `20763`, and the 2026-08-01 health response
  - no blocker for this documentation slice
  - future rollouts remain blocked on operator approval and capability-specific prerequisites
  - the cross-repo monitoring slice remains pending behind its portfolio-plan dependencies
  - the cross-repo functional-health baseline is already implementing; do not duplicate it
- Risk notes:
  - do not turn a dated health snapshot into a timeless deployment claim
  - do not imply that this slice authorizes secret handling or flag changes
  - distinguish FlexDeck's proxy gap from loom-core's direct `route-test` dry-run

## Land

- Planned file areas:
  - `ROADMAP.md`
  - `.loom/00-index.md`
  - `.loom/20-product-spec.md`
  - `.loom/30-implementation-plan.md`
  - `.loom/40-decisions.md`
  - RALPH iteration/handoff artifacts
- Implementation steps:
  1. Replace stale roadmap streams and Later items with verified current truth.
  2. Add explicit completion markers to the finished spec and plan.
  3. Record the selection rationale, validation evidence, and next operator-decision handoff.

## Prove

- Tests to run:
  - `go test ./...` as a broad repository baseline
  - focused source/test existence checks for commits `633f782` and `58f79fc`
- Lint/static checks:
  - `git diff --check`
  - `pre-commit run --all-files`
- CI checks:
  - push the branch and verify its GitLab pipeline reaches a successful terminal state

## Handoff/Harvest

- Docs to update: roadmap, context index, completed spec/plan status, decision journal, slice handoff
- Agent-context entries to add: slice decision, live-state finding, completion resolution, and blocked rollout question
- Next-slice candidates:
  - Mills operational-controls rollout decision
  - Audit Logs rollout decision
  - Multi-Cluster rollout decision
