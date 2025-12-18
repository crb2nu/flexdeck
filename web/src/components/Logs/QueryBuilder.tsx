import { Component, createSignal, For, Show } from 'solid-js';

interface LabelSelector {
  key: string;
  operator: '=' | '!=' | '=~' | '!~';
  value: string;
}

interface LineFilter {
  operator: '|=' | '!=' | '|~' | '!~';
  value: string;
}

interface Props {
  onQueryChange: (query: string) => void;
  initialQuery?: string;
}

const COMMON_LABELS = ['namespace', 'pod', 'container', 'node', 'app', 'service', 'level'];
const LABEL_OPERATORS: LabelSelector['operator'][] = ['=', '!=', '=~', '!~'];
const LINE_OPERATORS: LineFilter['operator'][] = ['|=', '!=', '|~', '!~'];

const QueryBuilder: Component<Props> = (props) => {
  const [labels, setLabels] = createSignal<LabelSelector[]>([
    { key: 'namespace', operator: '=', value: 'default' }
  ]);
  const [lineFilters, setLineFilters] = createSignal<LineFilter[]>([]);
  const [showPreview, setShowPreview] = createSignal(true);

  // Generate LogQL query from selectors
  const buildQuery = (): string => {
    const labelSelectors = labels()
      .filter(l => l.key && l.value)
      .map(l => {
        const needsQuotes = l.operator === '=' || l.operator === '!=';
        const val = needsQuotes ? `"${l.value}"` : `\`${l.value}\``;
        return `${l.key}${l.operator}${val}`;
      })
      .join(', ');

    let query = `{${labelSelectors}}`;

    // Add line filters
    for (const filter of lineFilters()) {
      if (filter.value) {
        const needsBackticks = filter.operator === '|~' || filter.operator === '!~';
        const val = needsBackticks ? `\`${filter.value}\`` : `"${filter.value}"`;
        query += ` ${filter.operator} ${val}`;
      }
    }

    return query;
  };

  const addLabel = () => {
    setLabels([...labels(), { key: '', operator: '=', value: '' }]);
  };

  const removeLabel = (index: number) => {
    setLabels(labels().filter((_, i) => i !== index));
  };

  const updateLabel = (index: number, field: keyof LabelSelector, value: string) => {
    setLabels(labels().map((l, i) => i === index ? { ...l, [field]: value } : l));
  };

  const addLineFilter = () => {
    setLineFilters([...lineFilters(), { operator: '|=', value: '' }]);
  };

  const removeLineFilter = (index: number) => {
    setLineFilters(lineFilters().filter((_, i) => i !== index));
  };

  const updateLineFilter = (index: number, field: keyof LineFilter, value: string) => {
    setLineFilters(lineFilters().map((f, i) => i === index ? { ...f, [field]: value } : f));
  };

  const applyQuery = () => {
    props.onQueryChange(buildQuery());
  };

  return (
    <div class="space-y-3">
      {/* Label Selectors */}
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-xs font-mono text-text-muted uppercase tracking-wider">Label Selectors</label>
          <button
            onClick={addLabel}
            class="text-[10px] text-neon-cyan hover:text-neon-cyan/80 transition-colors"
          >
            + Add Label
          </button>
        </div>
        <div class="space-y-2">
          <For each={labels()}>
            {(label, index) => (
              <div class="flex items-center gap-2">
                <select
                  value={label.key}
                  onChange={(e) => updateLabel(index(), 'key', e.currentTarget.value)}
                  class="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main focus:border-neon-cyan/50 focus:outline-none"
                >
                  <option value="">Select label...</option>
                  <For each={COMMON_LABELS}>
                    {(l) => <option value={l}>{l}</option>}
                  </For>
                </select>
                <select
                  value={label.operator}
                  onChange={(e) => updateLabel(index(), 'operator', e.currentTarget.value as LabelSelector['operator'])}
                  class="w-14 bg-black/40 border border-white/10 rounded px-1 py-1 text-xs text-text-main font-mono focus:border-neon-cyan/50 focus:outline-none"
                >
                  <For each={LABEL_OPERATORS}>
                    {(op) => <option value={op}>{op}</option>}
                  </For>
                </select>
                <input
                  type="text"
                  value={label.value}
                  onInput={(e) => updateLabel(index(), 'value', e.currentTarget.value)}
                  placeholder="value"
                  class="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main font-mono placeholder:text-text-dim/50 focus:border-neon-cyan/50 focus:outline-none"
                />
                <Show when={labels().length > 1}>
                  <button
                    onClick={() => removeLabel(index())}
                    class="text-text-dim hover:text-status-error transition-colors p-1"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Line Filters */}
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-xs font-mono text-text-muted uppercase tracking-wider">Line Filters</label>
          <button
            onClick={addLineFilter}
            class="text-[10px] text-neon-cyan hover:text-neon-cyan/80 transition-colors"
          >
            + Add Filter
          </button>
        </div>
        <div class="space-y-2">
          <For each={lineFilters()}>
            {(filter, index) => (
              <div class="flex items-center gap-2">
                <select
                  value={filter.operator}
                  onChange={(e) => updateLineFilter(index(), 'operator', e.currentTarget.value as LineFilter['operator'])}
                  class="w-14 bg-black/40 border border-white/10 rounded px-1 py-1 text-xs text-text-main font-mono focus:border-neon-cyan/50 focus:outline-none"
                >
                  <For each={LINE_OPERATORS}>
                    {(op) => <option value={op}>{op}</option>}
                  </For>
                </select>
                <input
                  type="text"
                  value={filter.value}
                  onInput={(e) => updateLineFilter(index(), 'value', e.currentTarget.value)}
                  placeholder={filter.operator.includes('~') ? 'regex pattern' : 'contains text'}
                  class="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main font-mono placeholder:text-text-dim/50 focus:border-neon-cyan/50 focus:outline-none"
                />
                <button
                  onClick={() => removeLineFilter(index())}
                  class="text-text-dim hover:text-status-error transition-colors p-1"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </For>
          <Show when={lineFilters().length === 0}>
            <p class="text-[10px] text-text-dim italic">No line filters. Click "+ Add Filter" to filter log content.</p>
          </Show>
        </div>
      </div>

      {/* Query Preview */}
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-xs font-mono text-text-muted uppercase tracking-wider">Generated Query</label>
          <button
            onClick={() => setShowPreview(!showPreview())}
            class="text-[10px] text-text-dim hover:text-text-main transition-colors"
          >
            {showPreview() ? 'Hide' : 'Show'}
          </button>
        </div>
        <Show when={showPreview()}>
          <div class="bg-black/40 border border-white/10 rounded p-2 font-mono text-xs text-neon-cyan break-all">
            {buildQuery()}
          </div>
        </Show>
      </div>

      {/* Apply Button */}
      <button
        onClick={applyQuery}
        class="w-full rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30"
      >
        Apply Query
      </button>
    </div>
  );
};

export default QueryBuilder;
