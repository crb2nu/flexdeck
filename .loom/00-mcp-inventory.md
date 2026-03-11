# MCP Inventory (Refreshed 2026-03-03 08:45 EST)

## Addendum (2026-03-06 10:46 EST)

### Scope
- Workspace: `/Users/cblevins/workspace/services/flexdeck`
- Active Loom profile: `full`
- Inventory mode: loom-proxy resources/templates (paged)
- Focus for this cycle: performance planning, Redis usage audit, and Tavily-backed external research

### Runtime Snapshot
- `loom://config` now reports:
  - `serverCount: 45`
  - `toolCount: 472`
  - active profile `full`
- `loom://tools/index` reports:
  - `totalTools: 472`
  - `totalPages: 5`
  - `pageSize: 100`
- Relevant servers confirmed available for this cycle:
  - `tavily`
  - `redis`
  - `codebase_memory`
  - `gitlab`
  - `grafana`
  - `prometheus`
  - `loki`

### Codebase Index Readiness
- Initial semantic index job on repo `services/flexdeck` failed:
  - job `7df1990d849e1bc8`
  - failure: Morph embeddings API returned HTTP 400 (`The decoder prompt cannot be empty`)
- Fallback lexical-only index succeeded:
  - job `7be4645795f5a89f`
  - status `done`
  - `files_total: 217`
  - `chunks_total: 2311`
- Current stats after fallback indexing:
  - `total_chunks: 1952`
  - by language: `go 817`, `typescript 1121`, `javascript 14`
  - by chunk type: `function 863`, `method 396`, `class 359`, `module 217`, `variable 36`

### Operating Notes
- For this session, semantic retrieval should be treated as degraded because embeddings are failing at index time in the current environment.
- Lexical code search and local repo inspection are sufficient for planning, hotspot analysis, and implementation slicing.
- Tavily is available and suitable for external validation of caching, visibility-aware polling, and dashboard UX guidance.

## Scope
- Workspace: `/Users/cblevins/workspace/services/flexdeck`
- Active Loom profile: `full`
- Inventory mode: loom-proxy resources/templates (paged)

## Runtime Mode Detection
- `list_mcp_resources()` returns loom top-level resources:
  - `loom://config`
  - `loom://servers`
  - `loom://tools`
  - `loom://tools/index`
  - `loom://health`
- `list_mcp_resource_templates()` confirms paged endpoints:
  - `loom://tools/page/{page}`
  - `loom://tools/server/{server}/page/{page}`
- Result: loom-mode is active; inventory should use paged `loom://tools/*` resources to avoid truncation.

## Runtime Snapshot
- `loom/config`:
  - `serverCount: 44`
  - `toolCount: 472`
  - `active profile: full`
- `loom/tools/index`:
  - `totalTools: 472`
  - `totalPages: 5`
  - `pageSize: 100`
- `loom/health`:
  - Core planning/ops servers report healthy (`agent_context`, `codebase_memory`, `git`, `gitlab`, `prometheus`, `loki`, `grafana`, `flux`, `k8s_apps_k3s`, `devbox`, `quality`).

## Tool Count Snapshot (Top Servers)
- `agent_context: 80`
- `jobsearch: 66`
- `gitlab: 30`
- `flexinfer: 19`
- `codebase_memory: 17`
- `github/git/devbox: 11 each`

## Index/Search Readiness
- `codebase_memory__codebase_stats(repo_id="services-flexdeck")` currently fails:
  - `dial tcp 192.168.50.176:6333: connect: no route to host`
- Impact:
  - Semantic code search/index stats are unavailable in this session.
- Fallback in this cycle:
  - Use repo-local truth (`rg`, `git log`, `nl -ba`, targeted file reads) for planning evidence.

## Constraints And Operating Notes
- Prefer `loom://tools/index` + page resources over `loom://tools` to avoid payload truncation.
- Health is point-in-time; validate again before operational actions.
- For this planning cycle, parallelize read-only inventory calls, then consolidate centrally in `.loom` docs.

## Delegation Plan Rationale
- Read-heavy discovery can be safely sharded by:
  - resource type (`config`, `servers`, `tools/index`, `health`)
  - paged tool inventory slices
- Synthesis and priority decisions stay single-threaded to avoid conflicting plan narratives.

## Sources
- `list_mcp_resources()`
- `list_mcp_resource_templates()`
- `read_mcp_resource(server="loom", uri="loom://config")`
- `read_mcp_resource(server="loom", uri="loom://servers")`
- `read_mcp_resource(server="loom", uri="loom://tools/index")`
- `read_mcp_resource(server="loom", uri="loom://health")`
- `codebase_memory__codebase_stats(repo_id="services-flexdeck")`
- Command: `loom tools list --json --limit 500`
- `read_mcp_resource(server="loom", uri="loom://config")` on 2026-03-06
- `read_mcp_resource(server="loom", uri="loom://tools/index")` on 2026-03-06
- `codebase_memory__codebase_index_poll(job_id="7df1990d849e1bc8")`
- `codebase_memory__codebase_index_start(repo_id="services/flexdeck", embeddings=false)`
- `codebase_memory__codebase_index_poll(job_id="7be4645795f5a89f")`
- `codebase_memory__codebase_stats(repo_id="services/flexdeck")`
