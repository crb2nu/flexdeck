import { Component } from 'solid-js';
import LegacyWorkbenchAdapter from './LegacyWorkbenchAdapter';

const ProxyTab: Component = () => (
  <LegacyWorkbenchAdapter
    badge="Legacy Proxy"
    title="Proxy health and routing moved into the shared workbench"
    message="This legacy proxy tab now delegates to the FlexInfer workbench instead of maintaining a second metrics and health polling path. Use the telemetry section in the workbench for the canonical proxy view."
  />
);

export default ProxyTab;
