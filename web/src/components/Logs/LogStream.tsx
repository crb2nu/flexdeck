import { Component, onMount, onCleanup, createEffect } from 'solid-js';

interface LogEntry {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
}

interface Props {
  logs: LogEntry[];
  speed?: number; // 1-10
}

const LogStream: Component<Props> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animationId: number;
  
  // Warp star analogy:
  // x, y = random position on screen (or normalized 2d)
  // z = depth (starts far, moves close)
  interface LogParticle {
    x: number; // -1 to 1 normalized coord
    y: number; // -1 to 1 normalized coord
    z: number; // Distance from camera (starts at e.g. 1000, moves to 0)
    text: string;
    color: string;
    size: number;
    speed: number;
    angle: number; // Angle from center
  }

  const particles: LogParticle[] = [];
  
  const getLogColor = (line: string) => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return '#ff0055'; // Neon Red
    if (lower.includes('warn')) return '#ffaa00'; // Neon Orange
    if (lower.includes('debug')) return '#4d4d4d'; // Dim
    return '#00d9ff'; // Neon Cyan
  };

  const spawnParticle = (log: LogEntry) => {
    // Spawn at random angle, far away
    const angle = Math.random() * Math.PI * 2;
    // Don't spawn too close to center to keep readability
    const radius = 0.2 + Math.random() * 0.8; 
    
    particles.push({
      x: Math.cos(angle) * radius, 
      y: Math.sin(angle) * radius,
      z: 2000,
      text: log.line.substring(0, 50) + (log.line.length > 50 ? '...' : ''),
      color: getLogColor(log.line),
      size: 12 + Math.random() * 8, // Varies slightly
      speed: 10 + Math.random() * 10,
      angle: angle
    });
  };

  const draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Clear with trail effect for "speed"
    ctx.fillStyle = 'rgba(5, 10, 20, 0.3)'; // Semi-transparent black background
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    
    // Move and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      
      // Move closer
      p.z -= p.speed * (props.speed || 2);
      
      if (p.z <= 0) {
        particles.splice(i, 1);
        continue;
      }

      // Perspective projection
      // as z gets smaller, scale gets bigger
      const perspective = 300 / (10 + p.z); // magic numbers for FOV
      
      const screenX = centerX + p.x * width * perspective;
      const screenY = centerY + p.y * height * perspective;
      
      const alpha = Math.min(1, (2000 - p.z) / 500); // Fade in
      const fontSize = Math.max(0, p.size * perspective * 2);
      
      if (fontSize < 2) continue; // Optimization
      
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      
      // Rotate text to match angle? Maybe too messy.
      // Let's keep it horizontal for readability.
      
      // Draw text
      ctx.fillText(p.text, screenX, screenY);
      
      // Draw connecting line to center for "warp" effect
      if (p.z > 500) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.5 * perspective;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        // Point back towards vanishing point
        const originX = centerX + p.x * width * (300 / (10 + p.z + 100));
        const originY = centerY + p.y * height * (300 / (10 + p.z + 100));
        ctx.lineTo(originX, originY);
        ctx.stroke();
      }
    }
  };

  onMount(() => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      if (!canvasRef) return;
      canvasRef.width = canvasRef.clientWidth * window.devicePixelRatio;
      canvasRef.height = canvasRef.clientHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      if (!canvasRef) return;
      animationId = requestAnimationFrame(loop);
      const width = canvasRef.clientWidth;
      const height = canvasRef.clientHeight;
      draw(ctx, width, height);
      
      // Auto-spawn random logs if none coming in (Demo Mode)
      // In real usage, props.logs changes would trigger spawns.
      // But for "Stream" effect we might want to just visualize the existing buffer looping
      if (particles.length < 50 && props.logs.length > 0) {
          const randomLog = props.logs[Math.floor(Math.random() * props.logs.length)];
          if (randomLog) spawnParticle(randomLog);
      }
    };
    loop();

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    });
  });

  // Effect to spawn new logs when they arrive
  createEffect(() => {
    // Naive: just take the last added log and spawn it multiple times for effect?
    // Better: If props.logs grows, spawn the new ones.
    const latest = props.logs[0]; // Assuming logs are sorted new -> old
    if (latest) {
        // burst
        spawnParticle(latest);
    }
  });

  return <canvas ref={canvasRef} class="h-full w-full bg-bg-deep cursor-crosshair" />;
};

export default LogStream;
