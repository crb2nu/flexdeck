# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 6 Unified Project Tracking.
- Slice: Projects risk capture API.
- Status: complete

## What Landed

- Key changes: added authenticated `POST /api/projects/{id}/risks`, extended the tiny Qdrant client to ensure/upsert `pm_risks`, persisted loom-core-compatible risk payloads, and invalidated Projects caches after writes.
- Key files: `internal/api/handlers/projects.go`, `internal/api/router.go`, `internal/qdrant/qdrant.go`, `internal/api/handlers/projects_test.go`, `internal/qdrant/qdrant_test.go`, `ROADMAP.md`.
- Validation results: `go test ./internal/qdrant ./internal/api/handlers` passed.

## What Is Still Open

- Remaining acceptance criteria: broader `go test ./...` and CI verification should run before final ship.
- Known issues: no inline UI form yet; operators need API/workflow clients to create risks.
- Dependencies: direct write mirrors loom-core `mcp-pm` `pm_risks` collection contract (1536-dimension Cosine vectors).

## Next Actions

1. Run `go test ./...`.
2. Add an inline Projects risk form if operator-facing capture is desired.
3. Add update/link/close endpoints when the risk lifecycle needs to be managed from FlexDeck.

## Context Links

- Agent-context session: `83ddf469e131877d`
- Task IDs: none yet.
- Relevant docs/specs: `ROADMAP.md`, `.loom/31-iteration-plan-risk-capture-2026-06-29.md`
