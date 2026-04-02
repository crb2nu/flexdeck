import {
  operatorStateLabel,
  resolveOperatorState,
  type OperatorState,
  type ResolveOperatorStateInput,
} from '../../lib/freshness';

export type DashboardDataState = Extract<
  OperatorState,
  'ready' | 'partial' | 'fallback' | 'stale' | 'offline' | 'disabled'
>;
export type ResolveDashboardStateInput = ResolveOperatorStateInput;

export function resolveDashboardDataState(
  input: ResolveDashboardStateInput,
): DashboardDataState {
  const resolved = resolveOperatorState({
    ...input,
    loadingState: 'partial',
  });

  return resolved === 'connecting' ? 'partial' : resolved;
}

export function dataStateLabel(state: DashboardDataState, detail?: string): string {
  return operatorStateLabel(state, detail);
}
