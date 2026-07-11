import {
  Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { trafficApi, type TrafficReportResponse } from "../../lib/api";
import { ErrorState, LoadingState, TabBar } from "../shared";
import type { TabDef } from "../shared";

const TRAFFIC_WINDOWS = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
] as const;

const windowTabs: TabDef[] = TRAFFIC_WINDOWS.map((window) => ({
  id: window.value,
  label: window.label,
  color: "white",
}));

const TrafficReport: Component = () => {
  const [selectedWindow, setSelectedWindow] = createSignal("24h");
  const [report, setReport] = createSignal<TrafficReportResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let requestId = 0;

  const fetchReport = async () => {
    const currentRequest = ++requestId;
    setLoading(true);
    setError("");

    try {
      const nextReport = await trafficApi.report(selectedWindow());
      if (currentRequest !== requestId) return;
      setReport(nextReport);
    } catch (err) {
      if (currentRequest !== requestId) return;
      setError(
        err instanceof Error ? err.message : "Failed to load traffic report",
      );
    } finally {
      if (currentRequest === requestId) {
        setLoading(false);
      }
    }
  };

  createEffect(() => {
    selectedWindow();
    void fetchReport();
  });

  onMount(() => {
    refreshTimer = globalThis.setInterval(() => void fetchReport(), 60000);
  });

  onCleanup(() => {
    if (refreshTimer) globalThis.clearInterval(refreshTimer);
  });

  const totalRequests = () =>
    report()?.hosts.reduce((total, host) => total + host.requests, 0) ?? 0;
  const totalRPS = () =>
    report()?.hosts.reduce(
      (total, host) => total + host.requests_per_second,
      0,
    ) ?? 0;
  const total5xx = () =>
    report()?.hosts.reduce((total, host) => total + host.five_xx, 0) ?? 0;
  const worstLatency = () =>
    Math.max(0, ...(report()?.hosts.map((host) => host.p95_latency_ms) ?? [0]));

  return (
    <div class="flex flex-col gap-4">
      <div class="surface flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-3">
          <TabBar
            tabs={windowTabs}
            active={selectedWindow()}
            onChange={setSelectedWindow}
          />
          <Show when={report()}>
            {(currentReport) => (
              <span class="text-xs text-text-dim">
                Generated{" "}
                {new Date(currentReport().generated_at).toLocaleTimeString()} ·{" "}
                {currentReport().status}
              </span>
            )}
          </Show>
        </div>

        <button
          onClick={fetchReport}
          disabled={loading()}
          class="flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition-all hover:bg-white/20 disabled:opacity-50"
        >
          <span class={loading() ? "animate-spin" : ""}>↻</span>
          Refresh
        </button>
      </div>

      <Show when={error()}>
        <ErrorState message={error()} variant="banner" onRetry={fetchReport} />
      </Show>

      <Show when={loading() && !report()}>
        <LoadingState
          variant="inline"
          size="sm"
          message="Loading traffic report..."
        />
      </Show>

      <Show when={report()}>
        {(currentReport) => (
          <>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <TrafficStat
                label="Requests"
                value={formatNumber(totalRequests())}
                note={currentReport().window}
              />
              <TrafficStat
                label="Current rate"
                value={`${totalRPS().toFixed(2)}/s`}
                note="5m rolling"
              />
              <TrafficStat
                label="5xx"
                value={formatNumber(total5xx())}
                note="selected window"
                tone={total5xx() > 0 ? "warn" : "ok"}
              />
              <TrafficStat
                label="Worst p95"
                value={`${worstLatency().toFixed(0)}ms`}
                note="by host"
                tone={worstLatency() > 2000 ? "warn" : "ok"}
              />
            </div>

            <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section class="surface overflow-hidden">
                <div class="border-b border-white/5 px-4 py-3">
                  <h2 class="text-sm font-medium text-text-main">
                    Public hosts
                  </h2>
                </div>
                <div class="overflow-x-auto">
                  <table class="min-w-full text-left text-sm">
                    <thead class="text-[11px] uppercase tracking-wide text-text-dim">
                      <tr>
                        <th class="px-4 py-2 font-medium">Host</th>
                        <th class="px-4 py-2 text-right font-medium">
                          Requests
                        </th>
                        <th class="px-4 py-2 text-right font-medium">Rate</th>
                        <th class="px-4 py-2 text-right font-medium">4xx</th>
                        <th class="px-4 py-2 text-right font-medium">5xx</th>
                        <th class="px-4 py-2 text-right font-medium">P95</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5">
                      <For each={currentReport().hosts}>
                        {(host) => (
                          <tr>
                            <td class="px-4 py-3 font-mono text-text-main">
                              {host.host}
                            </td>
                            <td class="px-4 py-3 text-right font-mono text-text-muted">
                              {formatNumber(host.requests)}
                            </td>
                            <td class="px-4 py-3 text-right font-mono text-text-muted">
                              {host.requests_per_second.toFixed(2)}/s
                            </td>
                            <td class="px-4 py-3 text-right font-mono text-status-warn">
                              {formatNumber(host.four_xx)}
                            </td>
                            <td class="px-4 py-3 text-right font-mono text-status-error">
                              {formatNumber(host.five_xx)}
                            </td>
                            <td class="px-4 py-3 text-right font-mono text-text-muted">
                              {host.p95_latency_ms.toFixed(0)}ms
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </section>

              <section class="surface overflow-hidden">
                <div class="border-b border-white/5 px-4 py-3">
                  <h2 class="text-sm font-medium text-text-main">
                    Tracking health
                  </h2>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={currentReport().tracking_signals}>
                    {(signal) => (
                      <div class="flex items-start justify-between gap-3 px-4 py-3">
                        <div>
                          <div class="text-sm font-medium text-text-main">
                            {signal.name}
                          </div>
                          <div class="mt-1 text-xs text-text-dim">
                            {signal.detail}
                          </div>
                        </div>
                        <div
                          class={`rounded-md border px-2 py-1 text-xs font-medium ${signal.ok ? "border-status-ok/30 text-status-ok" : "border-status-error/30 text-status-error"}`}
                        >
                          {signal.ok ? "ok" : "check"}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </section>
            </div>

            <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <TrafficList
                title="Top ingress paths"
                items={currentReport().top_paths.map((path) => ({
                  key: `${path.host}${path.path}`,
                  label: path.path,
                  detail: path.host,
                  value: formatNumber(path.requests),
                }))}
              />
              <TrafficList
                title="Top app pages"
                items={currentReport().top_pages.map((page) => ({
                  key: page.page,
                  label: page.page,
                  detail: "Next.js page-view counter",
                  value: formatNumber(page.views),
                }))}
              />
              <TrafficList
                title="Report notes"
                items={currentReport().recommendations.map((note, index) => ({
                  key: `${index}-${note}`,
                  label: note,
                  detail: "automated report",
                  value: "",
                }))}
              />
            </div>

            <Show
              when={
                currentReport().warnings && currentReport().warnings!.length > 0
              }
            >
              <div class="surface border-status-warn/30 px-4 py-3 text-xs text-status-warn">
                <For each={currentReport().warnings}>
                  {(warning) => <div>{warning}</div>}
                </For>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

const TrafficStat: Component<{
  label: string;
  value: string;
  note: string;
  tone?: "ok" | "warn";
}> = (props) => (
  <div class="surface px-4 py-3">
    <div class="text-[11px] uppercase tracking-wide text-text-dim">
      {props.label}
    </div>
    <div
      class={`mt-2 font-mono text-2xl font-semibold ${props.tone === "warn" ? "text-status-warn" : props.tone === "ok" ? "text-status-ok" : "text-text-main"}`}
    >
      {props.value}
    </div>
    <div class="mt-1 text-xs text-text-dim">{props.note}</div>
  </div>
);

const TrafficList: Component<{
  title: string;
  items: Array<{ key: string; label: string; detail: string; value: string }>;
}> = (props) => (
  <section class="surface overflow-hidden">
    <div class="border-b border-white/5 px-4 py-3">
      <h2 class="text-sm font-medium text-text-main">{props.title}</h2>
    </div>
    <div class="divide-y divide-white/5">
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="px-4 py-6 text-center text-sm text-text-dim">No data found</div>
        }
      >
        <For each={props.items}>
          {(item) => (
            <div class="flex items-start justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-text-main">
                  {item.label}
                </div>
                <div class="mt-1 truncate text-xs text-text-dim">
                  {item.detail}
                </div>
              </div>
              <Show when={item.value}>
                <div class="shrink-0 font-mono text-sm text-text-muted">
                  {item.value}
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  </section>
);

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export default TrafficReport;
