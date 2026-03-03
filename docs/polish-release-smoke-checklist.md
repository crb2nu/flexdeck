# Polish Release Smoke Checklist

Use this checklist for the Feature Improvements + Polish wave before merge and after merge.

## 1) Automated Gates (Required)

- `npm -C web run -s test`
- `npm -C web run -s lint`
- `go test ./internal/api/handlers/... ./internal/metrics/...`

Record command timestamps and failures in MR notes if any command flakes or needs retries.

## 2) Pipeline UX Smoke

- Open Pipeline view and confirm data-state labeling is unambiguous:
  - live data path
  - stale data path
  - static/demo fallback path
  - offline/unreachable path
- Trigger `retry` and `cancel` actions on a safe test job and confirm:
  - immediate action feedback is shown
  - post-action refresh updates status without stale artifacts
- Confirm overview card and detail panel stay in sync during polling transitions.

## 3) Grafana Operability Smoke

- In Metrics dashboard cards, verify query resolution state is visible:
  - `direct`
  - `templated`
  - `fallback`
- Confirm unsupported-target messaging is distinct from runtime query errors.
- Expand at least one panel at mobile width (`390px`) and verify no clipping/truncation blocks operator use.

## 4) Dashboard + Mobile Signal Smoke

- Verify pulse-card semantics are consistent across model/inference/agent surfaces:
  - `ready`
  - `partial`
  - `stale`
  - `offline`
- Confirm feature-gated disabled surfaces render as disabled/explicitly unavailable (not runtime-failure red).
- Validate touch behavior and overlay dismissal at `320px`, `375px`, and `390px`.

## 5) Post-Merge CI/Deploy Monitoring

- Confirm MR pipeline reaches terminal `success`.
- Confirm first post-merge `main` pipeline reaches terminal state.
- If deploy job fails due external reconcile timeout:
  - capture job IDs
  - capture last log lines showing failure signature
  - post issue note with blocker and next action owner
