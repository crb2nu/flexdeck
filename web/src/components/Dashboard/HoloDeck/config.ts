// Configuration for HoloDeck
// Colors are token-mirror ints from lib/vizTokens — three.js materials
// cannot resolve CSS var(), so this is the sanctioned hex path.

import { VIZ_TOKEN_HEX, VIZ_VIOLET_LIGHT, hexToInt, tokenHexInt } from '../../../lib/vizTokens';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  dustParticleCount: number;
  maxTrafficPackets: number;
  bloomEnabled: boolean;
  particleSize: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: { dustParticleCount: 200, maxTrafficPackets: 20, bloomEnabled: false, particleSize: 0.2 },
  medium: { dustParticleCount: 600, maxTrafficPackets: 50, bloomEnabled: true, particleSize: 0.15 },
  high: { dustParticleCount: 1200, maxTrafficPackets: 80, bloomEnabled: true, particleSize: 0.12 }
};

export const HOLO_THEME = {
    colors: {
        background: VIZ_TOKEN_HEX.bgPrimary,
        node: {
            base: tokenHexInt('bgTertiary'),
            tower: tokenHexInt('bgPrimary'),
            ready: tokenHexInt('info'),
            error: tokenHexInt('error'),
            edge: tokenHexInt('info'), // Fallback if no status
        },
        pod: {
            running: tokenHexInt('success'),
            pending: tokenHexInt('warning'),
            error: tokenHexInt('error'),
        },
        service: {
            primary: tokenHexInt('violet'),
            edge: hexToInt(VIZ_VIOLET_LIGHT),
        },
        traffic: {
            default: 0xffffff,
            service: tokenHexInt('violet'),
        },
        rings: {
            cpu: tokenHexInt('success'),
            mem: tokenHexInt('info'),
            warning: tokenHexInt('warning'),
            critical: tokenHexInt('error'),
            bg: tokenHexInt('bgElevated')
        }
    },
    dimensions: {
        nodeRadius: 12,
        serviceRingOffset: 8,
    }
};

export const TRAFFIC_CONFIG = {
    MAX_TRAFFIC: 100,
    MAX_SERVICE_TRAFFIC: 60,
    TRAFFIC_SPAWN_INTERVAL: 120,
    SERVICE_SPAWN_INTERVAL: 200,
    colors: {
        healthy: tokenHexInt('info'),     // normal traffic flow
        warning: tokenHexInt('warning'),  // elevated latency
        error: tokenHexInt('error'),      // failed requests
        ingress: tokenHexInt('violet'),   // external traffic
        internal: tokenHexInt('success'), // pod-to-pod
    },
    typeWeights: {
        healthy: 0.70,
        warning: 0.18,
        error: 0.05,
        internal: 0.07,
    }
};

export type TrafficType = 'healthy' | 'warning' | 'error' | 'ingress' | 'internal';

export interface ClusterHealthData {
    apiServerHealthy: boolean;
    controlPlaneHealthy: boolean;
    healthPercent: number;
    nodesReady: number;
    nodesTotal: number;
    podsRunning: number;
    podsTotal: number;
}

export const HEALTH_HUB_CONFIG = {
    orbRadius: 1.2,
    ringRadii: [2.0, 3.0, 4.0],
    ringWidth: 0.15,
    colors: {
        healthy: tokenHexInt('success'),
        warning: tokenHexInt('warning'),
        critical: tokenHexInt('error'),
    },
    thresholds: {
        warning: 0.9,  // Below 90% = warning
        critical: 0.7, // Below 70% = critical
    },
    pulseSpeed: {
        healthy: 0.5,
        warning: 1.5,
        critical: 3.0,
    }
};
