# Brainstorm: Local Stack Support For Services And Libs

**Date**: 2026-06-06
**Triggered by**: User asked to brainstorm FlexDeck feature additions and enhancements that better support the local stack under `services/` and `libs/`.
**Constraints noted**: Preserve FlexDeck's Go/Chi backend and SolidJS/Tailwind frontend; keep edits and future implementation scoped to FlexDeck unless a later plan explicitly chooses cross-repo work; use `WORKSPACE_DIR` as the local integration root; start read-only for workspace scans, process state, and repo metadata; do not read secrets or local secret files. Observed local stack includes services such as `flexinfer`, `loom-core`, `loom`, `fi-mcp-gateway`, `mcp-orchestra`, `mcp-sandbox`, `k8s-cost-prophet`, `project-management`, and `tech-radar`, plus libs such as `visual-kit`, `fi-accel`, `fi-mcp-kit`, `py-codebase-memory`, `py-observability`, `py-resilience`, `ts-resilience`, `fractal-agents`, and `langgraph-agents`.

## Phase 1 - Framings

### F1 - Workspace Stack Inventory

Give FlexDeck a first-class local workspace index: scan `WORKSPACE_DIR/services` and `WORKSPACE_DIR/libs` for repo name, bucket, language manifests, git branch, dirty state, remotes, `AGENTS.md`, `README.md`, `ROADMAP.md`, `.loom/` docs, worktree count, and likely dev/test commands. The UI becomes a "Stack" view where each service or lib has an operator card instead of being discovered through terminal memory.

- **Bet**: Local-stack support starts with making the actual workspace shape visible, current, and searchable.
- **Risk**: Repo scanning can become slow, noisy, or privacy-sensitive if it expands beyond manifest and git metadata.

### F2 - Service-To-Cluster Binding

Correlate local repos to live Kubernetes and Flux resources: deployments, jobs, services, ingresses, HelmReleases, Kustomizations, GitRepositories, container images, labels, namespaces, current revisions, and pod health. The operator question becomes "what is this repo doing in the cluster right now?" rather than "which tab should I check next?"

- **Bet**: The hardest local-stack problem is not viewing repos or pods separately, but binding local code, GitOps state, CI status, and live workloads into one entity.
- **Risk**: Existing labels, image tags, and Flux metadata may be inconsistent enough that automatic correlation needs opt-in hints such as `.flexdeck.yaml`.

### F3 - Library Adoption And Drift

Build a dependency map from services to local libs using `go.mod`, `package.json`, `pyproject.toml`, and `Cargo.toml`. Surface which services consume `visual-kit`, `fi-accel`, `fi-mcp-kit`, `py-observability`, `py-resilience`, `ts-resilience`, and related packages; flag version drift, unpublished local changes, missing package builds, and token/component drift from `visual-kit`.

- **Bet**: The `libs/` bucket is becoming a platform layer, so FlexDeck should show which services actually depend on it and where the contracts are stale.
- **Risk**: Some local usage may be path-based, generated, vendored, or implicit through imports, which makes manifest-only detection incomplete.

### F4 - MCP And Loom Mesh Operations

Extend the existing Loom HUD surface into an MCP/tooling mesh view. Show MCP gateway health, server registry entries, tool availability, policy/auth state, orchestra task DAGs, sandbox status, active agents, file claims, and recent tool failures. This would connect `loom-core`, `loom`, `fi-mcp-gateway`, `fi-mcp-kit`, `mcp-orchestra`, and `mcp-sandbox` into the same operational vocabulary FlexDeck already uses for agents.

- **Bet**: The local stack is increasingly tool-mediated, and operators need to know whether the agent/tool fabric is healthy before trusting automation.
- **Risk**: This can duplicate Loom HUD if FlexDeck does not clearly stay at the "operator overview and cross-system correlation" layer.

### F5 - Local Dev Process Cockpit

Detect local dev servers, ports, health endpoints, logs, and repo commands, then show them beside the service cards. A future controlled mode could start or stop known commands (`make dev`, `npm run dev`, `go run`, `uv run`) from explicit per-repo config, but the first version should be observational: "running on port 5173", "backend health failing", "Vite log changed 2m ago".

- **Bet**: The fastest improvement to daily local work is knowing what is already running, where it is bound, and why a dev surface is unreachable.
- **Risk**: Process control from a dashboard can become hazardous unless it is opt-in, auditable, and scoped to known repo commands.

### F6 - Contract And Telemetry Coverage

Create a cross-stack contract radar: expected Prometheus metrics, Loki labels, Langfuse traces, HTTP propagation headers, circuit breaker names, retry policies, and OpenAPI/MCP contracts by service. Use `py-observability`, `py-resilience`, `ts-resilience`, FlexInfer metric families, and existing FlexDeck health semantics as the source of what "instrumented" should mean.

- **Bet**: Supporting a local stack means seeing where observability and resilience contracts are missing before failures become mystery debugging sessions.
- **Risk**: Coverage inference can produce false confidence if it checks for packages or config but not runtime behavior.

### F7 - Cost And Capacity Planner

