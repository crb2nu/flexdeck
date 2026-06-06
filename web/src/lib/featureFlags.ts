import { resolveHudEntryState, type HudEntryState } from './hudCapabilities';

export interface FeatureState {
  enabled: boolean;
  url?: string;
  directUrl?: string;
  passthroughEnabled?: boolean;
  directEntryEnabled?: boolean;
  readOnly?: boolean;
  mode?: string;
}

export type FeatureMap = Record<string, FeatureState | undefined>;

export interface NavItem {
  label: string;
  path: string;
  aliases?: string[];
}

export type AdminTab = 'users' | 'audit' | 'clusters' | 'flexinfer';

export interface AdminTabDef {
  id: AdminTab;
  label: string;
  enabled: boolean;
}

export interface HudModeState {
  pullEnabled: boolean;
  pushEnabled: boolean;
  available: boolean;
  modeLabel: string;
  modeDescription: string;
  disabledReason: string | null;
}

const baseNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'Services', path: '/services' },
  { label: 'Stack', path: '/stack' },
  { label: 'Infra', path: '/infra' },
  { label: 'Flux', path: '/flux' },
  { label: 'Pipeline', path: '/pipeline' },
  { label: 'Logs', path: '/logs' },
  { label: 'Website', path: '/website-metrics', aliases: ['/traffic'] },
  { label: 'Metrics', path: '/metrics' },
  { label: 'FlexInfer', path: '/flexinfer', aliases: ['/models'] },
  { label: 'Loom HUD', path: '/loom-hud', aliases: ['/agents'] },
];

function enabled(features: FeatureMap, key: string): boolean {
  return features[key]?.enabled ?? false;
}

export function isAdminEnabled(features: FeatureMap): boolean {
  return enabled(features, 'rbac') || enabled(features, 'audit') || enabled(features, 'multi_cluster') || enabled(features, 'flexinfer_proxy');
}

export function buildNavItems(features: FeatureMap): NavItem[] {
  const items = [...baseNavItems];
  if (isAdminEnabled(features)) {
    items.push({ label: 'Admin', path: '/admin' });
  }
  return items;
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return pathname === item.path || item.aliases?.includes(pathname) === true;
}

export function getAdminTabs(features: FeatureMap): AdminTabDef[] {
  const tabs: AdminTabDef[] = [
    { id: 'users', label: 'Users', enabled: enabled(features, 'rbac') },
    { id: 'audit', label: 'Audit Log', enabled: enabled(features, 'audit') },
    { id: 'clusters', label: 'Clusters', enabled: enabled(features, 'multi_cluster') },
    { id: 'flexinfer', label: 'FlexInfer', enabled: enabled(features, 'flexinfer_proxy') },
  ];
  return tabs.filter((tab) => tab.enabled);
}

export function getFlexInferManagementMode(features: FeatureMap): 'gitops' | 'admin' {
  return (features.flexinfer_proxy?.mode as 'gitops' | 'admin') || 'gitops';
}

export function getDefaultAdminTab(features: FeatureMap): AdminTab {
  const tabs = getAdminTabs(features);
  return tabs.length > 0 ? tabs[0].id : 'users';
}

export function getHudModeState(features: FeatureMap): HudModeState {
  const pullEnabled = enabled(features, 'loom_hud');
  const pushEnabled = enabled(features, 'loom_hud_push');

  if (pullEnabled) {
    return {
      pullEnabled,
      pushEnabled,
      available: true,
      modeLabel: 'Pull mode (HUD REST)',
      modeDescription: 'Full data (presence/tasks/workflows/claims/timeline)',
      disabledReason: null,
    };
  }

  if (pushEnabled) {
    return {
      pullEnabled,
      pushEnabled,
      available: true,
      modeLabel: 'Push mode (agent snapshots)',
      modeDescription: 'Presence snapshots only',
      disabledReason: null,
    };
  }

  return {
    pullEnabled,
    pushEnabled,
    available: false,
    modeLabel: 'Disabled',
    modeDescription: 'No HUD data',
    disabledReason: 'Loom HUD is disabled',
  };
}

export function getHudEntryState(features: FeatureMap): HudEntryState {
  return resolveHudEntryState(features.loom_hud);
}
