import { Component, createSignal, createEffect, For } from 'solid-js';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityConfig {
  dustParticles: number;
  maxTraffic: number;
  bloomEnabled: boolean;
  maxLogParticles: number;
  maxPipelineParticles: number;
  shadowsEnabled: boolean;
  antialias: boolean;
  targetFPS: number;
}

const qualityPresets: Record<QualityLevel, QualityConfig> = {
  low: {
    dustParticles: 100,
    maxTraffic: 5,
    bloomEnabled: false,
    maxLogParticles: 50,
    maxPipelineParticles: 20,
    shadowsEnabled: false,
    antialias: false,
    targetFPS: 30
  },
  medium: {
    dustParticles: 300,
    maxTraffic: 10,
    bloomEnabled: true,
    maxLogParticles: 100,
    maxPipelineParticles: 40,
    shadowsEnabled: false,
    antialias: true,
    targetFPS: 45
  },
  high: {
    dustParticles: 500,
    maxTraffic: 20,
    bloomEnabled: true,
    maxLogParticles: 150,
    maxPipelineParticles: 60,
    shadowsEnabled: true,
    antialias: true,
    targetFPS: 60
  }
};

const STORAGE_KEY = 'flexdeck-quality-settings';

// Get current quality from localStorage or default to medium
export const getQualityConfig = (): QualityConfig => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const level = stored as QualityLevel;
    if (qualityPresets[level]) {
      return qualityPresets[level];
    }
  }
  return qualityPresets.medium;
};

export const getQualityLevel = (): QualityLevel => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && ['low', 'medium', 'high'].includes(stored)) {
    return stored as QualityLevel;
  }
  return 'medium';
};

const QualitySettings: Component<{
  onChange?: (config: QualityConfig) => void;
  compact?: boolean;
}> = (props) => {
  const [quality, setQuality] = createSignal<QualityLevel>(getQualityLevel());
  const [isOpen, setIsOpen] = createSignal(false);

  // Persist and notify on change
  createEffect(() => {
    const level = quality();
    localStorage.setItem(STORAGE_KEY, level);
    props.onChange?.(qualityPresets[level]);
  });

  const qualityOptions: { level: QualityLevel; label: string; description: string }[] = [
    { level: 'low', label: 'Low', description: 'Best performance' },
    { level: 'medium', label: 'Medium', description: 'Balanced' },
    { level: 'high', label: 'High', description: 'Best visuals' }
  ];

  const currentConfig = () => qualityPresets[quality()];

  if (props.compact) {
    return (
      <div class="relative">
        <button
          onClick={() => setIsOpen(!isOpen())}
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-200"
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}
        >
          <span class="text-text-muted">Quality:</span>
          <span class="text-neon-cyan">{quality()}</span>
          <span class="text-text-dim ml-1">{isOpen() ? '▲' : '▼'}</span>
        </button>

        {/* Dropdown */}
        <div
          class="absolute top-full right-0 mt-2 min-w-[160px] rounded-lg overflow-hidden z-50 transition-all duration-200"
          style={{
            background: 'rgba(10, 16, 32, 0.98)',
            border: '1px solid rgba(0, 240, 255, 0.2)',
            'box-shadow': '0 10px 40px rgba(0, 0, 0, 0.5)',
            opacity: isOpen() ? '1' : '0',
            transform: isOpen() ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.95)',
            'pointer-events': isOpen() ? 'auto' : 'none'
          }}
        >
          <For each={qualityOptions}>
            {(option) => (
              <button
                onClick={() => {
                  setQuality(option.level);
                  setIsOpen(false);
                }}
                class="w-full px-4 py-3 text-left transition-all duration-150 hover:bg-white/5"
                style={{
                  background: quality() === option.level ? 'rgba(0, 240, 255, 0.1)' : 'transparent',
                  'border-left': quality() === option.level
                    ? '2px solid #00f0ff'
                    : '2px solid transparent'
                }}
              >
                <div class="flex items-center justify-between">
                  <span
                    class="font-mono text-sm font-bold"
                    style={{
                      color: quality() === option.level ? '#00f0ff' : 'rgba(255, 255, 255, 0.8)'
                    }}
                  >
                    {option.label}
                  </span>
                  {quality() === option.level && (
                    <span class="text-neon-cyan">✓</span>
                  )}
                </div>
                <div class="text-[10px] text-text-dim mt-0.5">{option.description}</div>
              </button>
            )}
          </For>
        </div>
      </div>
    );
  }

  // Full panel view
  return (
    <div
      class="p-4 rounded-xl"
      style={{
        background: 'rgba(10, 16, 32, 0.8)',
        border: '1px solid rgba(0, 240, 255, 0.1)'
      }}
    >
      <h3 class="text-sm font-mono uppercase tracking-wider text-text-muted mb-4">
        Quality Settings
      </h3>

      {/* Quality selector */}
      <div class="flex gap-2 mb-4">
        <For each={qualityOptions}>
          {(option) => (
            <button
              onClick={() => setQuality(option.level)}
              class="flex-1 py-2 px-3 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-200"
              style={{
                background: quality() === option.level
                  ? 'rgba(0, 240, 255, 0.2)'
                  : 'rgba(255, 255, 255, 0.05)',
                border: quality() === option.level
                  ? '1px solid rgba(0, 240, 255, 0.5)'
                  : '1px solid rgba(255, 255, 255, 0.1)',
                color: quality() === option.level
                  ? '#00f0ff'
                  : 'rgba(255, 255, 255, 0.6)'
              }}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>

      {/* Current settings display */}
      <div class="space-y-2 text-xs font-mono">
        <div class="flex justify-between items-center text-text-dim">
          <span>Dust Particles</span>
          <span class="text-white">{currentConfig().dustParticles}</span>
        </div>
        <div class="flex justify-between items-center text-text-dim">
          <span>Max Traffic</span>
          <span class="text-white">{currentConfig().maxTraffic}</span>
        </div>
        <div class="flex justify-between items-center text-text-dim">
          <span>Bloom Effect</span>
          <span style={{ color: currentConfig().bloomEnabled ? '#0aff68' : '#ff003c' }}>
            {currentConfig().bloomEnabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <div class="flex justify-between items-center text-text-dim">
          <span>Log Particles</span>
          <span class="text-white">{currentConfig().maxLogParticles}</span>
        </div>
        <div class="flex justify-between items-center text-text-dim">
          <span>Target FPS</span>
          <span class="text-neon-cyan">{currentConfig().targetFPS}</span>
        </div>
      </div>
    </div>
  );
};

export default QualitySettings;
export { qualityPresets };
