import { Component, For, Show, createMemo, type Accessor } from 'solid-js';
import Badge from '../../shared/Badge';
import type { FlexInferModel } from '../../../lib/types';
import GroupSwapTimeline from './GroupSwapTimeline';
import { buildSharingGroups, sharingStateTone, type SharingMember } from './sharing';

interface SharingGroupsProps {
  models: Accessor<FlexInferModel[]>;
}

function memberTitle(m: SharingMember): string {
  const parts = [`${m.namespace}/${m.name}`, m.state];
  if (m.state === 'Queued' && m.queuePosition != null) parts.push(`queue #${m.queuePosition}`);
  if (m.preemptedBy) parts.push(`preempted by ${m.preemptedBy}`);
  return parts.join(' · ');
}

/**
 * GPU sharing state: one card per shared group showing who holds the GPU now
 * (member state chips) and the swap/contention history (per-group Gantt).
 * Self-hides when no model declares a shared group.
 */
const SharingGroups: Component<SharingGroupsProps> = (props) => {
  const groups = createMemo(() => buildSharingGroups(props.models()));

  return (
    <Show when={groups().length > 0}>
      <div class="space-y-3">
        <span class="heading-label">GPU Sharing</span>
        <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <For each={groups()}>
            {(group) => (
              <div class="surface overflow-hidden">
                <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-mono text-sm text-text-main" title={`${group.namespace}/${group.group}`}>
                      {group.group}
                    </span>
                    <span class="text-[11px] text-text-dim">{group.namespace}</span>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <For each={group.members}>
                      {(m) => (
                        <span
                          class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px]"
                          title={memberTitle(m)}
                        >
                          <span class="font-mono text-text-dim">{m.name}</span>
                          <Badge tone={sharingStateTone(m.state)} size="sm">
                            {m.state === 'Queued' && m.queuePosition != null ? `Queued #${m.queuePosition}` : m.state}
                          </Badge>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
                <GroupSwapTimeline group={group.group} namespace={group.namespace} />
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
};

export default SharingGroups;
