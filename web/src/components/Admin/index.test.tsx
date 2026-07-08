/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureMap } from '../../lib/featureFlags';

const adminMocks = vi.hoisted(() => ({
  healthStore: {
    features: {} as FeatureMap,
  },
}));

vi.mock('../../stores/health', () => ({
  healthStore: adminMocks.healthStore,
}));

vi.mock('./UsersTab', () => ({
  default: () => <section data-testid="users-tab">Users content</section>,
}));

vi.mock('./AuditTab', () => ({
  default: () => <section data-testid="audit-tab">Audit content</section>,
}));

vi.mock('./ClustersTab', () => ({
  default: () => <section data-testid="clusters-tab">Clusters content</section>,
}));

vi.mock('./FlexInferTab', () => ({
  default: () => <section data-testid="flexinfer-tab">FlexInfer content</section>,
}));

import Admin from './index';

function mount(features: FeatureMap) {
  adminMocks.healthStore.features = features;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <Admin />, container);

  return () => {
    dispose();
    container.remove();
  };
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  return button!;
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function tabLabels(): string[] {
  return Array.from(document.querySelectorAll('button')).map((element) => element.textContent?.trim() ?? '');
}

describe('Admin', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    adminMocks.healthStore.features = {};
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the Phase 4 rollout tabs in stable order and defaults to Users', () => {
    cleanup = mount({
      rbac: { enabled: true },
      audit: { enabled: true },
      multi_cluster: { enabled: true },
      flexinfer_proxy: { enabled: false },
    });

    expect(tabLabels()).toEqual(['Users', 'Audit Log', 'Clusters']);
    expect(document.querySelector('[data-testid="users-tab"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="audit-tab"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="clusters-tab"]')).toBeFalsy();

    buttonByText('Audit Log').click();
    expect(document.querySelector('[data-testid="audit-tab"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="users-tab"]')).toBeFalsy();

    buttonByText('Clusters').click();
    expect(document.querySelector('[data-testid="clusters-tab"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="audit-tab"]')).toBeFalsy();
  });

  it('defaults to the first enabled Phase 4 tab when RBAC is off', () => {
    cleanup = mount({
      rbac: { enabled: false },
      audit: { enabled: true },
      multi_cluster: { enabled: true },
      flexinfer_proxy: { enabled: false },
    });

    expect(pageText()).not.toContain('Users content');
    expect(document.querySelector('[data-testid="audit-tab"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="clusters-tab"]')).toBeFalsy();
  });

  it('shows an empty state when every admin feature is disabled', () => {
    cleanup = mount({
      rbac: { enabled: false },
      audit: { enabled: false },
      multi_cluster: { enabled: false },
      flexinfer_proxy: { enabled: false },
    });

    expect(pageText()).toContain('No admin features enabled');
    expect(document.querySelector('[data-testid="users-tab"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="audit-tab"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="clusters-tab"]')).toBeFalsy();
  });

  it('surfaces readiness cards when Audit and Multi-Cluster are disabled with reasons', () => {
    cleanup = mount({
      rbac: { enabled: false },
      audit: { enabled: false, mode: 'disabled', reason: 'AUDIT_DISABLED is true' },
      multi_cluster: { enabled: false, mode: 'missing_registry', reason: 'Cluster registry is not configured' },
      flexinfer_proxy: { enabled: false },
    });

    expect(pageText()).toContain('Audit Logs');
    expect(pageText()).toContain('AUDIT_DISABLED is true');
    expect(pageText()).toContain('Flag off');
    expect(pageText()).toContain('Multi-Cluster');
    expect(pageText()).toContain('Cluster registry is not configured');
    expect(pageText()).toContain('Registry missing');
    expect(document.querySelector('[data-testid="audit-tab"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="clusters-tab"]')).toBeFalsy();
  });
});
