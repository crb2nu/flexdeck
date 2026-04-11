import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { alertmanagerApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import type { AlertmanagerAlert, AlertmanagerSilence } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';
import { TabBar, LoadingState, ErrorState, EmptyState } from '../shared';

const Alerts: Component = () => {
  const [alerts, setAlerts] = createSignal<AlertmanagerAlert[]>([]);
  const [silences, setSilences] = createSignal<AlertmanagerSilence[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [tab, setTab] = createSignal<'alerts' | 'silences'>('alerts');
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  // Silence form
  const [showSilenceForm, setShowSilenceForm] = createSignal(false);
  const [silenceAuthor, setSilenceAuthor] = createSignal('flexdeck');
  const [silenceComment, setSilenceComment] = createSignal('');
  const [silenceMatcherName, setSilenceMatcherName] = createSignal('alertname');
  const [silenceMatcherValue, setSilenceMatcherValue] = createSignal('');
  const [silenceDuration, setSilenceDuration] = createSignal('2h');

  const fetchAll = async () => {
    try {
      const [a, s] = await Promise.all([
        alertmanagerApi.alerts().catch(() => []),
        alertmanagerApi.silences().catch(() => []),
      ]);
      setAlerts(a);
      setSilences(s);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
    } finally {
      setLoading(false);
    }
  };

  createPolling('alerts-panel', fetchAll, 30000);

  const firingAlerts = createMemo(() => alerts().filter(a => a.status?.state === 'active'));
  const silencedAlerts = createMemo(() => alerts().filter(a => a.status?.state === 'suppressed'));
  const activeSilences = createMemo(() => silences().filter(s => s.status?.state === 'active'));

  // Group alerts by alertname
  const groupedAlerts = createMemo(() => {
    const groups: Record<string, AlertmanagerAlert[]> = {};
    for (const alert of alerts()) {
      const name = alert.labels?.alertname || 'Unknown';
      if (!groups[name]) groups[name] = [];
      groups[name].push(alert);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  });

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-status-error bg-status-error/10';
      case 'warning': return 'text-yellow-400 bg-yellow-400/10';
      default: return 'text-text-dim bg-white/5';
    }
  };

  const handleCreateSilence = async () => {
    const now = new Date();
    const match = silenceDuration().match(/^(\d+)([hmd])$/);
    if (!match) return;
    const [, num, unit] = match;
    const ms = parseInt(num) * ({ h: 3600000, m: 60000, d: 86400000 }[unit] || 3600000);
    const endsAt = new Date(now.getTime() + ms);

    try {
      await alertmanagerApi.createSilence({
        matchers: [{ name: silenceMatcherName(), value: silenceMatcherValue(), isRegex: false, isEqual: true }],
        startsAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        createdBy: silenceAuthor(),
        comment: silenceComment(),
      });
      setShowSilenceForm(false);
      setSilenceComment('');
      setSilenceMatcherValue('');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create silence');
    }
  };

  const handleDeleteSilence = async (id: string) => {
    try {
      await alertmanagerApi.deleteSilence(id);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete silence');
    }
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Summary badges */}
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-status-error/10 text-status-error text-xs">
          <span class="font-medium">{firingAlerts().length}</span> firing
        </div>
        <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 text-text-dim text-xs">
          <span class="font-medium">{silencedAlerts().length}</span> silenced
        </div>
        <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 text-text-dim text-xs">
          <span class="font-medium">{activeSilences().length}</span> active silences
        </div>

        {/* Tabs */}
        <div class="ml-auto">
          <TabBar
            tabs={[
              { id: 'alerts' as const, label: 'Alerts', count: alerts().length, color: 'status-error' },
              { id: 'silences' as const, label: 'Silences', count: activeSilences().length },
            ]}
            active={tab()}
            onChange={setTab}
          />
        </div>
      </div>

      <Show when={error()}>
        <ErrorState message={error()!} variant="banner" onRetry={fetchAll} />
      </Show>

      <Show when={loading()}>
        <LoadingState message="Loading alerts..." />
      </Show>

      {/* Alerts tab */}
      <Show when={!loading() && tab() === 'alerts'}>
        <Show when={groupedAlerts().length === 0}>
          <EmptyState title="No alerts" size="sm" />
        </Show>
        <div class="space-y-2">
          <For each={groupedAlerts()}>
            {([name, group]) => (
              <div class="surface overflow-hidden">
                <button
                  class="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors"
                  onClick={() => toggleExpand(name)}
                >
                  <span class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    severityColor(group[0]?.labels?.severity || '')
                  }`}>
                    {group[0]?.labels?.severity || 'info'}
                  </span>
                  <span class="text-sm font-mono text-text-main">{name}</span>
                  <span class="text-xs text-text-dim">({group.length})</span>
                  <span class="ml-auto text-text-dim text-xs">
                    {expanded().has(name) ? '\u25B2' : '\u25BC'}
                  </span>
                </button>
                <Show when={expanded().has(name)}>
                  <div class="border-t border-white/5 divide-y divide-white/5">
                    <For each={group}>
                      {(alert) => (
                        <div class="px-4 py-2 text-xs">
                          <div class="flex flex-wrap gap-1 mb-1">
                            <For each={Object.entries(alert.labels || {}).filter(([k]) => k !== 'alertname' && k !== 'severity')}>
                              {([k, v]) => (
                                <span class="px-1.5 py-0.5 bg-white/5 rounded text-text-dim font-mono">
                                  {k}={v}
                                </span>
                              )}
                            </For>
                          </div>
                          <Show when={alert.annotations?.description}>
                            <div class="text-text-dim/70 mt-1">{alert.annotations.description}</div>
                          </Show>
                          <div class="text-text-dim/40 mt-1">
                            Started {formatRelativeTime(alert.startsAt)}
                            {alert.status?.state === 'suppressed' && ' (silenced)'}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Silences tab */}
      <Show when={!loading() && tab() === 'silences'}>
        <div class="flex justify-end">
          <button
            class="px-3 py-1.5 text-xs bg-white/10 text-white rounded-md hover:bg-white/15"
            onClick={() => setShowSilenceForm(!showSilenceForm())}
          >
            {showSilenceForm() ? 'Cancel' : 'Create Silence'}
          </button>
        </div>

        <Show when={showSilenceForm()}>
          <div class="surface p-4 space-y-3">
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-xs text-text-dim block mb-1">Matcher Name</label>
                <input
                  type="text"
                  value={silenceMatcherName()}
                  onInput={(e) => setSilenceMatcherName(e.currentTarget.value)}
                  class="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main"
                />
              </div>
              <div class="flex-1">
                <label class="text-xs text-text-dim block mb-1">Matcher Value</label>
                <input
                  type="text"
                  value={silenceMatcherValue()}
                  onInput={(e) => setSilenceMatcherValue(e.currentTarget.value)}
                  class="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main"
                />
              </div>
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-xs text-text-dim block mb-1">Duration</label>
                <select
                  value={silenceDuration()}
                  onChange={(e) => setSilenceDuration(e.currentTarget.value)}
                  class="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main"
                >
                  <option value="30m">30 minutes</option>
                  <option value="1h">1 hour</option>
                  <option value="2h">2 hours</option>
                  <option value="4h">4 hours</option>
                  <option value="8h">8 hours</option>
                  <option value="1d">1 day</option>
                </select>
              </div>
              <div class="flex-1">
                <label class="text-xs text-text-dim block mb-1">Author</label>
                <input
                  type="text"
                  value={silenceAuthor()}
                  onInput={(e) => setSilenceAuthor(e.currentTarget.value)}
                  class="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main"
                />
              </div>
            </div>
            <div>
              <label class="text-xs text-text-dim block mb-1">Comment</label>
              <input
                type="text"
                value={silenceComment()}
                onInput={(e) => setSilenceComment(e.currentTarget.value)}
                class="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main"
                placeholder="Reason for silence..."
              />
            </div>
            <button
              class="px-3 py-1.5 text-xs bg-white/10 text-white rounded-md hover:bg-white/15"
              onClick={handleCreateSilence}
              disabled={!silenceMatcherValue()}
            >
              Create
            </button>
          </div>
        </Show>

        <div class="space-y-2">
          <For each={silences()}>
            {(silence) => (
              <div class="surface px-4 py-3">
                <div class="flex items-center gap-3">
                  <span class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    silence.status?.state === 'active' ? 'text-status-ok bg-status-ok/10' :
                    silence.status?.state === 'expired' ? 'text-text-dim bg-white/5' :
                    'text-yellow-400 bg-yellow-400/10'
                  }`}>
                    {silence.status?.state}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-mono text-text-main">
                      <For each={silence.matchers}>
                        {(m) => <span>{m.name}={m.isRegex ? '~' : ''}{m.value} </span>}
                      </For>
                    </div>
                    <div class="text-[10px] text-text-dim mt-0.5">
                      by {silence.createdBy} — {silence.comment || 'no comment'}
                    </div>
                  </div>
                  <div class="text-[10px] text-text-dim">
                    Expires {formatRelativeTime(silence.endsAt)}
                  </div>
                  <Show when={silence.status?.state === 'active'}>
                    <button
                      class="text-xs text-status-error/70 hover:text-status-error"
                      onClick={() => handleDeleteSilence(silence.id)}
                    >
                      Delete
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={silences().length === 0}>
            <EmptyState title="No silences" size="sm" />
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default Alerts;
