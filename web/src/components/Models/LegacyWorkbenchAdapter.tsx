import { Component, ErrorBoundary } from 'solid-js';
import { PageScrollBody } from '../shared';
import FlexInferWorkbench from '../FlexInfer';

interface LegacyWorkbenchAdapterProps {
  badge: string;
  title: string;
  message: string;
}

const LegacyWorkbenchAdapter: Component<LegacyWorkbenchAdapterProps> = (props) => (
  <PageScrollBody contentClass="gap-4">
    <div class="glass-panel border border-white/10 bg-black/20 p-4">
      <div class="flex flex-col gap-2">
        <span class="w-fit rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">
          {props.badge}
        </span>
        <div class="text-lg font-semibold text-text-main">{props.title}</div>
        <div class="max-w-3xl text-sm leading-6 text-text-dim">{props.message}</div>
      </div>
    </div>

    <ErrorBoundary fallback={(err) => (
      <div class="glass-panel border border-status-error/20 p-4 text-sm text-status-error">
        FlexInfer workbench failed to render: {err.message}
      </div>
    )}>
      <FlexInferWorkbench surface="models" />
    </ErrorBoundary>
  </PageScrollBody>
);

export default LegacyWorkbenchAdapter;
