import { Component, createSignal, createUniqueId, For, Show, createMemo } from 'solid-js';
import { alertmanagerApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import { stableListByKey } from '../../lib/stableList';
import type { AlertmanagerAlert, AlertmanagerSilence } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';
import { TabBar, ErrorState, EmptyState, Button, Input, Select, SkeletonRows } from '../shared';
import { showToast, ToastContainer } from '../shared/Toast';

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
  const [submitting, setSubmitting] = createSignal(false);
  const [deletingSilenceId, setDeletingSilenceId] = createSignal<string | null>(null);

  const matcherNameId = createUniqueId();
  const matcherValueId = createUniqueId();
  const durationId = createUniqueId();
  const authorId = createUniqueId();
  const commentId = createUniqueId();

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

  // The polled signals are replaced wholesale every 30s, so without stabilizing
  // these the alert groups and silence rows remount (and collapse) on each
  // refresh. Reuse the prior ref per group (keyed by alertname) and per silence
  // (keyed by id) when the JSON signature is unchanged.
  const stableGroupedAlerts = stableListByKey(groupedAlerts, ([name]) => name);
  const stableSilences = stableListByKey(silences, (s) => s.id);

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
    if (submitting()) return;
    const now = new Date();
    const match = silenceDuration().match(/^(\d+)([hmd])$/);
    if (!match) return;
    const [, num, unit] = match;
    const ms = parseInt(num) * ({ h: 3600000, m: 60000, d: 86400000 }[unit] || 3600000);
    const endsAt = new Date(now.getTime() + ms);

    setSubmitting(true);
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
      showToast('Silence created', 'success');
      await fetchAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create silence', 'error');
    }
    setSubmitting(false);
  };

  const handleDeleteSilence = async (id: string) => {
    setDeletingSilenceId(id);
    try {
      await alertmanagerApi.deleteSilence(id);
      showToast('Silence deleted', 'success');
      await fetchAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete silence', 'error');
    }
    setDeletingSilenceId(null);
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Summary badges */}
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-status-error/10 text-status-error text-xs">
          <span class="num font-medium">{firingAlerts().length}</span> firing
        </div>
        <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 text-text-dim text-xs">
          <span class="num font-medium">{silencedAlerts().length}</span> silenced
        </div>
        <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 text-text-dim text-xs">
          <span class="num font-medium">{activeSilences().length}</span> active silences
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
        <SkeletonRows surface count={4} />
      </Show>

      {/* Alerts tab */}
      <Show when={!loading() && tab() === 'alerts'}>
        <Show when={groupedAlerts().length === 0}>
          <EmptyState title="No alerts" size="sm" />
        </Show>
        <div class="space-y-2">
          <For each={stableGroupedAlerts()}>
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
                          <div class="text-text-dim/60 mt-1">
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowSilenceForm(!showSilenceForm())}
          >
            {showSilenceForm() ? 'Cancel' : 'Create Silence'}
          </Button>
        </div>

        <Show when={showSilenceForm()}>
          <div class="surface p-4 space-y-3">
            <div class="flex gap-3">
              <div class="flex-1">
                <label for={matcherNameId} class="heading-label block mb-1">Matcher Name</label>
                <Input
                  id={matcherNameId}
                  type="text"
                  value={silenceMatcherName()}
                  onInput={(e) => setSilenceMatcherName(e.currentTarget.value)}
                />
              </div>
              <div class="flex-1">
                <label for={matcherValueId} class="heading-label block mb-1">Matcher Value</label>
                <Input
                  id={matcherValueId}
                  type="text"
                  value={silenceMatcherValue()}
                  onInput={(e) => setSilenceMatcherValue(e.currentTarget.value)}
                />
              </div>
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label for={durationId} class="heading-label block mb-1">Duration</label>
                <Select
                  id={durationId}
                  value={silenceDuration()}
                  onChange={(e) => setSilenceDuration(e.currentTarget.value)}
                  options={[
                    { value: '30m', label: '30 minutes' },
                    { value: '1h', label: '1 hour' },
                    { value: '2h', label: '2 hours' },
                    { value: '4h', label: '4 hours' },
                    { value: '8h', label: '8 hours' },
                    { value: '1d', label: '1 day' },
                  ]}
                />
              </div>
              <div class="flex-1">
                <label for={authorId} class="heading-label block mb-1">Author</label>
                <Input
                  id={authorId}
                  type="text"
                  value={silenceAuthor()}
                  onInput={(e) => setSilenceAuthor(e.currentTarget.value)}
                />
              </div>
            </div>
            <div>
              <label for={commentId} class="heading-label block mb-1">Comment</label>
              <Input
                id={commentId}
                type="text"
                value={silenceComment()}
                onInput={(e) => setSilenceComment(e.currentTarget.value)}
                placeholder="Reason for silence..."
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={submitting()}
              disabled={!silenceMatcherValue()}
              onClick={handleCreateSilence}
            >
              Create
            </Button>
          </div>
        </Show>

        <div class="space-y-2">
          <For each={stableSilences()}>
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
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingSilenceId() === silence.id}
                      onClick={() => handleDeleteSilence(silence.id)}
                    >
                      Delete
                    </Button>
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

      <ToastContainer />
    </div>
  );
};

export default Alerts;
