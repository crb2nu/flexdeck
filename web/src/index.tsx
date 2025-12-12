/* @refresh reload */
import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import AppLayout from './AppLayout';
import './styles/global.css';

// Lazy load route components
const Dashboard = lazy(() => import('./components/Dashboard'));
const Services = lazy(() => import('./components/Services'));
const ComingSoon = lazy(() => import('./components/ComingSoon'));

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(
  () => (
    <HashRouter root={AppLayout}>
      <Route path="/" component={Dashboard} />
      <Route path="/services" component={Services} />
      <Route path="/logs" component={ComingSoon} />
      <Route path="/metrics" component={ComingSoon} />
      <Route path="/models" component={ComingSoon} />
    </HashRouter>
  ),
  root
);
