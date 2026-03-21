import { Component, ErrorBoundary } from 'solid-js';
import FlexInferWorkbench from '../FlexInfer';

const FlexInferTab: Component = () => (
  <ErrorBoundary fallback={(err) => (
    <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
      FlexInfer admin surface failed to render: {err.message}
    </div>
  )}>
    <FlexInferWorkbench surface="admin" />
  </ErrorBoundary>
);

export default FlexInferTab;
