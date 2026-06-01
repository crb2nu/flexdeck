# MCP Inventory — FlexInfer Navigation / UI Primitive Planning (2026-04-12)

## Scope
- Repository: `/Users/cblevins/workspace/services/flexdeck`
- Planning focus: FlexInfer flicker, broken sidebar links, and the shared sidebar/page-shell primitive surface
- Runtime mode for this turn: loom-mode re-verified

## Runtime Detection
- `list_mcp_resources()` returned loom proxy resources including `loom://config`, `loom://servers`, and `loom://tools/index`, so loom-mode is active.
- `list_mcp_resource_templates()` returned paged loom tool templates including `loom://tools/page/{page}` and `loom://tools/server/{server}/page/{page}`.
- `read_mcp_resource(server="loom", uri="loom://config")` reported the active profile as `full` with `serverCount: 48` and `toolCount: 514`.
- `read_mcp_resource(server="loom", uri="loom://tools/index")` reported `totalTools: 514`, `pageSize: 100`, and `totalPages: 6`.

## Tooling Used For This Planning Cycle
- `codebase_memory`
  - Used for index readiness only.
  - `codebase_memory__codebase_stats(repo_id="services/flexdeck")` returned `total_chunks: 1952` with strong TypeScript and Go coverage.
- Local shell inspection
  - Used for route, layout, workbench, primitive, and test-file inspection.
  - Relevant areas were `web/src/index.tsx`, `web/src/AppLayout.tsx`, `web/src/components/FlexInfer/Workbench.tsx`, `web/src/components/shared/OperationsSidebarNav.tsx`, and `web/src/components/FlexInfer/Workbench.test.tsx`.

## Codebase Index Readiness
- Canonical repo ID for this repo remains `services/flexdeck`.
- Live index status for this turn:
  - `repo_id: services/flexdeck`
  - `total_chunks: 1952`
  - `typescript: 1121`
  - `go: 817`
- Operational note:
  - calling `codebase_memory__codebase_stats` without `repo_id` failed with `repo_id is required (or set CODEBASE_REPO_ID)`, so future planning docs for this repo should keep using the explicit repo ID.

## Relevant Available Servers
- `codebase_memory`
  - good fit for file/symbol lookup and index validation
- `agent_context`
  - available and running if this planning cycle needs durable handoff later
- `quality`
  - available for targeted lint/test/security follow-through during implementation
- `browserkit`
  - available for screenshot validation if the navigation fix needs visual regression proof

## Constraints And Notes
- Most MCP servers are cataloged but idle until invoked; that is expected in loom-mode and not a failure signal.
- No external browsing was needed for this turn because the failure mode is fully explainable from repo-local routing and component code.
- The working tree already contained unrelated local artifacts: `node_modules/`, `screenshot-dashboard.png`, and `screenshot-flexinfer.png`. They were treated as baseline context only.

## Sources
- `list_mcp_resources()`
- `list_mcp_resource_templates()`
- `read_mcp_resource(server="loom", uri="loom://config")`
- `read_mcp_resource(server="loom", uri="loom://servers")`
- `read_mcp_resource(server="loom", uri="loom://tools/index")`
- `codebase_memory__codebase_stats(repo_id="services/flexdeck")`
- `git status --short --branch`
