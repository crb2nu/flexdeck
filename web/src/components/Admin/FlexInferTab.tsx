import { Component, ErrorBoundary } from 'solid-js';
import { PageScrollBody } from '../shared';
import FlexInferWorkbench from '../FlexInfer';

const FlexInferTab: Component = () => {
  return (
    <PageScrollBody contentClass="gap-4">
    <ErrorBoundary fallback={(err) => (
      <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
        FlexInfer admin surface failed to render: {err.message}
      </div>
    )}>
      <FlexInferWorkbench surface="admin" />
    </ErrorBoundary>
    </PageScrollBody>
  );
};

export default FlexInferTab;
