# Iteration Plan — flexdeck Loom Control Plane (2026-06-30)

> **Canonical plan lives in the Loom plan store** (worktree-resilient, recall from
> any agent): `plan-flexdeck-loom-control-plane-unify-mills-projects-plans-fleet-a6d766`
> — `agent_plan_get`. This file is a concise in-repo mirror for MR review.

## Goal

Expand flexdeck's existing "Loom HUD" surface into a first-class SolidJS control
plane for **mills, projects, plans, fleet, and flightdeck** — a unified alternative
to the Svelte loom-hud in loom-core, integrating the flexinfer platform in one
frontend.

## Why an expansion, not a greenfield

flexdeck already proxies `/api/hud/*` → `LOOM_HUD_URL` and federates `/api/projects`
from Qdrant (`agent_plans_v1`, `agent_plan_slices_v1`, `pm_risks`, `agent_tasks_v1`) +
GitLab. Plans are **already read from Qdrant** inside the Projects drill-in
(`internal/api/handlers/projects.go`). Mills and a standalone Plans view are the
real new surfaces.

## Federation map (how flexdeck reaches each entity)

| Entity | Source | Notes |
|---|---|---|
| Plans | Qdrant direct `agent_plans_v1` + `agent_plan_slices_v1` | proven |
| Projects / Risks | Qdrant `pm_risks` + `agent_tasks_v1` + GitLab | live |
| Mills | `loom-mills-operator` REST `/api/mills/*` | NEW direct client |
| Fleet / sessions / handoffs / workflows | HUD passthrough `LOOM_HUD_URL` | live |
| Flightdeck (stalls + ledger) | loom-flightdeck — needs ~6 thin JSON endpoints | NEW upstream + proxy |

## Riskiest assumption — kill-test PASSED 2026-06-30

**Assumption**: flexdeck's pod can federate mills + plans over HTTP without new
upstream APIs. **Trap**: `LOOM_HUD_URL=http://mobile-hud.loom-hub.svc.cluster.local`
is the *companion* API (no `/api/plans`, no `/api/mills/*`); the full daemon HUD does
not run in-cluster. So **federate direct**: Qdrant for plans, mills-operator REST for
mills — never via the HUD passthrough.

**Kill-test result** (in-cluster, from pod `flexdeck-5cc5cdd8f5-cq5cc`):
- ✅ `loom-mills-operator.loom-mills.svc.cluster.local:8090` `/api/mills/status` green
  (autonomy_ready, policy v2), `/api/mills/backlog` returns live items with
  `Slices` + `PlanID`. Read endpoints open; mutations need `LOOM_MILLS_ADMIN_TOKEN`.
- ✅ Qdrant `agent_plans_v1` = 33 plans, `agent_plan_slices_v1` = 85 slices (green);
  `pm_risks` = 0.
- ✅ `LOOM_HUD_URL` = mobile-hud companion (confirmed). flightdeck svc =
  `loom-flightdeck.loom-flightdeck.svc.cluster.local:80`. Mills port is **8090**.

## Architecture

A new `/api/loom/*` backend namespace federates four read sources behind one typed
frontend client:
1. HUD passthrough (existing) — fleet/sessions/handoffs/workflows/timeline.
2. Qdrant direct (existing `internal/qdrant`) — plans/projects/risks.
3. loom-mills-operator REST (new `internal/loomupstream` client, `MILLS_OPERATOR_URL`).
4. loom-flightdeck JSON API (new upstream + proxy, `FLIGHTDECK_URL`+token).

Frontend IA: a **Loom** section — Fleet · Projects · Plans · Mills · Flightdeck —
reusing `HUDConsoleScaffold`, `TabBar`, `DataTable`, `DetailPanel`, `createPolling`.

## Slices

1. **Foundation + reachability kill-test (GATE)** — `/api/loom/*` layer, mills client,
   `/api/loom/health`, Loom section shell. *Kill-test PASSED; in progress.*
2. **Plans surface** (read-only) — list + slice DAG + riskiest-assumption/kill-test.
3. **Mills surface** (read-only) — Backlog · Pipelines(+stages) · Council(+debate) ·
   Eval · Squads · Audit · Policy.
4. **Fleet + Projects consolidation** — one coherent Loom section + cross-entity links.
5. **Flightdeck integration** (fast-follow, cross-repo) — Stall Board + Context Ledger.
6. **Mutations + RBAC** (later) — safe writes → mills autonomy control, admin-gated.

## Scope defaults (overridable)

First wave = Plans + Mills + Projects + Fleet (slices 1–4); Flightdeck fast-follow (5);
read-only first, mutations RBAC-gated later (6); complement the Svelte HUD now, parity
+ deprecation as a follow-up.
