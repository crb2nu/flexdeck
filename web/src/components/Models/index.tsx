import { Component, ErrorBoundary } from 'solid-js';
import { PageScrollBody } from '../shared';
import FlexInferWorkbench from '../FlexInfer';

const Models: Component = () => {
  return (
    <PageScrollBody contentClass="gap-4">
    <ErrorBoundary fallback={(err) => (
      <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
        FlexInfer workbench failed to render: {err.message}
      </div>
    )}>
      <FlexInferWorkbench surface="models" />
    </ErrorBoundary>
    </PageScrollBody>
  );
};

export default Models;
