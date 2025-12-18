import { Component, onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js';

export interface LogEntry {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
}

export interface LogFilter {
  levels?: string[]; // 'error' | 'warn' | 'info' | 'debug'
  searchTerm?: string;
  searchRegex?: boolean; // Enable regex search
}

interface Props {
  logs: LogEntry[];
  speed?: number; // 1-10
  mode?: 'warp' | 'rain';
  filter?: LogFilter;
  onLogClick?: (log: LogEntry) => void;
  paused?: boolean;
}

// Performance: Fixed-size particle pool to avoid array mutations
const MAX_PARTICLES = 80;

interface LogParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  speed: number;
  angle: number;
  column: number;
  isError: boolean;
  glowIntensity: number;
  lifetime: number;
  maxLifetime: number;
  logEntry: LogEntry | null; // Reference to original log for click handling
  matchesFilter: boolean; // For filter visualization
  isSearchMatch: boolean; // For search highlighting
}

const createEmptyParticle = (): LogParticle => ({
  active: false,
  x: 0,
  y: 0,
  z: 0,
  text: '',
  color: '#00d9ff',
  size: 10,
  speed: 0,
  angle: 0,
  column: 0,
  isError: false,
  glowIntensity: 0.3,
  lifetime: 0,
  maxLifetime: 200,
  logEntry: null,
  matchesFilter: true,
  isSearchMatch: false
});

