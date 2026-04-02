import { Component } from 'solid-js';
import LegacyWorkbenchAdapter from './LegacyWorkbenchAdapter';

const InferenceTab: Component = () => (
  <LegacyWorkbenchAdapter
    badge="Legacy Inference"
    title="Inference metrics now live inside the FlexInfer workbench"
    message="This legacy entry is retained as a compatibility wrapper only. Inference telemetry, reliability signals, and per-model operational triage are owned by the shared FlexInfer workbench so dashboard and operator surfaces stay aligned."
  />
);

export default InferenceTab;
