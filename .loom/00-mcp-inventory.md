# MCP Inventory (Refreshed 2026-02-17 15:42 ET)

## Scope
- Workspace: `/Users/cblevins/workspace/services/flexdeck`
- Active Loom profile: `full`
- Source calls:
  - `list_mcp_resources`
  - `list_mcp_resource_templates`
  - `read_mcp_resource(server="loom", uri="loom://servers")`
  - `read_mcp_resource(server="loom", uri="loom://tools")`
  - `read_mcp_resource(server="loom", uri="loom://health")`
  - `read_mcp_resource(server="loom", uri="loom://config")`

## Resource Inventory
- `list_mcp_resources` currently returns no static resources.
- Template-backed resources exposed by `loom`:
  - `loom://servers`
  - `loom://tools`
  - `loom://health`
  - `loom://config`

## Runtime Snapshot
- Configured MCP servers: `42`
- Active tool catalog size: `370`
- Tool catalog timestamp: `2026-02-17T15:42:16.686236-05:00`
- Snapshot indicates `39` local processes currently running (`loom/status.processes`).
- Core servers relevant to FlexDeck planning and implementation are healthy:
  - `agent_context`, `codebase_memory`, `git`, `git_worktree`
  - `k8s_apps_k3s`, `flux`, `prometheus`, `loki`, `grafana`, `alertmanager`
  - `tavily`, `github`, `gitlab`, `jira`, `docker`, `devbox`

## Constraints And Operating Notes
- `loom://tools` is large and truncated by proxy byte limits; do not treat truncated output as exhaustive.
- `loom://health` is point-in-time and can drift quickly; re-check before operational actions.
- Some servers can report transient connection errors while still marked healthy; check both `running` and health details when a call fails.
- For FlexDeck roadmap/spec work, prefer:
  - Code truth: `codebase_memory` + local file inspection (`rg`, `sed`)
  - Runtime verification: `prometheus`, `loki`, `k8s_apps_k3s`, `flux`
  - Planning continuity: `.loom/*` + `agent_context`

## Sources
- `list_mcp_resources`
- `list_mcp_resource_templates`
- `read_mcp_resource(server="loom", uri="loom://servers")`
- `read_mcp_resource(server="loom", uri="loom://tools")`
- `read_mcp_resource(server="loom", uri="loom://health")`
- `read_mcp_resource(server="loom", uri="loom://config")`