const LogStream: Component<Props> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animationId: number;

  // Pause state for hover-to-pause feature
  const [isPaused, setIsPaused] = createSignal(false);
  const [hoverPos, setHoverPos] = createSignal<{ x: number; y: number } | null>(null);

  // Visual polish state
  const [errorFlash, setErrorFlash] = createSignal(0); // 0-1 intensity for error flash overlay
  const [modeTransition, setModeTransition] = createSignal(0); // 0-1 for fade transition
  let previousMode = props.mode || 'warp';
  let errorFlashTimeout: ReturnType<typeof setTimeout> | null = null;

  // Performance: Fixed-size particle pool
  const particlePool: LogParticle[] = Array.from({ length: MAX_PARTICLES }, createEmptyParticle);
  let activeParticleCount = 0;

  // Performance: Throttle spawning
  let lastSpawnTime = 0;
  const MIN_SPAWN_INTERVAL = 50; // ms

  // Katakana code range for Matrix feel
  const getMatrixChar = () => String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
  
  const getLogColor = (line: string) => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return '#ff0055';
    if (lower.includes('warn')) return '#ffaa00';
    if (lower.includes('debug')) return '#3d5a80';
    if (lower.includes('info')) return '#00d9ff';
    return '#00d9ff';
  };

  const isErrorLog = (line: string) => /error|fatal|panic/i.test(line);

  const getLogLevel = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return 'error';
    if (lower.includes('warn')) return 'warn';
    if (lower.includes('debug') || lower.includes('trace')) return 'debug';
    return 'info';
  };

  const logMatchesFilter = (log: LogEntry, filter?: LogFilter): { matches: boolean; isSearchMatch: boolean } => {
    if (!filter) return { matches: true, isSearchMatch: false };

    const level = getLogLevel(log.line);

    // Level filter
    if (filter.levels && filter.levels.length > 0 && !filter.levels.includes(level)) {
      return { matches: false, isSearchMatch: false };
    }

    // Search term filter (supports regex)
    if (filter.searchTerm && filter.searchTerm.trim()) {
      let searchMatch = false;

      if (filter.searchRegex) {
        // Try regex search, fall back to string search on invalid regex
        try {
          const regex = new RegExp(filter.searchTerm, 'i');
          searchMatch = regex.test(log.line);
        } catch {
          // Invalid regex - fall back to string search
          searchMatch = log.line.toLowerCase().includes(filter.searchTerm.toLowerCase());
        }
      } else {
        // Plain string search
        searchMatch = log.line.toLowerCase().includes(filter.searchTerm.toLowerCase());
      }

      return { matches: true, isSearchMatch: searchMatch };
    }

    return { matches: true, isSearchMatch: false };
  };

  // Performance: Find inactive slot in pool (O(n) but pool is fixed size)
  const findInactiveSlot = (): number => {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!particlePool[i].active) return i;
    }
    return -1; // Pool full
  };

  // Performance: Throttled spawn with pool allocation
  const spawnParticle = (log: LogEntry, force = false) => {
    const now = performance.now();
    if (!force && now - lastSpawnTime < MIN_SPAWN_INTERVAL) return;
    lastSpawnTime = now;

    const slotIndex = findInactiveSlot();
    if (slotIndex === -1) return; // Pool exhausted

    const p = particlePool[slotIndex];
    const isError = isErrorLog(log.line);

    // Check filter match status
    const { matches, isSearchMatch } = logMatchesFilter(log, props.filter);
    p.matchesFilter = matches;
    p.isSearchMatch = isSearchMatch;

    p.active = true;
    p.logEntry = log;
    p.isError = isError;
    p.color = isSearchMatch ? '#ffdd00' : getLogColor(log.line); // Yellow for search matches
    p.lifetime = 0;

    // Error flash effect - quick red tint on error arrival
    if (isError && force) { // Only flash for newly arriving errors, not recycled ones
      setErrorFlash(0.3);
      if (errorFlashTimeout) clearTimeout(errorFlashTimeout);
      errorFlashTimeout = setTimeout(() => setErrorFlash(0), 150);
    }

    if (props.mode === 'rain') {
      const depth = Math.random();
      const x = Math.random();
      p.x = x;
      p.y = -0.1 - Math.random() * 0.2;
      p.z = depth;
      p.text = log.line.substring(0, 35);
      p.size = 16 * (1 - depth * 0.5);
      p.speed = (0.004 + Math.random() * 0.006) * (1 - depth * 0.4);
      p.column = Math.floor(x * 100);
      p.glowIntensity = isError ? 1 : 0.3;
      p.maxLifetime = 200 + Math.random() * 100;
    } else {
      // Warp mode
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.1 + Math.random() * 0.8;
      p.x = Math.cos(angle) * radius;
      p.y = Math.sin(angle) * radius;
      p.z = 2500;
      p.text = log.line.substring(0, 60) + (log.line.length > 60 ? '…' : '');
      p.size = 10 + Math.random() * 6;
      p.speed = 15 + Math.random() * 15;
      p.angle = angle;
      p.glowIntensity = isError ? 1 : 0.5;
    }

    activeParticleCount++;
  };

  const drawWarp = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, paused: boolean) => {
    // Motion blur effect
    ctx.fillStyle = 'rgba(3, 5, 10, 0.15)';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const rotation = time * 0.00005;
    const speedMultiplier = paused ? 0 : (props.speed || 3);

    // Performance: No sorting needed - draw all active particles
    // Far particles naturally occlude less due to smaller size
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlePool[i];
      if (!p.active) continue;

      // Update position (skip if paused)
      if (!paused) {
        p.z -= p.speed * speedMultiplier;
      }

      if (p.z <= 10) {
        p.active = false;
        activeParticleCount--;
        continue;
      }

      const perspective = 400 / (20 + p.z);
      const ca = Math.cos(rotation);
      const sa = Math.sin(rotation);
      const rx = p.x * ca - p.y * sa;
      const ry = p.x * sa + p.y * ca;

      const screenX = centerX + rx * width * perspective;
      const screenY = centerY + ry * height * perspective;

      // Base alpha - dim non-matching particles
      const filterOpacity = p.matchesFilter ? 1 : 0.2;
      const searchBoost = p.isSearchMatch ? 1.2 : 1; // Search matches are brighter
      const alpha = Math.min(1, (2500 - p.z) / 800) * 0.9 * filterOpacity * searchBoost;
      const fontSize = Math.max(2, p.size * perspective * 1.5) * (p.isSearchMatch ? 1.3 : 1); // Search matches larger

      if (fontSize < 2) continue;

      ctx.font = `${p.isSearchMatch ? 'bold ' : ''}${fontSize}px "JetBrains Mono", "Fira Code", monospace`;
      ctx.globalAlpha = alpha;

      // Glow effect for errors and search matches
      if (p.isSearchMatch) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ffdd00';
      } else if (p.isError && p.glowIntensity) {
        ctx.shadowBlur = 15 * p.glowIntensity * filterOpacity;
        ctx.shadowColor = p.color;
      } else if (p.matchesFilter) {
        ctx.shadowBlur = 3;
        ctx.shadowColor = p.color;
      } else {
        ctx.shadowBlur = 0; // No glow for non-matching
      }

      ctx.fillStyle = p.color;
      ctx.fillText(p.text, screenX, screenY);

      // Draw motion trail (streaks) - skip gradient creation when far away
      if (p.z > 300 && p.z < 2000) {
        const trailLength = Math.min(150, p.speed * 2);
        const endPerspective = 400 / (20 + p.z + trailLength);
        const originX = centerX + rx * width * endPerspective;
        const originY = centerY + ry * height * endPerspective;

        // Performance: Simple line instead of gradient for trails
        ctx.strokeStyle = p.color;
        ctx.lineWidth = fontSize * 0.1;
        ctx.globalAlpha = alpha * 0.3;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(originX, originY);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };

  const drawRain = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, paused: boolean) => {
    // Clear with transparency for trails
    ctx.fillStyle = 'rgba(3, 5, 10, 0.12)';
    ctx.fillRect(0, 0, width, height);

    // Add scanline effect
    ctx.fillStyle = 'rgba(0, 240, 255, 0.02)';
    const scanY = (time * 0.1) % height;
    ctx.fillRect(0, scanY, width, 2);

    const speedMultiplier = paused ? 0 : (props.speed || 2);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlePool[i];
      if (!p.active) continue;

      // Update position
      if (!paused) {
        p.y += p.speed * speedMultiplier;
        p.lifetime++;
      }

      if (p.y > 1.3) {
        p.active = false;
        activeParticleCount--;
        continue;
      }

      const x = p.x * width;
      const y = p.y * height;
      const fontSize = p.size * (p.isSearchMatch ? 1.2 : 1); // Search matches larger
      const depthFactor = 1 - (p.z * 0.5);
      const filterOpacity = p.matchesFilter ? 1 : 0.2;

      ctx.font = `${p.isSearchMatch ? 'bold ' : ''}${fontSize}px "JetBrains Mono", "Fira Code", monospace`;

      // Draw each character vertically
      const charCount = Math.min(p.text.length, 25);

      for (let c = 0; c < charCount; c++) {
        const charY = y - (c * (fontSize * 1.05));

        // Skip offscreen chars
        if (charY < -fontSize || charY > height + fontSize) continue;

        // Determine character to draw
        const isGlitch = Math.random() > 0.97;
        const char = isGlitch ? getMatrixChar() : p.text[c];

        // Calculate opacity - dim non-matching particles
        const tailOpacity = 1 - (c / charCount);
        const fadeIn = Math.min(1, p.lifetime / 20);
        const baseOpacity = depthFactor * tailOpacity * fadeIn * filterOpacity;

        if (c === 0) {
          // Head character - bright white with glow (unless filtered)
          ctx.fillStyle = p.isSearchMatch ? '#ffdd00' : '#ffffff';
          ctx.globalAlpha = depthFactor * fadeIn * filterOpacity;

          if (p.isSearchMatch) {
            ctx.shadowBlur = 25;
            ctx.shadowColor = '#ffdd00';
          } else if (!p.matchesFilter) {
            ctx.shadowBlur = 0;
          } else if (p.isError) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ff0055';
          } else if (p.z < 0.3) {
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#00ffff';
          } else {
            ctx.shadowBlur = 6;
            ctx.shadowColor = p.color;
          }
        } else {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = baseOpacity * 0.85;
          ctx.shadowBlur = p.isError ? 4 : 0;
        }

        ctx.fillText(char || ' ', x, charY);
      }

      // Draw reflection/echo for close particles
      if (p.z < 0.2 && p.y > 0.3) {
        ctx.globalAlpha = 0.05 * depthFactor;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text[0] || '', x, y + fontSize * 2);
      }
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };

  onMount(() => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      if (!canvasRef) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvasRef.width = canvasRef.clientWidth * dpr;
      canvasRef.height = canvasRef.clientHeight * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // Mouse event handlers for pause-on-hover
    const handleMouseEnter = () => setIsPaused(true);
    const handleMouseLeave = () => {
      setIsPaused(false);
      setHoverPos(null);
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    canvasRef.addEventListener('mouseenter', handleMouseEnter);
    canvasRef.addEventListener('mouseleave', handleMouseLeave);
    canvasRef.addEventListener('mousemove', handleMouseMove);

    const loop = () => {
      if (!canvasRef) return;
      animationId = requestAnimationFrame(loop);
      const width = canvasRef.clientWidth;
      const height = canvasRef.clientHeight;
      const time = performance.now();
      const paused = isPaused() || props.paused || false;

      if (props.mode === 'rain') {
          drawRain(ctx, width, height, time, paused);
      } else {
          drawWarp(ctx, width, height, time, paused);
      }

      // Spawn from existing logs for visual density (only when not paused)
      if (!paused) {
        const maxActive = props.mode === 'rain' ? 40 : 60;
        if (activeParticleCount < maxActive && props.logs.length > 0) {
            const randomLog = props.logs[Math.floor(Math.random() * Math.min(props.logs.length, 50))];
            if (randomLog) spawnParticle(randomLog);
        }
      }
    };
    loop();

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      canvasRef?.removeEventListener('mouseenter', handleMouseEnter);
      canvasRef?.removeEventListener('mouseleave', handleMouseLeave);
      canvasRef?.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationId);
    });
  });

  // Spawn particles for new log entries
  createEffect(() => {
    const latest = props.logs[0];
    if (latest) {
        spawnParticle(latest, true); // force=true for new arrivals (triggers error flash)
        // Errors spawn extra for emphasis
        if (isErrorLog(latest.line)) {
            setTimeout(() => spawnParticle(latest, true), 50);
        }
    }
  });

  // Mode transition effect
  createEffect(() => {
    const currentMode = props.mode || 'warp';
    if (currentMode !== previousMode) {
      // Fade out
      setModeTransition(1);
      // Clear particles for clean transition
      for (let i = 0; i < MAX_PARTICLES; i++) {
        particlePool[i].active = false;
      }
      activeParticleCount = 0;
      // Fade in after brief delay
      setTimeout(() => setModeTransition(0), 200);
      previousMode = currentMode;
    }
  });

  // Handle click to find nearest particle
  const handleCanvasClick = (e: MouseEvent) => {
    if (!canvasRef || !props.onLogClick) return;
    const rect = canvasRef.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    // Find nearest active particle
    let nearest: LogParticle | null = null;
    let nearestDist = Infinity;
    const threshold = 0.05; // 5% of canvas size

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlePool[i];
      if (!p.active || !p.logEntry) continue;

      const dist = Math.sqrt(Math.pow(p.x - clickX, 2) + Math.pow(p.y - clickY, 2));
      if (dist < nearestDist && dist < threshold) {
        nearest = p;
        nearestDist = dist;
      }
    }

    if (nearest && nearest.logEntry) {
      props.onLogClick(nearest.logEntry);
    }
  };

  return (
    <div class="relative h-full w-full">
      <canvas
        ref={canvasRef}
        class="h-full w-full bg-[#030510] cursor-crosshair"
        onClick={handleCanvasClick}
      />

      {/* Error flash overlay */}
      <Show when={errorFlash() > 0}>
        <div
          class="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, rgba(255, 0, 85, ${errorFlash()}) 0%, transparent 70%)`,
            transition: 'opacity 0.1s ease-out'
          }}
        />
      </Show>

      {/* Mode transition overlay */}
      <Show when={modeTransition() > 0}>
        <div
          class="absolute inset-0 pointer-events-none bg-[#030510]"
          style={{
            opacity: modeTransition(),
            transition: 'opacity 0.2s ease-in-out'
          }}
        />
      </Show>

      {/* Pause indicator */}
      <Show when={isPaused()}>
        <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div class="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/20">
            <div class="text-neon-cyan text-sm font-mono tracking-wider">PAUSED</div>
            <div class="text-text-dim text-xs mt-1">{activeParticleCount} particles</div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default LogStream;
