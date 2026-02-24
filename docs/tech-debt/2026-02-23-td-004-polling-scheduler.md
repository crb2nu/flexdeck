# Tech Debt Implementation Report

## Item

- Debt ID: TD-004
- Branch/PR: `main`
- Owner: gemini-cli

## Problem

- Original pain point: Fragmented polling loops (setInterval) across multiple components and stores created unnecessary load and ignored page visibility.
- Affected components: K8s store, Metrics store, Dashboard summary, Events feed, GPU table, Alerts, Langfuse, and Flux status.

## Changes

- Summary of refactor/remediation:
  - Created a centralized `PollingScheduler` in `web/src/lib/polling.ts` that respects page visibility.
  - Implemented a `createPolling` SolidJS hook in `web/src/hooks/createPolling.ts` for idiomatic usage in components.
  - Migrated 8 high-frequency polling sites to the shared scheduler.
- Notable design choices:
  - Polling automatically pauses when the browser tab is hidden and resumes (with an immediate refresh) when it becomes visible.
  - Supports both constant and reactive (accessor) intervals and enabled states.
  - Provides a `trigger()` method for manual refresh.

## Verification

- Local checks:
  - `npm run typecheck` passed.
  - `npm run test` passed (all 41 tests).
  - Manual verification of scheduler behavior (pausing on hide).
- CI pipeline/run:
  - (To be verified after push)

## Outcome

- Risk reduced: Centralized management prevents "runaway" intervals and ensures consistent refresh semantics.
- Delivery drag reduced: Components no longer need to manually manage `setInterval`/`clearInterval` in `onMount`/`onCleanup`.
- Residual debt / follow-ups:
  - Continue migrating remaining lower-frequency polling sites as they are encountered.
