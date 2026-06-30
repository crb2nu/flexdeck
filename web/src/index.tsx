/* @refresh reload */
import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import AppLayout from './AppLayout';
import './styles/global.css';
import { installBenchmark } from './lib/perfBenchmark';
import { initPerfObserver } from './lib/perfObserver';
installBenchmark();
if (import.meta.env.DEV) {
  initPerfObserver();
}

// Lazy load route components
const Dashboard = lazy(() => import('./components/Dashboard'));
const Services = lazy(() => import('./components/Services'));
const Stack = lazy(() => import('./components/Stack'));
const Logs = lazy(() => import('./components/Logs'));
const Metrics = lazy(() => import('./components/Metrics'));
const WebsiteMetrics = lazy(() => import('./components/WebsiteMetrics'));
const FlexInfer = lazy(() => import('./components/Models'));
const LoomHUD = lazy(() => import('./components/Agents'));
const Loom = lazy(() => import('./components/Loom'));
const Projects = lazy(() => import('./components/Projects'));
const Pipeline = lazy(() => import('./components/Pipeline'));
const FluxStatus = lazy(() => import('./components/FluxStatus'));
const Admin = lazy(() => import('./components/Admin'));
const Infra = lazy(() => import('./components/Infra'));

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(
  () => (
    <HashRouter root={AppLayout}>
      <Route path="/" component={Dashboard} />
      <Route path="/services" component={Services} />
      <Route path="/stack" component={Stack} />
      <Route path="/logs" component={Logs} />
      <Route path="/website-metrics" component={WebsiteMetrics} />
      <Route path="/traffic" component={WebsiteMetrics} />
      <Route path="/metrics" component={Metrics} />
      <Route path="/flexinfer" component={FlexInfer} />
      <Route path="/models" component={FlexInfer} />
      <Route path="/loom-hud" component={LoomHUD} />
      <Route path="/agents" component={LoomHUD} />
      <Route path="/loom" component={Loom} />
      <Route path="/projects" component={Projects} />
      <Route path="/pipeline" component={Pipeline} />
      <Route path="/flux" component={FluxStatus} />
      <Route path="/admin" component={Admin} />
      <Route path="/infra" component={Infra} />
    </HashRouter>
  ),
  root
);
