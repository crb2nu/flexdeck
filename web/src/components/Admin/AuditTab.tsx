import {
  Component,
  createSignal,
  createResource,
  Show,
  For,
} from "solid-js";
import { auditApi } from "../../lib/api";

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
    async (params) => {
      try {
        return await auditApi.list({
          offset: params.offset,
          limit: params.limit,
          action: params.action || undefined,
          user: params.user || undefined,
        });
      } catch {
        return { entries: [], total: 0 };
      }
    },
  );

  const [stats] = createResource(async () => {
    try {
      return await auditApi.stats();
    } catch {
      return null;
    }
  });

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return "text-neon-green";
    if (status >= 400 && status < 500) return "text-yellow-400";
    return "text-red-400";
  };

  const methodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: "text-neon-cyan",
      POST: "text-neon-green",
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
              <div class="text-lg font-mono text-white">{s().total}</div>
              <div class="text-[9px] text-text-dim tracking-wider">
                TOTAL EVENTS
              </div>
            </div>
            <div class="h-8 w-px bg-white/10" />
            <div class="flex-1 flex items-center gap-3 overflow-x-auto">
              <For each={Object.entries(s().byAction || {}).slice(0, 6)}>
                {([action, count]) => (
                  <div class="text-center flex-shrink-0">
                    <div class="text-sm font-mono text-neon-cyan">
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
        <h3 class="text-sm font-mono text-text-muted tracking-wider flex-1">
          AUDIT LOG
        </h3>
        <input
          type="text"
          class="rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-neon-cyan/50 focus:outline-none w-32"
          placeholder="Action..."
          value={filterAction()}
          onInput={(e) => {
            setFilterAction(e.currentTarget.value);
            setOffset(0);
          }}
        />
        <input
          type="text"
          class="rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-neon-cyan/50 focus:outline-none w-32"
          placeholder="User..."
          value={filterUser()}
          onInput={(e) => {
            setFilterUser(e.currentTarget.value);
            setOffset(0);
          }}
        />
        <button
          class="text-xs text-text-dim hover:text-neon-cyan"
          onClick={() => refetch()}
        >
          Refresh
        </button>
      </div>

      {/* Audit table */}
      <div class="rounded-lg border border-white/5 overflow-hidden">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-white/5 bg-white/[0.02]">
              <th class="px-3 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                TIME
              </th>
              <th class="px-3 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                ACTION
              </th>
              <th class="px-3 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                METHOD
              </th>
              <th class="px-3 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                PATH
              </th>
              <th class="px-3 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                USER
              </th>
              <th class="px-3 py-2.5 text-right text-[10px] text-text-dim tracking-wider font-normal">
                STATUS
              </th>
              <th class="px-3 py-2.5 text-right text-[10px] text-text-dim tracking-wider font-normal">
                DURATION
              </th>
            </tr>
          </thead>
          <tbody>
            <For
              each={data()?.entries || []}
              fallback={
                <tr>
                  <td colspan="7" class="px-4 py-6 text-center text-text-dim">
                    No audit entries found
                  </td>
                </tr>
              }
            >
              {(entry) => (
                <tr class="border-b border-white/5 hover:bg-white/[0.02]">
                  <td class="px-3 py-2 text-text-dim font-mono whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td class="px-3 py-2 font-mono text-neon-cyan">
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
                    class={`px-3 py-2 text-right font-mono ${statusColor(entry.status)}`}
                  >
                    {entry.status}
                  </td>
                  <td class="px-3 py-2 text-right font-mono text-text-dim">
                    {entry.durationMs}ms
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Show when={(data()?.total || 0) > limit()}>
        <div class="flex items-center justify-between text-xs text-text-dim">
          <span>
            Showing {offset() + 1}-
            {Math.min(offset() + limit(), data()?.total || 0)} of{" "}
            {data()?.total}
          </span>
          <div class="flex gap-2">
            <button
              class="rounded border border-white/10 px-3 py-1 hover:text-white disabled:opacity-30"
              disabled={offset() === 0}
              onClick={() => setOffset(Math.max(0, offset() - limit()))}
            >
              Prev
            </button>
            <button
              class="rounded border border-white/10 px-3 py-1 hover:text-white disabled:opacity-30"
              disabled={offset() + limit() >= (data()?.total || 0)}
              onClick={() => setOffset(offset() + limit())}
            >
              Next
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AuditTab;
