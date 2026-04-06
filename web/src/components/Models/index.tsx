import { Component, ErrorBoundary } from 'solid-js';
import { PageScrollBody } from '../shared';
import FlexInferWorkbench from '../FlexInfer';

const Models: Component = () => {
  let scrollViewport: HTMLDivElement | undefined;

  return (
    <PageScrollBody
      contentClass="gap-4"
      viewportRef={(element) => { scrollViewport = element; }}
    >
    <ErrorBoundary fallback={(err) => (
      <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
        FlexInfer workbench failed to render: {err.message}
      </div>
    )}>
      <FlexInferWorkbench surface="models" scrollViewport={() => scrollViewport} />
    </ErrorBoundary>
    </PageScrollBody>
  );
};

export default Models;
