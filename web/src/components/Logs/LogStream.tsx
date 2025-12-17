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
    const isError = /error|fatal|panic/i.test(log.line);
    
    if (props.mode === 'rain') {
        const depth = Math.random(); // 0 (close) to 1 (far)
        particles.push({
            x: Math.random(), // 0-1 across screen
            y: -0.2 - Math.random() * 0.3, // Start varying distances above
            z: depth, 
            text: log.line.substring(0, 40), // Longer strands
            color: getLogColor(log.line),
            size: 14 * (1 - depth * 0.5), // Farther = smaller
            speed: (0.005 + Math.random() * 0.008) * (1 - depth * 0.5), // Farther = apparent slowness
            column: Math.floor(Math.random() * 100)
        });
    } else {
        // Warp mode
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.1 + Math.random() * 0.9; 
        particles.push({
          x: Math.cos(angle) * radius, 
          y: Math.sin(angle) * radius,
          z: 2000,
          text: log.line.substring(0, 50) + (log.line.length > 50 ? '...' : ''),
          color: getLogColor(log.line),
          size: 12 + Math.random() * 8,
          speed: 10 + Math.random() * 10,
          angle: angle
        });
    }
  };

  const drawWarp = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    ctx.fillStyle = 'rgba(5, 10, 20, 0.3)';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const rotation = time * 0.0001; 
    
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.z -= p.speed * (props.speed || 2);
      
      if (p.z <= 0) {
        particles.splice(i, 1);
        continue;
      }

      const perspective = 300 / (10 + p.z);
      const ca = Math.cos(rotation);
      const sa = Math.sin(rotation);
      const rx = p.x * ca - p.y * sa;
      const ry = p.x * sa + p.y * ca;

      const screenX = centerX + rx * width * perspective;
      const screenY = centerY + ry * height * perspective;
      
      const alpha = Math.min(1, (2000 - p.z) / 500); 
      const fontSize = Math.max(0, p.size * perspective * 2);
      
      if (fontSize < 2) continue; 
      
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(p.text, screenX, screenY);
      
      if (p.z > 500) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.5 * perspective;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        // Motion blur trails
        const originX = centerX + rx * width * (300 / (10 + p.z + 100));
        const originY = centerY + ry * height * (300 / (10 + p.z + 100));
        ctx.lineTo(originX, originY);
        ctx.stroke();
      }
    }
  };

  const drawRain = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
      // Clear with slight transparency for trails
      ctx.fillStyle = 'rgba(5, 7, 15, 0.2)'; 
      ctx.fillRect(0, 0, width, height);
      
      // Separate particles by depth for painter's algorithm (though usually not strictly needed for text)
      // but helps with density perception if needed. For performance, we just draw.
      
      for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.y += p.speed * (props.speed || 2);

          if (p.y > 1.2) { // Allow to fall slightly off screen
              particles.splice(i, 1);
              continue;
          }

          const x = p.x * width;
          const y = p.y * height;
          const fontSize = p.size;
          
          ctx.font = `${fontSize}px "JetBrains Mono", monospace`;

          // Draw characters vertically
          for (let c = 0; c < p.text.length; c++) {
              const char = p.text[c];
              
              // Base Opacity based on depth (z) and position in tail (d)
              const depthOpacity = 1 - (p.z * 0.6); // Farther = more transparent
              const tailOpacity = 1 - (c / p.text.length); // End of tail = transparent
              
              // Head character logic
              if (c === 0) {
                  ctx.fillStyle = '#ffffff';
                  ctx.globalAlpha = depthOpacity;
                  // Bloom effect for head
                  if (p.z < 0.2) { // Only bloom close particles
                      ctx.shadowBlur = 8;
                      ctx.shadowColor = p.color;
                  } else {
                      ctx.shadowBlur = 0;
                  }
              } else {
                  ctx.fillStyle = p.color;
                  ctx.globalAlpha = depthOpacity * tailOpacity * 0.8;
                  ctx.shadowBlur = 0;
              }
              
              // Glitch effect: Randomly swap characters occasionally
              // Use katakana/kanji range for Matrix feel: 0x30A0
              const isGlitch = Math.random() > 0.99;
              const renderChar = isGlitch ? String.fromCharCode(0x30A0 + Math.random() * 96) : char;
              
              const charY = y - (c * (fontSize * 1.1));
              
              // Cull off-screen chars
              if (charY > -20 && charY < height + 20) {
                 ctx.fillText(renderChar, x, charY);
              }
          }
          ctx.shadowBlur = 0; // Reset
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
      const time = performance.now();
      
      if (props.mode === 'rain') {
          drawRain(ctx, width, height, time);
      } else {
          drawWarp(ctx, width, height, time);
      }
      
      if (particles.length < (props.mode === 'rain' ? 30 : 50) && props.logs.length > 0) {
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
    const latest = props.logs[0]; 
    if (latest) {
        spawnParticle(latest);
    }
  });

  return <canvas ref={canvasRef} class="h-full w-full bg-bg-deep cursor-crosshair" />;
};

export default LogStream;
