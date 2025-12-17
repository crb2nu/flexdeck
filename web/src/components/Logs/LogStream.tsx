import { Component, onMount, onCleanup, createEffect } from 'solid-js';

interface LogEntry {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
}

interface Props {
  logs: LogEntry[];
  speed?: number; // 1-10
  mode?: 'warp' | 'rain';
}

const LogStream: Component<Props> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animationId: number;
  
  interface LogParticle {
    x: number; 
    y: number; 
    z: number; 
    text: string;
    color: string;
    size: number;
    speed: number;
    angle?: number; // Warp mode
    column?: number; // Rain mode
    isError?: boolean;
    glowIntensity?: number;
    lifetime?: number;
    maxLifetime?: number;
  }

  const particles: LogParticle[] = [];
  
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

  const spawnParticle = (log: LogEntry) => {
    const isError = isErrorLog(log.line);
    
    if (props.mode === 'rain') {
        const depth = Math.random(); // 0 (close) to 1 (far)
        const x = Math.random();
        
        particles.push({
            x: x,
            y: -0.1 - Math.random() * 0.2,
            z: depth, 
            text: log.line.substring(0, 35),
            color: getLogColor(log.line),
            size: 16 * (1 - depth * 0.5),
            speed: (0.004 + Math.random() * 0.006) * (1 - depth * 0.4),
            column: Math.floor(x * 100),
            isError: isError,
            glowIntensity: isError ? 1 : 0.3,
            lifetime: 0,
            maxLifetime: 200 + Math.random() * 100
        });
    } else {
        // Warp mode
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.1 + Math.random() * 0.8; 
        particles.push({
          x: Math.cos(angle) * radius, 
          y: Math.sin(angle) * radius,
          z: 2500,
          text: log.line.substring(0, 60) + (log.line.length > 60 ? '…' : ''),
          color: getLogColor(log.line),
          size: 10 + Math.random() * 6,
          speed: 15 + Math.random() * 15,
          angle: angle,
          isError: isError,
          glowIntensity: isError ? 1 : 0.5
        });
    }
  };

  const drawWarp = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    // Motion blur effect
    ctx.fillStyle = 'rgba(3, 5, 10, 0.15)';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const rotation = time * 0.00005; // Very slow scene rotation
    
    // Sort by z-depth for proper rendering (far to close)
    particles.sort((a, b) => b.z - a.z);
    
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.z -= p.speed * (props.speed || 3);
      
      if (p.z <= 10) {
        particles.splice(i, 1);
        continue;
      }

      const perspective = 400 / (20 + p.z);
      
      // Apply rotation
      const ca = Math.cos(rotation);
      const sa = Math.sin(rotation);
      const rx = p.x * ca - p.y * sa;
      const ry = p.x * sa + p.y * ca;

      const screenX = centerX + rx * width * perspective;
      const screenY = centerY + ry * height * perspective;
      
      const alpha = Math.min(1, (2500 - p.z) / 800) * 0.9; 
      const fontSize = Math.max(2, p.size * perspective * 1.5);
      
      if (fontSize < 2) continue;
      
      ctx.font = `${fontSize}px "JetBrains Mono", "Fira Code", monospace`;
      ctx.globalAlpha = alpha;
      
      // Glow effect for errors
      if (p.isError && p.glowIntensity) {
        ctx.shadowBlur = 15 * p.glowIntensity;
        ctx.shadowColor = p.color;
      } else {
        ctx.shadowBlur = 3;
        ctx.shadowColor = p.color;
      }
      
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, screenX, screenY);
      
      // Draw motion trail (streaks)
      if (p.z > 300) {
        const trailLength = Math.min(150, p.speed * 2);
        const gradient = ctx.createLinearGradient(
          screenX, screenY,
          centerX + rx * width * (400 / (20 + p.z + trailLength)),
          centerY + ry * height * (400 / (20 + p.z + trailLength))
        );
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, 'transparent');
        
        ctx.strokeStyle = gradient;
        ctx.lineWidth = fontSize * 0.1;
        ctx.globalAlpha = alpha * 0.3;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        const originX = centerX + rx * width * (400 / (20 + p.z + trailLength));
        const originY = centerY + ry * height * (400 / (20 + p.z + trailLength));
        ctx.lineTo(originX, originY);
        ctx.stroke();
      }
    }
    
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };

  const drawRain = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
      // Clear with transparency for trails
      ctx.fillStyle = 'rgba(3, 5, 10, 0.12)'; 
      ctx.fillRect(0, 0, width, height);
      
      // Add scanline effect
      ctx.fillStyle = 'rgba(0, 240, 255, 0.02)';
      const scanY = (time * 0.1) % height;
      ctx.fillRect(0, scanY, width, 2);
      
      for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.y += p.speed * (props.speed || 2);
          p.lifetime = (p.lifetime || 0) + 1;

          if (p.y > 1.3) {
              particles.splice(i, 1);
              continue;
          }

          const x = p.x * width;
          const y = p.y * height;
          const fontSize = p.size;
          const depthFactor = 1 - (p.z * 0.5);
          
          ctx.font = `${fontSize}px "JetBrains Mono", "Fira Code", monospace`;

          // Draw each character vertically
          const charCount = Math.min(p.text.length, 25);
          
          for (let c = 0; c < charCount; c++) {
              const charY = y - (c * (fontSize * 1.05));
              
              // Skip offscreen chars
              if (charY < -fontSize || charY > height + fontSize) continue;
              
              // Determine character to draw
              const isGlitch = Math.random() > 0.97;
              const char = isGlitch ? getMatrixChar() : p.text[c];
              
              // Calculate opacity
              const tailOpacity = 1 - (c / charCount);
              const fadeIn = Math.min(1, (p.lifetime || 0) / 20);
              const baseOpacity = depthFactor * tailOpacity * fadeIn;
              
              if (c === 0) {
                  // Head character - bright white with glow
                  ctx.fillStyle = '#ffffff';
                  ctx.globalAlpha = depthFactor * fadeIn;
                  
                  if (p.isError) {
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

    const loop = () => {
      if (!canvasRef) return;
      animationId = requestAnimationFrame(loop);
      const width = canvasRef.clientWidth;
      const height = canvasRef.clientHeight;
      const time = performance.now();
      
      if (props.mode === 'rain') {
          drawRain(ctx, width, height, time);
      } else {
          drawWarp(ctx, width, height, time);
      }
      
      // Spawn from existing logs for visual density
      const maxParticles = props.mode === 'rain' ? 40 : 60;
      if (particles.length < maxParticles && props.logs.length > 0) {
          const randomLog = props.logs[Math.floor(Math.random() * Math.min(props.logs.length, 50))];
          if (randomLog) spawnParticle(randomLog);
      }
    };
    loop();

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    });
  });

  // Spawn particles for new log entries
  createEffect(() => {
    const latest = props.logs[0]; 
    if (latest) {
        spawnParticle(latest);
        // Errors spawn extra for emphasis
        if (isErrorLog(latest.line)) {
            setTimeout(() => spawnParticle(latest), 50);
        }
    }
  });

  return <canvas ref={canvasRef} class="h-full w-full bg-[#030510] cursor-crosshair" />;
};

export default LogStream;
