# RALPH Iteration Plan

## Review

- Roadmap milestone: New Phase 5 candidate, Local Stack Support for services and libs.
- Spec section(s): `.loom/brainstorm-local-stack-services-libs-2026-06-06.md`, especially F1/F2/F8 and the scanner kill-test.
- Prior decisions to preserve:
  - Keep this cycle FlexDeck-only and treat upstream services/libs as dependency contracts.
  - Prefer read-only proof slices before live workload or process-control changes.
  - Use local deterministic evidence when semantic index paths are unavailable or unnecessary.

## Align

- Slice name: Local workspace inventory kill-test API.
- Scope in:
  - Read-only scanner for top-level repos under `WORKSPACE_DIR/services` and `WORKSPACE_DIR/libs`.
  - Manifest and git metadata only: package/language hints, docs presence, worktree count, sanitized remotes, branch and dirty status.
  - Authenticated backend route returning the inventory JSON.
  - Focused Go tests for scanner behavior, secret-safe remote sanitization, handler output, and route auth.
  - Roadmap/decision/handoff docs.
- Scope out:
  - UI Stack Explorer.
  - Running tests/builds across external repos.
  - Process start/stop controls.
  - Live K8s/Flux/GitLab correlation beyond the local inventory foundation.
  - Cross-repo config changes.
- Acceptance criteria:
  - `GET /api/workspace/repos` returns `root`, `generatedAt`, `totals`, `repositories`, and scanner `errors`.
  - Repositories are discovered from manifests or `.git` presence and are grouped by `services` or `libs`.
  - Remote URLs in responses do not expose embedded credentials.
  - Hidden directories and non-repo/non-manifest directories are skipped.
  - Missing workspace root returns a dependency-unavailable response.
  - Route is inside the authenticated API group when `FLEXDECK_TOKEN` is configured.
- Dependencies/blockers:
  - The UI/control-plane plan remains blocked until this scanner proves enough useful metadata can be derived read-only.
  - Git command availability affects branch/dirty/remote enrichment, but manifest classification must still work without it.

## Land

- Planned file areas:
  - `internal/workspace/`
  - `internal/api/handlers/workspace.go`
  - `internal/api/router.go`
  - `.loom/`
  - `ROADMAP.md`
- Implementation steps:
  1. Add scanner types and read-only top-level workspace scan.
  2. Add authenticated API route and handler.
  3. Add focused tests and run the scanner against the actual workspace as the kill-test.

## Prove

- Tests to run:
  - `go test ./internal/workspace ./internal/api/handlers ./internal/api`
  - `go test ./...`
- Lint/static checks:
  - `gofmt` on touched Go files.
  - `git diff --check`.
- CI checks:
  - Not available locally until branch push/MR; document if push/MR is blocked.

## Handoff/Harvest

- Docs to update:
  - `.loom/31-iteration-plan-local-stack-inventory-kill-test-2026-06-06.md`
  - `.loom/42-slice-handoff-local-stack-inventory-kill-test-2026-06-06.md`
  - `.loom/40-decisions.md`
  - `ROADMAP.md`
- Agent-context entries to add:
  - Decision: start local-stack support with read-only workspace inventory.
  - Finding: scanner kill-test result and any limitations.
  - Task: next UI Stack Explorer slice.
- Next-slice candidates:
  - Stack Explorer UI consuming `/api/workspace/repos`.
  - Service-to-cluster binding heuristics over K8s/Flux/GitLab metadata.
  - Library adoption and contract coverage radar.
