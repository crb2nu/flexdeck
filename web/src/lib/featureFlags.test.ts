import { describe, expect, it } from 'vitest';

import {
  buildNavItems,
  getAdminTabs,
  getDefaultAdminTab,
  getHudModeState,
  isAdminEnabled,
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
});
