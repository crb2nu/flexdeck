import { Component } from 'solid-js';
import LegacyWorkbenchAdapter from './LegacyWorkbenchAdapter';

const PipelinesTab: Component = () => (
  <LegacyWorkbenchAdapter
    badge="Legacy Pipelines"
    title="Cache pipeline operations are now part of the FlexInfer workbench"
    message="This compatibility wrapper keeps the old entry point available without preserving a separate cache and pipeline event implementation. The workbench supply-chain section is the canonical surface for cache lifecycle, pipeline failures, and follow-up actions."
  />
);

export default PipelinesTab;
