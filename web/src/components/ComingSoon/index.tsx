import { Component, onMount, onCleanup } from 'solid-js';
import { useLocation } from '@solidjs/router';

const ComingSoon: Component = () => {
  const location = useLocation();
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animationId: number;

  const pageName = () => {
    const path = location.pathname.slice(1);
    if (!path) return 'SYSTEM';
    return path.charAt(0).toUpperCase() + path.slice(1);
  };

  onMount(() => {
    if (!canvasRef || !containerRef) return;
    
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      if (containerRef && canvasRef) {
        canvasRef.width = containerRef.clientWidth;
        canvasRef.height = containerRef.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    // Matrix Rain configuration
    const fontSize = 14;
    const columns = Math.floor(canvasRef.width / fontSize);
    const drops: number[] = new Array(columns).fill(1);
    const chars = "01FLEXDECKxyz<>[]{}*&^%#@!"; 
    // const chars = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ"; // Classic Katakana if preferred

    const draw = () => {
      // Semi-transparent black to create trail effect
      ctx.fillStyle = 'rgba(6, 12, 16, 0.05)';
      ctx.fillRect(0, 0, canvasRef!.width, canvasRef!.height);

      ctx.fillStyle = '#00c8ff'; // Loom-core info
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        // Random character
        const text = chars[Math.floor(Math.random() * chars.length)];
        
        // x = column index * font size, y = drop value * font size
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        // Reset drop to top randomly after it has crossed screen
        // Randomness ensures drops don't fall in unison
        if (drops[i] * fontSize > canvasRef!.height && Math.random() > 0.975) {
          drops[i] = 0;
        }

        drops[i]++;
      }
      animationId = requestAnimationFrame(draw);
    };

    draw();

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    });
  });

  return (
    <div ref={containerRef} class="relative h-full w-full overflow-hidden bg-[#050a14]">
      <canvas ref={canvasRef} class="absolute inset-0 z-0 opacity-30" />
      
      <div class="surface relative z-10 flex h-full items-center justify-center bg-transparent">
        <div class="text-center p-12 border border-white/15 bg-[#050a14]/80 rounded-2xl">
          <div class="mb-6 flex justify-center">
             <div class="relative h-20 w-20 flex items-center justify-center rounded-full border-2 border-white/20 bg-white/10 animate-pulse">
                <span class="text-4xl text-white">◈</span>
                <div class="absolute inset-0 rounded-full border border-white/15 animate-pulse opacity-20" />
             </div>
          </div>
          
          <h2 class="mb-2 text-4xl font-bold tracking-widest text-white font-mono uppercase">
            {pageName()}
          </h2>
          
          <div class="h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent my-4" />
          
          <p class="text-text-muted font-mono text-sm tracking-wider uppercase">
            System Module Offline
          </p>
          <p class="text-text-dim text-xs mt-2">
            Initialization Scheduled for Phase 3
          </p>
        </div>
      </div>
    </div>
  );
};

export default ComingSoon;
