# MCP Inventory (Carry-Forward Baseline Reviewed 2026-04-03)

## Scope
- Workspace: `/Users/cblevins/workspace/services/flexdeck`
- Planning branch: `codex/reopen-planning-baseline`
- Inventory status for this turn: review-only carry-forward from the verified `2026-03-28` / `2026-03-31` planning cycle
- Focus for this cycle: preserve the still-useful runtime/index assumptions while resetting the execution plan around the current merged baseline

## What Remains Canonical
The reopened March inventory is still useful for a few facts that future sessions should keep treating as canonical until re-verified:
- loom-mode was active during the last full inventory refresh
- the runtime snapshot reported:
  - `serverCount: 46`
  - `toolCount: 498`
  - `totalPages: 5`
- the live codebase-memory repo ID was `services/flexdeck`
- the alias `services-flexdeck` was stale and returned zero chunks

## What This File Is Not Claiming
- This file does **not** claim that `46` servers / `498` tools were re-verified on `2026-04-03`.
- This turn did not re-run loom inventory discovery because the user request was to review and refresh the reopened planning bundle, not to produce a fresh runtime census.
- Any task that depends on exact current server/tool counts should re-run the live loom inventory first.

## Current Planning Takeaways
- The preserved inventory still supports planning because the most important operational fact for this repo remains the canonical index ID: `services/flexdeck`.
- The reopened planning docs should preserve that repo-ID guidance, but should stop using the March inventory snapshot as evidence that unfinished implementation slices still exist.
- Before starting any new cross-repo contract work, re-validate live loom inventory and codebase index health instead of assuming the March runtime snapshot is still exact.

## Revalidation Triggers
Re-run full inventory before:
- relying on current server/tool totals in docs or automation
- starting a new codebase-memory-heavy planning pass
- making another cross-repo API parity claim about `flexinfer` or `loom-core`
- debugging any MCP/runtime failure that could have changed tool availability

## Preserved Sources From The Last Verified Refresh
- `list_mcp_resources()`
- `list_mcp_resource_templates()`
- `read_mcp_resource(server="loom", uri="loom://config")`
- `read_mcp_resource(server="loom", uri="loom://servers")`
- `read_mcp_resource(server="loom", uri="loom://tools/index")`
- `codebase_memory__codebase_stats(repo_id="services/flexdeck")`
- `codebase_memory__codebase_stats(repo_id="services-flexdeck")`
- `gitlab__get_project(project="services/flexinfer")`
- `gitlab__get_project(project="services/loom-core")`

## Review Sources For This Turn
- `git log --oneline --decorate -8`
- `git diff --stat`
- `.loom/10-research.md`
- `.loom/20-product-spec.md`
- `.loom/30-implementation-plan.md`
