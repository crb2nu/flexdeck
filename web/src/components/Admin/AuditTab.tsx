import {
  Component,
  createSignal,
  createResource,
  Show,
  For,
} from "solid-js";
import { auditApi } from "../../lib/api";
import {
  Button,
  Input,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../shared";

const AuditTab: Component = () => {
  const [offset, setOffset] = createSignal(0);
  const [limit] = createSignal(50);
  const [filterAction, setFilterAction] = createSignal("");
  const [filterUser, setFilterUser] = createSignal("");

  const [data, { refetch }] = createResource(
    () => ({
      offset: offset(),
      limit: limit(),
      action: filterAction(),
      user: filterUser(),
    }),
    (params) =>
      auditApi.list({
        offset: params.offset,
        limit: params.limit,
        action: params.action || undefined,
        user: params.user || undefined,
      }),
  );

  const [stats] = createResource(async () => {
    try {
      return await auditApi.stats();
    } catch {
      return null;
    }
  });

  const entries = () => {
    if (data.error) return [];
    return data.latest?.entries ?? [];
  };

  const total = () => {
    if (data.error) return 0;
    return data.latest?.total ?? 0;
  };

  const errorText = (e: unknown): string => {
    if (e instanceof Error && e.message.trim() !== "") return e.message;
    return "Failed to load audit log";
  };

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return "text-status-ok";
    if (status >= 400 && status < 500) return "text-yellow-400";
    return "text-red-400";
  };

  const methodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: "text-white",
      POST: "text-status-ok",
      PUT: "text-yellow-400",
      DELETE: "text-red-400",
    };
    return colors[method] || "text-text-muted";
  };

  return (
    <div class="space-y-4">
      {/* Stats strip */}
      <Show when={stats()}>
        {(s) => (
          <div class="flex items-center gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div class="text-center px-4">
              <div class="num text-lg text-white">{s().total}</div>
              <div class="text-[9px] text-text-dim tracking-wider">
                TOTAL EVENTS
              </div>
            </div>
            <div class="h-8 w-px bg-white/10" />
            <div class="flex-1 flex items-center gap-3 overflow-x-auto">
              <For each={Object.entries(s().byAction || {}).slice(0, 6)}>
                {([action, count]) => (
                  <div class="text-center flex-shrink-0">
                    <div class="num text-sm text-white">
                      {count as number}
                    </div>
                    <div class="text-[9px] text-text-dim truncate max-w-[80px]">
                      {action}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      {/* Filters */}
      <div class="flex items-center gap-3">
        <h3 class="heading-label flex-1">Audit Log</h3>
        <Input
          type="text"
          class="w-32"
          placeholder="Action..."
          aria-label="Filter by action"
          value={filterAction()}
          onInput={(e) => {
            setFilterAction(e.currentTarget.value);
            setOffset(0);
          }}
        />
        <Input
          type="text"
          class="w-32"
          placeholder="User..."
          aria-label="Filter by user"
          value={filterUser()}
          onInput={(e) => {
            setFilterUser(e.currentTarget.value);
            setOffset(0);
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* Audit table */}
      <Show
        when={!data.error}
        fallback={
          <ErrorState
            message={errorText(data.error)}
            variant="banner"
            onRetry={() => refetch()}
          />
        }
      >
        <Show
          when={!data.loading || data.latest}
          fallback={<LoadingState message="Loading audit log..." />}
        >
          <Show
            when={entries().length > 0}
            fallback={<EmptyState title="No audit entries found" size="sm" />}
          >
            <div class="surface overflow-hidden">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 bg-white/[0.02]">
                    <th class="heading-label px-3 py-2.5 text-left">
                      Time
                    </th>
                    <th class="heading-label px-3 py-2.5 text-left">
                      Action
                    </th>
                    <th class="heading-label px-3 py-2.5 text-left">
                      Method
                    </th>
                    <th class="heading-label px-3 py-2.5 text-left">
                      Path
                    </th>
                    <th class="heading-label px-3 py-2.5 text-left">
                      User
                    </th>
                    <th class="heading-label px-3 py-2.5 text-right">
                      Status
                    </th>
                    <th class="heading-label px-3 py-2.5 text-right">
                      Duration
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-white/5">
                  <For each={entries()}>
                    {(entry) => (
                      <tr class="hover:bg-white/[0.02]">
                        <td class="px-3 py-2 text-text-dim font-mono whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td class="px-3 py-2 font-mono text-white">
                          {entry.action}
                        </td>
                        <td class="px-3 py-2">
                          <span class={`font-mono ${methodColor(entry.method)}`}>
                            {entry.method}
                          </span>
                        </td>
                        <td class="px-3 py-2 font-mono text-text-muted max-w-[200px] truncate">
                          {entry.path}
                        </td>
                        <td class="px-3 py-2 font-mono text-text-muted">
                          {entry.username || "-"}
                        </td>
                        <td
                          class={`num px-3 py-2 text-right ${statusColor(entry.status)}`}
                        >
                          {entry.status}
                        </td>
                        <td class="num px-3 py-2 text-right text-text-dim">
                          {entry.durationMs}ms
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Show>

      {/* Pagination */}
      <Show when={total() > limit()}>
        <div class="flex items-center justify-between text-xs text-text-dim">
          <span>
            Showing {offset() + 1}-{Math.min(offset() + limit(), total())} of{" "}
            {total()}
          </span>
          <div class="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset() === 0}
              onClick={() => setOffset(Math.max(0, offset() - limit()))}
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset() + limit() >= total()}
              onClick={() => setOffset(offset() + limit())}
            >
              Next
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AuditTab;
