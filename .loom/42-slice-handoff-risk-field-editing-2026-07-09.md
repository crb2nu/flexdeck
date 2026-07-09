# RALPH Slice Handoff

## Slice Summary

- Milestone: Projects risk lifecycle follow-through under issue #31.
- Slice: Projects risk non-status field editing.
- Status: complete

## What Landed

- Key changes:
  - Project risk detail responses now include optional `mitigation` and `owner`
    fields from the `pm_risks` payload.
  - The Projects risk row renders existing owner/mitigation text and exposes a
    compact inline editor for title, likelihood, impact, mitigation, and owner.
  - Field edits send narrow PATCH payloads and preserve existing status/link
    behavior.
- Key files:
  - `internal/api/handlers/projects.go`
  - `internal/api/handlers/projects_test.go`
  - `web/src/lib/api/projects.ts`
  - `web/src/components/Projects/index.tsx`
  - `web/src/components/Projects/index.test.tsx`
  - `web/src/components/Projects/projects.fixture.ts`
  - `web/src/components/Projects/projectsUtils.ts`
  - `ROADMAP.md`

## Validation Results

- `pre-commit run --files ...` passed for changed files.
- `go test ./internal/api/handlers` passed.
- `go test ./...` passed.
- `npm -C web run test -- --run src/components/Projects/index.test.tsx` passed.
- `npm -C web run test` passed.
- `npm -C web run typecheck` passed.
- `npm -C web run lint` passed.

## Notes

- `pre-commit run -a` remains blocked by repository-wide pre-existing YAML
  multi-document checks in `k8s/base/*.yaml`; changed files pass the hook set.
