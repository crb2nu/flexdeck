// Configuration for HoloDeck

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
        background: '#030508',
        node: {
            base: 0x111111,
            tower: 0x050a10,
            ready: 0x00f0ff,
            error: 0xff0055,
            edge: 0x00f0ff, // Fallback if no status
        },
        pod: {
            running: 0x22c55e,
            pending: 0xeab308,
            error: 0xef4444,
        },
        service: {
            primary: 0xa855f7,
            edge: 0xd8b4fe,
        },
        traffic: {
            default: 0xffffff,
            service: 0xa855f7,
        },
        rings: {
            cpu: 0x0aff68,
            mem: 0x00f0ff,
            warning: 0xfcee0a,
            critical: 0xff003c,
            bg: 0x222222
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
        healthy: 0x00f0ff,   // Cyan - normal traffic flow
        warning: 0xfcee0a,   // Yellow - elevated latency
        error: 0xff003c,     // Red - failed requests
        ingress: 0xa855f7,   // Purple - external traffic
        internal: 0x0aff68,  // Green - pod-to-pod
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
        healthy: 0x0aff68,
        warning: 0xfcee0a,
        critical: 0xff003c,
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
