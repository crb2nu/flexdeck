import { describe, expect, it } from 'vitest';

import {
  buildNavItems,
  getHudEntryState,
  getAdminTabs,
  getDefaultAdminTab,
  getHudModeState,
  isAdminEnabled,
  isNavItemActive,
  type FeatureMap,
} from './featureFlags';

describe('featureFlags', () => {
  it('hides Admin nav item when admin-related features are disabled', () => {
    const features: FeatureMap = {
      rbac: { enabled: false },
      audit: { enabled: false },
      multi_cluster: { enabled: false },
    };

    expect(isAdminEnabled(features)).toBe(false);
    expect(buildNavItems(features).some((item) => item.path === '/admin')).toBe(false);
  });

  it('shows Admin nav item when at least one admin feature is enabled', () => {
    const features: FeatureMap = {
      rbac: { enabled: false },
      audit: { enabled: true },
      multi_cluster: { enabled: false },
    };

    expect(isAdminEnabled(features)).toBe(true);
    expect(buildNavItems(features).some((item) => item.path === '/admin')).toBe(true);
  });

  it('exposes FlexInfer and Loom HUD as the primary nav labels with legacy aliases', () => {
    const items = buildNavItems({});
    const flexInfer = items.find((item) => item.path === '/flexinfer');
    const loomHud = items.find((item) => item.path === '/loom-hud');

    expect(flexInfer?.label).toBe('FlexInfer');
    expect(flexInfer?.aliases).toEqual(['/models']);
    expect(isNavItemActive('/models', flexInfer!)).toBe(true);
    expect(isNavItemActive('/flexinfer', flexInfer!)).toBe(true);

    expect(loomHud?.label).toBe('Loom HUD');
    expect(loomHud?.aliases).toEqual(['/agents']);
    expect(isNavItemActive('/agents', loomHud!)).toBe(true);
    expect(isNavItemActive('/loom-hud', loomHud!)).toBe(true);
  });

  it('exposes website metrics as a primary nav item with a traffic alias', () => {
    const items = buildNavItems({});
    const website = items.find((item) => item.path === '/website-metrics');

    expect(website?.label).toBe('Website');
    expect(website?.aliases).toEqual(['/traffic']);
    expect(isNavItemActive('/traffic', website!)).toBe(true);
    expect(isNavItemActive('/website-metrics', website!)).toBe(true);
  });

  it('shows Projects nav item by default and hides it when explicitly disabled', () => {
    expect(buildNavItems({}).some((item) => item.path === '/projects')).toBe(true);
    expect(
      buildNavItems({ projects: { enabled: false } }).some((item) => item.path === '/projects'),
    ).toBe(false);
    expect(
      buildNavItems({ projects: { enabled: true } }).some((item) => item.path === '/projects'),
    ).toBe(true);
  });

  it('dark-launches the Loom control plane nav item (hidden until explicitly enabled)', () => {
    expect(buildNavItems({}).some((item) => item.path === '/loom')).toBe(false);
    expect(
      buildNavItems({ loom_control_plane: { enabled: false } }).some((item) => item.path === '/loom'),
    ).toBe(false);
    expect(
      buildNavItems({ loom_control_plane: { enabled: true } }).some((item) => item.path === '/loom'),
    ).toBe(true);
  });

  it('exposes Stack as the local workspace inventory nav item', () => {
    const items = buildNavItems({});
    const stack = items.find((item) => item.path === '/stack');

    expect(stack?.label).toBe('Stack');
    expect(isNavItemActive('/stack', stack!)).toBe(true);
  });

  it('filters admin tabs based on enabled flags and picks first enabled default', () => {
    const features: FeatureMap = {
      rbac: { enabled: false },
      audit: { enabled: true },
      multi_cluster: { enabled: true },
    };

    const tabs = getAdminTabs(features);
    expect(tabs.map((tab) => tab.id)).toEqual(['audit', 'clusters']);
    expect(getDefaultAdminTab(features)).toBe('audit');
  });

  it('keeps the Phase 4 admin rollout tabs in stable order', () => {
    const features: FeatureMap = {
      rbac: { enabled: true },
      audit: { enabled: true },
      multi_cluster: { enabled: true },
      flexinfer_proxy: { enabled: false },
    };

    expect(isAdminEnabled(features)).toBe(true);
    expect(buildNavItems(features).some((item) => item.path === '/admin')).toBe(true);
    expect(getAdminTabs(features).map((tab) => tab.id)).toEqual(['users', 'audit', 'clusters']);
    expect(getDefaultAdminTab(features)).toBe('users');
  });

  it('returns disabled HUD mode state when both pull and push are off', () => {
    const features: FeatureMap = {
      loom_hud: { enabled: false },
      loom_hud_push: { enabled: false },
    };

    const state = getHudModeState(features);
    expect(state.available).toBe(false);
    expect(state.modeLabel).toBe('Disabled');
    expect(state.disabledReason).toBe('Loom HUD is disabled');
  });

  it('prefers pull HUD mode when both pull and push are enabled', () => {
    const features: FeatureMap = {
      loom_hud: { enabled: true },
      loom_hud_push: { enabled: true },
    };

    const state = getHudModeState(features);
    expect(state.available).toBe(true);
    expect(state.modeLabel).toBe('Pull mode (HUD REST)');
  });

  it('uses push HUD mode when only push is enabled', () => {
    const features: FeatureMap = {
      loom_hud: { enabled: false },
      loom_hud_push: { enabled: true },
    };

    const state = getHudModeState(features);
    expect(state.available).toBe(true);
    expect(state.modeLabel).toBe('Push mode (agent snapshots)');
    expect(state.modeDescription).toBe('Presence snapshots only');
  });

  it('reports direct HUD entry availability from the configured URL', () => {
    const features: FeatureMap = {
      loom_hud: {
        enabled: true,
        url: 'https://loom-hud.example.com',
        directUrl: 'https://loom-hud.example.com',
        passthroughEnabled: true,
        directEntryEnabled: true,
      },
    };

    const state = getHudEntryState(features);
    expect(state.available).toBe(true);
    expect(state.passthroughEnabled).toBe(true);
    expect(state.directEntryEnabled).toBe(true);
    expect(state.directUrl).toBe('https://loom-hud.example.com');
    expect(state.disabledReason).toBeNull();
  });

  it('keeps the direct HUD URL but disables entry when the feature is off', () => {
    const features: FeatureMap = {
      loom_hud: {
        enabled: false,
        url: 'https://loom-hud.example.com',
      },
    };

    const state = getHudEntryState(features);
    expect(state.available).toBe(false);
    expect(state.passthroughEnabled).toBe(false);
    expect(state.directEntryEnabled).toBe(false);
    expect(state.directUrl).toBe('https://loom-hud.example.com');
    expect(state.disabledReason).toBe('Loom HUD is disabled');
  });
});