Fuse `k8s-cost-prophet`, Kubernetes resource requests, Prometheus history, and FlexInfer GPU metrics into a capacity lens for the local cluster. Show per-service CPU/memory/GPU pressure, model placement consequences, VRAM headroom, "what if I scale this?" estimates, and waste warnings for idle workloads.

- **Bet**: The local stack includes GPU-heavy AI workloads, so resource fit and cost/capacity pressure are product problems, not just infrastructure trivia.
- **Risk**: Estimates are only useful if the resource model is calibrated to the actual local cluster and mixed GPU hardware.

### F8 - Release Readiness Matrix

Combine GitLab CI, local git state, configured quality gates, and repo type detection into a "what can ship?" matrix across services and libs. Show dirty branches, failing CI, missing test config, stale generated assets, unmerged worktrees, and optional local command results. Let `tech-radar`, `project-management`, `.loom/` docs, and repo ROADMAPs add context, but keep the main view operational.

- **Bet**: A dashboard that shows ready/not-ready across the stack helps choose the next action faster than checking one repo at a time.
- **Risk**: Running tests or builds across many repos is expensive and intrusive unless the initial slice is metadata-only with explicit opt-in execution.

## Phase 2 - Cross-Pollinations & Tensions

### Combinations

- **F1 + F2 + F8**: A local stack control plane emerges: each service/lib card shows repo metadata, local git state, live cluster binding, GitOps/CI status, and release readiness in one place. This is more valuable than a standalone repo browser because it answers "what is this thing and is it healthy?"
- **F3 + F6 + F4**: A platform contract radar emerges: shared libs define the expected reliability, observability, MCP, and UI-token contracts; service cards show adoption and runtime proof. This turns libraries from passive code into visible platform obligations.
- **F5 + F7**: A dev capacity guard emerges: local process state is shown with port conflicts, resource pressure, and GPU/cost consequences before the user starts another service or model.

### Tensions

- **F5 vs. F1/F8**: Process control wants immediacy, while workspace inventory and release readiness want safety. The real axis is "observe first" versus "operate from the dashboard."
- **F2 vs. F3**: Service-to-cluster binding is service-first and operational; library adoption is platform-first and architectural. Choosing the first slice depends on whether the pain is runtime confusion or dependency drift.
- **F4 vs. existing Loom HUD**: FlexDeck already has HUD integration, so MCP mesh work must clarify cross-system status instead of rebuilding Loom's native UI.

## Phase 3 - Convergence

### Recommended: F1 + F2 + F8

Start with a read-only local stack control plane. FlexDeck already has `WORKSPACE_DIR`, Kubernetes, Flux, GitLab CI, Loom HUD, health/freshness semantics, and a dashboard-oriented frontend; the missing product layer is correlation. A narrow first slice can add workspace discovery and service/lib cards, then bind known repos to CI and cluster resources where confidence is high. This supports the actual local stack immediately without requiring risky process control or cross-repo changes.

### Runner-up: F3 + F6

Build library adoption and contract coverage first if the main pain is drift across `libs/` and inconsistent instrumentation rather than day-to-day runtime operations. This would be especially strong for `visual-kit`, `fi-accel`, `fi-mcp-kit`, `py-observability`, and the resilience libraries, but it needs better evidence about which contracts matter most before it should outrank the service-centric control plane.

### Open question

For the first implementation slice, is the sharper pain "what local service/lib maps to what running/CI/GitOps state?" or "which shared libs and runtime contracts are drifting across services?"

## Riskiest assumption + kill-test

> Every brainstorm-derived plan must surface its riskiest load-bearing assumption explicitly. See the `spec-riskiest-assumption` skill.

**Load-bearing assumption**: FlexDeck can derive enough useful local-stack metadata from `/Users/cblevins/workspace/services` and `/Users/cblevins/workspace/libs` using read-only manifest and git scans, plus existing K8s/Flux/GitLab/HUD APIs, without requiring every repo to add new config before the first UI is useful.

**Kill test**: In 30 minutes or less, prototype a read-only scanner that walks only top-level repos under `services/` and `libs/`, reads manifests plus `AGENTS.md`/`README.md`/`ROADMAP.md` presence, captures `git status --short --branch` and remotes with timeouts, and emits JSON. The prototype passes if it classifies at least 30 repos, identifies their primary language/package manager, marks dirty/clean state, and produces at least 10 plausible service-to-CI or service-to-cluster binding candidates by repo name, label, image, or remote URL, all without reading secret paths or arbitrary source files.

**Failure mode if wrong**: FlexDeck would build a nice-looking Stack view around incomplete or misleading correlations; the product should then pivot to an explicit `.flexdeck.yaml` registry or consume a stronger upstream source such as Loom/core workspace inventory, tech-radar scan output, or codebase-memory metadata.

**Status**: not run

> The downstream slice plan is BLOCKED until this kill-test passes.
> Pair it with at least one disconfirming-search query or local negative probe before declaring the assumption verified.

## Handoff

- If chosen -> next step is: `plan-loom-core` for a product spec and implementation plan, with the scanner kill-test before committing to UI shape.
- Linked spec/plan doc (fill in once it exists): `<.loom/NNN-...md>`
