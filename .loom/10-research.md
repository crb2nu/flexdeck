# Research Brief — Post-Hardening Feature Improvements + Polish (2026-03-03)

## Research Brief — Performance, UX, and Redis Leverage (2026-03-06)

### Problem Statement
FlexDeck is materially faster than it was before the recent topology, pipeline, metrics, and controller refactors, but the app still has two remaining classes of performance debt:
1. backend cache architecture is inconsistent and leaves expensive hot paths uncached or coupled to unrelated feature flags
2. frontend polling and rendering behavior is still fragmented across multiple pages, which risks avoidable request fan-out and stale/ambiguous UX states

### Method
- Refreshed MCP/runtime inventory and re-established codebase index readiness with a lexical-only fallback index.
- Audited Redis/cache bootstrap, API handler cache coverage, and Redis-backed metrics/pipeline stores.
- Enumerated remaining polling and animation hotspots across `web/src/`.
- Ran Tavily research focused on:
  - Page Visibility and background tab behavior
  - Redis cache-aside and stampede prevention
  - Grafana query caching and incremental querying
  - Prometheus recording rules for repeated dashboard expressions

Commands and tool calls used:
- `python $CODEX_HOME/skills/plan-loom-core/scripts/workspace_snapshot.py --root .`
- `rg -n "GetOrFetch\\(|cache\\.Get\\(|cache\\.Set\\(|InvalidatePattern\\(|RedisClient\\(" internal`
- `rg -n 'setInterval\\(|visibilitychange|requestAnimationFrame\\(|Promise\\.all\\(|fetch\\(`/api|fetch\\('/api|fetch\\(\"/api' web/src internal`
- `nl -ba internal/api/handlers/handlers.go | sed -n '1,160p'`
- `nl -ba internal/cache/cache.go | sed -n '1,220p'`
- `nl -ba internal/api/handlers/prometheus.go | sed -n '1,220p'`
- `nl -ba internal/api/handlers/ci.go | sed -n '1,320p'`
- `nl -ba internal/metrics/store.go | sed -n '1,260p'`
- `nl -ba internal/metrics/pipeline_store.go | sed -n '1,280p'`
- `tavily__search("site:developer.mozilla.org Page Visibility API pause polling hidden tabs")`
- `tavily__search("site:redis.io caching patterns cache aside ttl expiration redis best practices")`
- `tavily__search("site:grafana.com query caching dashboards prometheus grafana best practices")`
- `tavily__search("site:prometheus.io recording rules dashboards performance best practices")`

### Local Findings

#### 1. Redis-backed handler caching is architecturally under-leveraged
- Generic handler caching is only initialized when `metricsStore` exists (`internal/api/handlers/handlers.go:84`).
- `metricsStore` is only created when LiteLLM is enabled and Redis is configured (`cmd/server/main.go:54`, `cmd/server/main.go:59`).
- Impact: turning off LiteLLM currently disables Redis-backed response caching even for unrelated surfaces like K8s, Grafana, CI, Alertmanager, and public topology.

#### 2. Prometheus endpoints are still uncached proxy paths
- `/api/prom/query` and `/api/prom/query_range` are direct pass-through handlers (`internal/api/handlers/prometheus.go:35`, `internal/api/handlers/prometheus.go:56`).
- The frontend Prometheus tab queries six panels in parallel every refresh cycle (`web/src/components/Metrics/usePrometheusMetricsController.ts:130`, `web/src/components/Metrics/usePrometheusMetricsController.ts:175`).
- Impact: repeated dashboard visits still re-execute identical recent PromQL, even though nearby time-window caching and incremental fetch behavior are good candidates here.

#### 3. Current cache wrapper is too basic for hot-path protection
- `internal/cache/cache.go` provides plain cache-aside with `GetOrFetch`, `Set`, `Get`, and pattern invalidation (`internal/cache/cache.go:27`, `internal/cache/cache.go:71`, `internal/cache/cache.go:87`).
- Missing features:
  - request coalescing / singleflight
  - stale-while-revalidate
  - TTL jitter
  - hit/miss/refresh instrumentation
- Impact: a burst of concurrent misses on `ci:repos`, Grafana dashboards, or heavy K8s endpoints can still stampede the origin.

#### 4. Redis time-series reads recompute too much
- LiteLLM throughput scans all `litellm:metrics:*` keys and recomputes windows from raw sorted-set members on each request (`internal/metrics/store.go:115`, `internal/metrics/store.go:139`, `internal/metrics/store.go:185`).
- CI trend/history reads likewise deserialize and recompute aggregates from stored pipeline runs on demand (`internal/metrics/pipeline_store.go:66`, `internal/metrics/pipeline_store.go:83`, `internal/metrics/pipeline_store.go:134`).
- Impact: Redis is acting as raw event storage, but not yet as a materialized summary cache for the dashboard views that are read most often.

#### 5. CI repository discovery remains expensive despite caching
- `ListRepositories` caches the result for five minutes (`internal/api/handlers/ci.go:38`), but a miss still:
  - scans up to 500 GitLab projects (`internal/api/handlers/ci.go:78`)
  - then fetches `.gitlab-ci.yml` for every project in parallel (`internal/api/handlers/ci.go:133`, `internal/api/handlers/ci.go:160`)
- Impact: cold-cache or invalidation events can create a large GitLab fan-out and slow repository-list UX.

#### 6. Polling and background work are still fragmented across the frontend
- Visibility-aware polling exists in the Prometheus metrics controller (`web/src/components/Metrics/usePrometheusMetricsController.ts:173`, `web/src/components/Metrics/usePrometheusMetricsController.ts:183`).
- Many other views still own independent intervals without the same guardrails:
  - Alerts (`web/src/components/Alerts/index.tsx:40`)
  - Agents HUD (`web/src/components/Agents/HUDTab.tsx:128`, `web/src/components/Agents/HUDTab.tsx:133`)
  - Agents sessions (`web/src/components/Agents/AgentSessionPanel.tsx:75`)
  - Services (`web/src/components/Services/useServicesController.ts:214`)
  - Models inference/router/catalog/GPU panels (`web/src/components/Models/InferenceTab.tsx:114`, `web/src/components/Models/LiteLLMRouterPanel.tsx:24`, `web/src/components/Models/CatalogTab.tsx:138`, `web/src/components/Models/GPUMetricsPanel.tsx:181`)
  - Dashboard node resources (`web/src/components/Dashboard/NodeResourcePanel.tsx:152`)
- Impact: the app can still accumulate unnecessary background refresh load as users navigate between pages.

### External Findings

#### Browser/runtime guidance
- MDN’s Page Visibility API guidance is directly applicable to FlexDeck’s polling surfaces: hidden tabs should explicitly pause or downshift work because browsers only provide generic throttling, not app-specific correctness guarantees.
- MDN also notes that `requestAnimationFrame()` is paused in most hidden tabs, which supports the current direction of idling the topology and pipeline animation loops instead of keeping auxiliary timers hot.

#### Redis/caching guidance
- Redis documents cache-aside as the standard on-demand query caching pattern, but TTL choice, key design, and serialization efficiency remain application responsibilities.
- External caching guidance consistently points to three missing protections for high-concurrency dashboard backends:
  - TTL jitter to avoid synchronized expiry
  - singleflight/request coalescing for concurrent misses
  - stale-while-revalidate for “serve slightly old but instant” dashboard reads

#### Grafana/Prometheus guidance
- Grafana documents both query caching and Prometheus incremental querying for repeated dashboard reads.
- Grafana also notes Prometheus may already cache some query shapes internally, which implies FlexDeck should favor backend caching for the exact repeated dashboard requests it controls rather than blanket-cache everything.
- Prometheus recording rules are explicitly intended to precompute frequently used or expensive expressions so dashboards query precomputed series rather than re-evaluating the same expressions on each refresh.

### Recommended Improvements

#### P1. Decouple Redis API caching from LiteLLM
- Introduce an independent Redis client/bootstrap path for generic handler caching.
- Keep the metrics store as a specialized time-series consumer, not the owner of all Redis availability.
- This is the highest-leverage backend fix because it broadens existing cache coverage without changing page code.

#### P1. Upgrade `internal/cache.Cache` to a hot-path cache, not a thin wrapper
- Add per-key singleflight in-process coalescing around `GetOrFetch`.
- Add optional stale/fresh windows so handlers can serve stale data while one refresh runs.
- Add TTL jitter to avoid synchronized expiry on fleet-wide hot keys.
- Add counters/logging for hit, miss, stale-serve, refresh, and error paths.

#### P1. Cache and shape Prometheus reads more intelligently
- Add short-TTL Redis caching for `/api/prom/query_range` keyed by normalized `(query,start,end,step)` buckets.
- Align time windows to step-sized buckets for cacheability, similar to Grafana’s rounded-range behavior.
- Promote the heaviest repeated expressions into recording rules where the dashboard is repeatedly asking the same question.

#### P1. Expand visibility-aware polling into a shared frontend scheduler
- Reuse `web/src/lib/polling.ts` or replace it with a shared polling registry that enforces:
  - route-active gating
  - `document.hidden` gating
  - adaptive cadence based on panel criticality
  - burst refresh on visibility restore
- Apply this first to Agents, Alerts, Dashboard node resources, and remaining Models tabs.

#### P2. Materialize read-mostly summaries in Redis
- Precompute or cache:
  - LiteLLM throughput summaries by model/window
  - CI trend aggregates by project/window
  - repository CI-config presence summaries
- Preserve raw sorted sets for history, but stop recomputing hot summaries from scratch on every read.

#### P2. Reduce cold-start fan-out on CI repository discovery
- Split “repository list” from “pipeline config inspection”.
- Persist per-project `.gitlab-ci.yml` detection/status separately with longer TTL or webhook-driven invalidation.
- Return the shallow repository list first and hydrate config details lazily in the UI when necessary.

#### P2. Add frontend performance observability
- Instrument long-task and long-frame detection using `PerformanceObserver`.
- Capture per-page refresh fan-out and cache-hit/miss metrics so future optimization work is based on measured hotspots, not intuition.

### UX Implications
- Snappy operator UX is not just raw speed. The site should make freshness states explicit:
  - `live`
  - `cached`
  - `stale-refreshing`
  - `paused-hidden-tab`
  - `degraded`
- This avoids the current failure mode where a page feels “slow” when it is actually waiting on repeated polling or direct proxy queries with no immediate stale-data fallback.

### Conclusion
The next performance wave should focus less on isolated render loops and more on data movement discipline:
1. make Redis independent and stampede-resistant
2. stop re-running identical Prometheus and GitLab work
3. enforce visibility-aware polling consistently across pages
4. precompute the dashboard summaries users read most often

That combination will move FlexDeck from “optimized in spots” to “systemically fast.”

### Sources
- `cmd/server/main.go:54`
- `cmd/server/main.go:59`
- `internal/api/handlers/handlers.go:84`
- `internal/cache/cache.go:27`
- `internal/cache/cache.go:71`
- `internal/cache/cache.go:87`
- `internal/api/handlers/prometheus.go:35`
- `internal/api/handlers/prometheus.go:56`
- `internal/api/handlers/ci.go:38`
- `internal/api/handlers/ci.go:78`
- `internal/api/handlers/ci.go:133`
- `internal/api/handlers/ci.go:160`
- `internal/metrics/store.go:115`
- `internal/metrics/store.go:139`
- `internal/metrics/store.go:185`
- `internal/metrics/pipeline_store.go:66`
- `internal/metrics/pipeline_store.go:83`
- `internal/metrics/pipeline_store.go:134`
- `web/src/components/Metrics/usePrometheusMetricsController.ts:130`
- `web/src/components/Metrics/usePrometheusMetricsController.ts:173`
- `web/src/components/Metrics/usePrometheusMetricsController.ts:183`
- `web/src/components/Alerts/index.tsx:40`
- `web/src/components/Agents/HUDTab.tsx:128`
- `web/src/components/Agents/HUDTab.tsx:133`
- `web/src/components/Agents/AgentSessionPanel.tsx:75`
- `web/src/components/Services/useServicesController.ts:214`
- `web/src/components/Models/InferenceTab.tsx:114`
- `web/src/components/Models/LiteLLMRouterPanel.tsx:24`
- `web/src/components/Models/CatalogTab.tsx:138`
- `web/src/components/Models/GPUMetricsPanel.tsx:181`
- `web/src/components/Dashboard/NodeResourcePanel.tsx:152`
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN Blog: Using the Page Visibility API](https://developer.mozilla.org/en-US/blog/using-the-page-visibility-api/)
- [MDN: requestAnimationFrame()](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [Redis: Guide to cache optimization strategies](https://redis.io/blog/guide-to-cache-optimization-strategies/)
- [Redis: Cache-Aside Pattern with Redis](https://redis.io/tutorials/howtos/solutions/microservices/caching/)
- [Grafana: tips for optimizing query performance](https://grafana.com/blog/grafana-dashboards-tips-for-optimizing-query-performance/)
- [Grafana docs: data source management / query caching](https://grafana.com/docs/grafana/latest/administration/data-source-management/)
- [Grafana docs: Prometheus incremental dashboard queries](https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/)
- [Prometheus: recording rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)

## Problem Statement
Phase 3/3.5 reliability work is now largely shipped. The next planning gap is not missing major subsystems, but inconsistent polish across recently changed surfaces (Pipeline, Grafana, Dashboard/mobile, and CI delivery ergonomics).

## Method
- Refreshed workspace and MCP context pack state.
- Analyzed recent commit stream and touched-file hotspots.
- Sampled current implementation details in active UI surfaces for polish opportunities.

Commands used:
- `git log --since='2026-02-18' --pretty=format:'%h %ad %s' --date=short`
- `python - <<'PY' ... git log --name-only ... Counter ... PY`
- `nl -ba web/src/components/Pipeline/index.tsx | sed -n '1,260p'`
- `nl -ba web/src/components/Pipeline/CIPipelineViz.tsx | sed -n '1,320p'`
- `nl -ba web/src/components/Metrics/GrafanaDashboards.tsx | sed -n '1,320p'`
- `nl -ba web/src/components/Dashboard/index.tsx | sed -n '1,300p'`
- `rg -n "TODO|FIXME|XXX|HACK" internal web/src`

## Facts Found

### Delivery Baseline (Recent)
- Recent commits show concentrated fixes/enhancements in:
  - Pipeline reactivity, stage ordering, and deeper history.
  - Grafana auth fallback + hosted-route behavior + panel visibility polish.
  - Dashboard signal improvements (node resource panel, LiteLLM throughput on CRD cards).
  - Mobile overlay/layout refinements.
  - CI gate hardening and mirrored toolchain images.
- Roadmap marks Phase 3.5 reliability items complete and Phase 4 as partial/feature-gated.

### Hotspots By Change Frequency
Top files since 2026-02-18 include:
- `web/src/components/Dashboard/index.tsx` (8 touches)
- `internal/api/handlers/grafana.go` (6 touches)
- `web/src/AppLayout.tsx` (6 touches)
- `web/src/components/Pipeline/index.tsx` (3 touches)
- `web/src/components/Metrics/GrafanaDashboards.tsx` (4 touches)

### Implementation Signals For Polish
- Pipeline page already has active polling logic and action refresh scheduling, but state clarity can still improve when toggling between overview/detail and active/inactive pipelines (`web/src/components/Pipeline/index.tsx:30`, `web/src/components/Pipeline/index.tsx:134`).
- CI visualization keeps a demo fallback model and optimistic job actions; follow-up polish should prioritize explicit “live vs demo” affordances and action feedback semantics (`web/src/components/Pipeline/CIPipelineViz.tsx:67`, `web/src/components/Pipeline/CIPipelineViz.tsx:194`).
- Grafana dashboard parser now performs non-trivial query normalization and templating fallback; this is a strong integration baseline but benefits from clearer resolution diagnostics and test reinforcement (`web/src/components/Metrics/GrafanaDashboards.tsx:179`, `web/src/components/Metrics/GrafanaDashboards.tsx:221`).
- Dashboard aggregates three polling tracks (models, inference, agent activity) with mixed feature-gated pathways; polish should focus on unified freshness/error semantics and reduced status ambiguity (`web/src/components/Dashboard/index.tsx:176`, `web/src/components/Dashboard/index.tsx:120`).

## Gap Summary (What Is Still Missing)
1. Consistent freshness/status UX across high-frequency panels (Pipeline, Dashboard cards, Grafana live cards).
2. Stronger operator affordances around “data confidence” states (live, stale, fallback, demo, offline, partial).
3. End-to-end verification loop for UI polish changes (frontend tests + targeted backend checks + smoke flow).
4. Coordinated planning rhythm tying roadmap reconciliations to real code deltas (latest reconciliation reported no planning deltas while delivery code kept moving).

## Assumptions
- Current objective is to improve reliability and operator UX without introducing new backend subsystems.
- Changes should remain FlexDeck-local and leverage existing APIs/handlers.

## Open Questions
1. Should pipeline “overview” remain primarily poll-driven, or move to event-driven updates where available?
2. Which status taxonomy should be canonical across UI surfaces: `offline|partial|stale|fallback|demo|ready`?
3. Is a single shared “data freshness” component acceptable across Pipeline, Dashboard pulse cards, and Grafana panels?

## Key Conclusions
1. Next wave should be a focused polish release, not a scope-expansion release.
2. Pipeline + Grafana + Dashboard status coherence is the highest leverage UX reliability investment.
3. Planning artifacts should explicitly include a testing/ship loop and troubleshooting loop to prevent drift after fast fix cycles.

## Sources
- `ROADMAP.md:93`
- `ROADMAP.md:122`
- `docs/roadmap-reconciliation-2026-03-03.md:1`
- `web/src/components/Pipeline/index.tsx:30`
- `web/src/components/Pipeline/index.tsx:134`
- `web/src/components/Pipeline/CIPipelineViz.tsx:67`
- `web/src/components/Pipeline/CIPipelineViz.tsx:194`
- `web/src/components/Metrics/GrafanaDashboards.tsx:179`
- `web/src/components/Metrics/GrafanaDashboards.tsx:221`
- `web/src/components/Dashboard/index.tsx:120`
- `web/src/components/Dashboard/index.tsx:176`
- Command: `git log --since='2026-02-18' --pretty=format:'%h %ad %s' --date=short`
- Command: `python - <<'PY' ... git log --name-only ... Counter ... PY`
