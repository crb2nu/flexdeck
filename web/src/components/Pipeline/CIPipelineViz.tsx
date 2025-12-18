import { Component, createSignal, onMount, onCleanup, For, Show, createEffect, createMemo } from 'solid-js';

// Types for pipeline data (based on .gitlab-ci.yml structure)
export interface PipelineJob {
  id: string;
  name: string;
  stage: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'manual';
  duration?: number;
  startedAt?: string;
  finishedAt?: string;
  details?: Record<string, any>;
}

export interface PipelineStage {
  name: string;
  jobs: PipelineJob[];
}

export interface Pipeline {
  id: string;
  ref: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  stages: PipelineStage[];
  createdAt: string;
}

// Performance: Fixed-size particle pool
const MAX_PARTICLES = 40;
const MAX_TRAIL_LENGTH = 8;

interface Particle {
  active: boolean;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number;
  speed: number;
  color: string;
  size: number;
  // Fixed-size trail array
  trailX: Float32Array;
  trailY: Float32Array;
  trailLength: number;
}

const createEmptyParticle = (): Particle => ({
  active: false,
  startX: 0,
  startY: 0,
  targetX: 0,
  targetY: 0,
  progress: 0,
  speed: 0,
  color: '#0aff68',
  size: 4,
  trailX: new Float32Array(MAX_TRAIL_LENGTH),
  trailY: new Float32Array(MAX_TRAIL_LENGTH),
  trailLength: 0,
});

// Demo pipeline data matching your .gitlab-ci.yml
const createDemoPipeline = (): Pipeline => ({
  id: 'pipeline-12847',
  ref: 'main',
  status: 'running',
  createdAt: new Date().toISOString(),
  stages: [
    {
      name: 'test',
      jobs: [
        { id: 'job-1', name: 'test:backend', stage: 'test', status: 'skipped', duration: 0 },
        { id: 'job-2', name: 'test:frontend', stage: 'test', status: 'success', duration: 45 },
      ]
    },
    {
      name: 'build',
      jobs: [
        { id: 'job-3', name: 'build', stage: 'build', status: 'running', duration: 120 },
      ]
    },
    {
      name: 'deploy',
      jobs: [
        { id: 'job-4', name: 'deploy', stage: 'deploy', status: 'manual' },
      ]
    }
  ]
});

const getStatusColor = (status: PipelineJob['status']): string => {
  switch (status) {
    case 'success': return '#00f0ff'; // neon-cyan
    case 'running': return '#0aff68'; // neon-green
    case 'failed': return '#ff003c'; // neon-pink
    case 'pending': return '#fcee0a'; // neon-yellow
    case 'manual': return '#bd00ff'; // neon-purple
    case 'skipped': return 'rgba(255,255,255,0.3)';
    default: return '#ffffff';
  }
};

const getStatusGlow = (status: PipelineJob['status']): string => {
  const color = getStatusColor(status);
  return `0 0 20px ${color}40, 0 0 40px ${color}20`;
};

const CIPipelineViz: Component<{
  pipeline?: Pipeline;
  onJobClick?: (job: PipelineJob) => void;
}> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let particleCanvasRef: HTMLCanvasElement | undefined;
  let animationId: number;

  const [pipeline, setPipeline] = createSignal<Pipeline>(props.pipeline || createDemoPipeline());

  createEffect(() => {
    if (props.pipeline) {
      setPipeline(props.pipeline);
    }
  });

  const [hoveredJob, setHoveredJob] = createSignal<string | null>(null);
  const [time, setTime] = createSignal(0);

  // Track status transitions for animations
  const [statusTransitions, setStatusTransitions] = createSignal<Map<string, { from: string; to: string; startTime: number }>>(new Map());

  // Track previous statuses to detect transitions
  const prevStatusRef: Map<string, PipelineJob['status']> = new Map();

  // Performance: Fixed particle pool (no reactive updates during animation)
  const particlePool: Particle[] = Array.from({ length: MAX_PARTICLES }, createEmptyParticle);
  let activeParticleCount = 0;
  let lastSpawnTime = 0;
  const MIN_SPAWN_INTERVAL = 80; // ms

  // Node positions for particle animation (cached)
  const nodePositionsCache = new Map<string, { x: number; y: number }>();
  const [positionsReady, setPositionsReady] = createSignal(false);

  // Compute stage progress
  const getStageProgress = (stage: PipelineStage): { completed: number; total: number; percent: number } => {
    const total = stage.jobs.length;
    const completed = stage.jobs.filter(j =>
      j.status === 'success' || j.status === 'skipped'
    ).length;
    return { completed, total, percent: total > 0 ? (completed / total) * 100 : 0 };
  };

  // Detect status transitions and trigger animations
  const checkStatusTransitions = () => {
    const now = performance.now();
    const newTransitions = new Map(statusTransitions());

    for (const stage of pipeline().stages) {
      for (const job of stage.jobs) {
        const prevStatus = prevStatusRef.get(job.id);
        if (prevStatus && prevStatus !== job.status) {
          // Status changed - record transition
          newTransitions.set(job.id, {
            from: prevStatus,
            to: job.status,
            startTime: now
          });
        }
        prevStatusRef.set(job.id, job.status);
      }
    }

    // Clean up old transitions (older than 500ms)
    newTransitions.forEach((transition, id) => {
      if (now - transition.startTime > 500) {
        newTransitions.delete(id);
      }
    });

    if (newTransitions.size !== statusTransitions().size) {
      setStatusTransitions(newTransitions);
    }
  };

  // Get transition animation class for a job
  const getTransitionClass = (jobId: string): string => {
    const transition = statusTransitions().get(jobId);
    if (!transition) return '';

    if (transition.to === 'success') return 'animate-success-burst';
    if (transition.to === 'failed') return 'animate-error-shake';
    if (transition.to === 'running') return 'animate-start-glow';
    return '';
  };

  // Job action handlers
  const handleRetryJob = (job: PipelineJob, e: MouseEvent) => {
    e.stopPropagation();
    setPipeline(prev => ({
      ...prev,
      stages: prev.stages.map(s => ({
        ...s,
        jobs: s.jobs.map(j =>
          j.id === job.id
            ? { ...j, status: 'running' as const, duration: 0 }
            : j
        )
      }))
    }));
  };

  const handleCancelJob = (job: PipelineJob, e: MouseEvent) => {
    e.stopPropagation();
    setPipeline(prev => ({
      ...prev,
      stages: prev.stages.map(s => ({
        ...s,
        jobs: s.jobs.map(j =>
          j.id === job.id
            ? { ...j, status: 'failed' as const }
            : j
        )
      }))
    }));
  };

  // Memoized connection paths - only recompute when pipeline changes
  const connectionPaths = createMemo(() => {
    const p = pipeline();
    const paths: Array<{
      d: string;
      active: boolean;
      sourceJobId: string;
      targetJobId: string;
    }> = [];

    for (let stageIndex = 0; stageIndex < p.stages.length - 1; stageIndex++) {
      const stage = p.stages[stageIndex];
      const nextStage = p.stages[stageIndex + 1];
      const x1 = ((stageIndex + 1) / (p.stages.length + 1)) * 100;
      const x2 = ((stageIndex + 2) / (p.stages.length + 1)) * 100;

      for (const job of stage.jobs) {
        for (const nextJob of nextStage.jobs) {
          const active = job.status === 'success' &&
            (nextJob.status === 'running' || nextJob.status === 'success');

          paths.push({
            d: `M ${x1}% 50% Q ${(x1 + x2) / 2}% 30% ${x2}% 50%`,
            active,
            sourceJobId: job.id,
            targetJobId: nextJob.id,
          });
        }
      }
    }

    return paths;
  });

  // Performance: Find inactive slot in pool
  const findInactiveSlot = (): number => {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!particlePool[i].active) return i;
    }
    return -1;
  };

  // Particle spawn with pool allocation
  const spawnParticle = () => {
    const now = performance.now();
    if (now - lastSpawnTime < MIN_SPAWN_INTERVAL) return;

    const stages = pipeline().stages;
    if (nodePositionsCache.size < 2 || stages.length < 2) return;

    const slotIndex = findInactiveSlot();
    if (slotIndex === -1) return;

    // Find running jobs to spawn particles from
    const runningStageIndex = stages.findIndex(s =>
      s.jobs.some(j => j.status === 'running')
    );

    if (runningStageIndex > 0) {
      const prevStage = stages[runningStageIndex - 1];
      const currentStage = stages[runningStageIndex];

      const successJobs = prevStage.jobs.filter(j => j.status === 'success');
      const runningJobs = currentStage.jobs.filter(j => j.status === 'running');

      if (successJobs.length > 0 && runningJobs.length > 0) {
        const sourceJob = successJobs[Math.floor(Math.random() * successJobs.length)];
        const targetJob = runningJobs[Math.floor(Math.random() * runningJobs.length)];

        const sourcePos = nodePositionsCache.get(sourceJob.id);
        const targetPos = nodePositionsCache.get(targetJob.id);

        if (sourcePos && targetPos) {
          const p = particlePool[slotIndex];
          p.active = true;
          p.startX = sourcePos.x;
          p.startY = sourcePos.y;
          p.targetX = targetPos.x;
          p.targetY = targetPos.y;
          p.progress = 0;
          p.speed = 0.008 + Math.random() * 0.012;
          p.color = getStatusColor('running');
          p.size = 3 + Math.random() * 3;
          p.trailLength = 0;

          activeParticleCount++;
          lastSpawnTime = now;
        }
      }
    }
  };

  // Canvas-based particle rendering
  const renderParticles = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlePool[i];
      if (!p.active) continue;

      // Update progress
      p.progress += p.speed;

      if (p.progress >= 1) {
        p.active = false;
        activeParticleCount--;
        continue;
      }

      // Bezier curve interpolation
      const t = p.progress;
      const midX = (p.startX + p.targetX) / 2;
      const midY = Math.min(p.startY, p.targetY) - 50;

      const currentX = (1 - t) * (1 - t) * p.startX + 2 * (1 - t) * t * midX + t * t * p.targetX;
      const currentY = (1 - t) * (1 - t) * p.startY + 2 * (1 - t) * t * midY + t * t * p.targetY;

      // Update trail (shift and add new point)
      if (p.trailLength < MAX_TRAIL_LENGTH) {
        p.trailX[p.trailLength] = currentX;
        p.trailY[p.trailLength] = currentY;
        p.trailLength++;
      } else {
        // Shift trail
        for (let j = 0; j < MAX_TRAIL_LENGTH - 1; j++) {
          p.trailX[j] = p.trailX[j + 1];
          p.trailY[j] = p.trailY[j + 1];
        }
        p.trailX[MAX_TRAIL_LENGTH - 1] = currentX;
        p.trailY[MAX_TRAIL_LENGTH - 1] = currentY;
      }

      // Draw trail
      ctx.beginPath();
      for (let j = 0; j < p.trailLength; j++) {
        const alpha = (j / p.trailLength) * 0.5;
        const size = p.size * (j / p.trailLength);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.trailX[j], p.trailY[j], size / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw main particle with glow
      ctx.globalAlpha = 1;
      ctx.shadowBlur = p.size * 2;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(currentX, currentY, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
  };

  // Animation loop
  const animate = () => {
    setTime(prev => prev + 1);

    // Check for status transitions
    checkStatusTransitions();

    // Spawn new particles occasionally
    if (Math.random() > 0.92) {
      spawnParticle();
    }

    // Render particles to canvas
    if (particleCanvasRef) {
      const ctx = particleCanvasRef.getContext('2d');
      if (ctx) {
        renderParticles(ctx, particleCanvasRef.width, particleCanvasRef.height);
      }
    }

    animationId = requestAnimationFrame(animate);
  };

  // Register node position when rendered (direct cache update, no reactive)
  const registerNode = (id: string, el: HTMLDivElement | undefined) => {
    if (!el || !containerRef) return;

    const containerRect = containerRef.getBoundingClientRect();
    const nodeRect = el.getBoundingClientRect();

    const x = nodeRect.left - containerRect.left + nodeRect.width / 2;
    const y = nodeRect.top - containerRect.top + nodeRect.height / 2;

    nodePositionsCache.set(id, { x, y });
  };

  // Resize particle canvas to match container
  const resizeCanvas = () => {
    if (!particleCanvasRef || !containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    particleCanvasRef.width = rect.width * dpr;
    particleCanvasRef.height = rect.height * dpr;
    particleCanvasRef.style.width = `${rect.width}px`;
    particleCanvasRef.style.height = `${rect.height}px`;
    const ctx = particleCanvasRef.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  };

  // Update demo pipeline status over time
  createEffect(() => {
    const t = time();
    
    // Every 100 frames, advance the pipeline
    if (t > 0 && t % 200 === 0) {
      setPipeline(prev => {
        const updated = { ...prev, stages: [...prev.stages] };
        
        // Find first running job and potentially complete it
        for (const stage of updated.stages) {
          const runningJob = stage.jobs.find(j => j.status === 'running');
          if (runningJob && Math.random() > 0.3) {
            runningJob.status = 'success';
            runningJob.duration = (runningJob.duration || 0) + Math.floor(Math.random() * 60);
            
            // Start next stage's jobs
            const stageIndex = updated.stages.indexOf(stage);
            if (stageIndex < updated.stages.length - 1) {
              const nextStage = updated.stages[stageIndex + 1];
              const pendingJob = nextStage.jobs.find(j => j.status === 'pending' || j.status === 'manual');
              if (pendingJob && pendingJob.status !== 'manual') {
                pendingJob.status = 'running';
              }
            }
            break;
          }
        }
        
        // Check if all jobs complete
        const allComplete = updated.stages.every(s => 
          s.jobs.every(j => j.status === 'success' || j.status === 'skipped' || j.status === 'manual')
        );
        
        if (allComplete) {
          updated.status = 'success';
        }
        
        return updated;
      });
    }
  });

  onMount(() => {
    // Setup canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    animate();

    // Delay node position registration to ensure layout is complete
    setTimeout(() => {
      document.querySelectorAll('[data-job-id]').forEach(el => {
        const id = el.getAttribute('data-job-id');
        if (id) registerNode(id, el as HTMLDivElement);
      });
      setPositionsReady(true);
    }, 100);
  });

  onCleanup(() => {
    window.removeEventListener('resize', resizeCanvas);
    if (animationId) cancelAnimationFrame(animationId);
  });

  return (
    <div 
      ref={containerRef}
      class="relative w-full h-full min-h-[500px] overflow-hidden rounded-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(5, 10, 20, 0.95) 0%, rgba(10, 16, 32, 0.95) 100%)',
        'border': '1px solid rgba(0, 240, 255, 0.1)'
      }}
    >
      {/* Animated background grid */}
      <div 
        class="absolute inset-0 pointer-events-none opacity-30"
        style={{
          'background-image': `
            linear-gradient(rgba(0, 240, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 240, 255, 0.03) 1px, transparent 1px)
          `,
          'background-size': '40px 40px',
          'animation': 'grid-pulse 4s ease-in-out infinite'
        }}
      />

      {/* Header */}
      <div class="relative z-10 p-6 border-b border-white/5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-3">
              <div 
                class="w-3 h-3 rounded-full animate-pulse"
                style={{
                  background: getStatusColor(pipeline().status as any),
                  'box-shadow': getStatusGlow(pipeline().status as any)
                }}
              />
              <h2 class="text-lg font-bold text-white tracking-wide">
                PIPELINE <span class="text-neon-cyan font-mono">#{pipeline().id.split('-')[1]}</span>
              </h2>
            </div>
            <div class="px-3 py-1 rounded-full bg-white/5 border border-white/10">
              <span class="text-xs font-mono text-neon-purple">{pipeline().ref}</span>
            </div>
          </div>
          
          <div class="flex items-center gap-2 text-text-muted text-xs font-mono">
            <span class="uppercase tracking-wider opacity-50">Status</span>
            <span 
              class="uppercase font-bold"
              style={{ color: getStatusColor(pipeline().status as any) }}
            >
              {pipeline().status}
            </span>
          </div>
        </div>
      </div>

      {/* Pipeline visualization area */}
      <div class="relative z-10 p-8 flex flex-col items-center">
        {/* Stage headers with progress */}
        <div class="w-full flex justify-around mb-8">
          <For each={pipeline().stages}>
            {(stage, index) => {
              const progress = () => getStageProgress(stage);
              const isRunning = () => stage.jobs.some(j => j.status === 'running');
              const isComplete = () => stage.jobs.every(j => j.status === 'success' || j.status === 'skipped');

              return (
                <div class="flex flex-col items-center gap-2 min-w-[120px]">
                  <div class="text-[10px] font-mono uppercase tracking-[0.3em] text-text-muted">
                    Stage {index() + 1}
                  </div>
                  <div
                    class="text-sm font-bold uppercase tracking-wider"
                    style={{
                      color: isRunning()
                        ? getStatusColor('running')
                        : isComplete()
                          ? getStatusColor('success')
                          : 'rgba(255,255,255,0.7)'
                    }}
                  >
                    {stage.name}
                  </div>

                  {/* Progress indicator */}
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] font-mono text-text-dim">
                      {progress().completed}/{progress().total}
                    </span>
                    {/* Progress bar */}
                    <div class="w-16 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${progress().percent}%`,
                          background: isComplete()
                            ? getStatusColor('success')
                            : isRunning()
                              ? `linear-gradient(90deg, ${getStatusColor('success')}, ${getStatusColor('running')})`
                              : getStatusColor('pending')
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        {/* Connection lines (SVG) - memoized paths */}
        <svg
          class="absolute inset-0 w-full h-full pointer-events-none z-0"
          style={{ top: '100px' }}
        >
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="rgba(0, 240, 255, 0.5)" />
              <stop offset="50%" stop-color="rgba(189, 0, 255, 0.5)" />
              <stop offset="100%" stop-color="rgba(10, 255, 104, 0.5)" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Draw memoized connection paths */}
          <For each={connectionPaths()}>
            {(path) => (
              <path
                d={path.d}
                fill="none"
                stroke={path.active ? 'url(#lineGradient)' : 'rgba(255,255,255,0.1)'}
                stroke-width={path.active ? '2' : '1'}
                stroke-dasharray={path.active ? '0' : '5,5'}
                filter={path.active ? 'url(#glow)' : ''}
                class={path.active ? 'animate-flow' : ''}
              />
            )}
          </For>
        </svg>

        {/* Job nodes */}
        <div class="w-full flex justify-around items-start gap-8 relative z-10">
          <For each={pipeline().stages}>
            {(stage) => (
              <div class="flex flex-col gap-4 items-center min-w-[200px]">
                <For each={stage.jobs}>
                  {(job) => (
                    <div
                      data-job-id={job.id}
                      class="group relative"
                      onMouseEnter={() => setHoveredJob(job.id)}
                      onMouseLeave={() => setHoveredJob(null)}
                      onClick={(e) => {
                          e.stopPropagation();
                          props.onJobClick?.(job);
                      }}
                    >
                      {/* Job card */}
                      <div
                        class={`relative px-6 py-4 rounded-lg cursor-pointer transition-all duration-300 transform ${getTransitionClass(job.id)}`}
                        classList={{
                          'scale-105': hoveredJob() === job.id,
                        }}
                        style={{
                          background: hoveredJob() === job.id
                            ? 'rgba(20, 30, 50, 0.9)'
                            : 'rgba(10, 16, 32, 0.8)',
                          border: `1px solid ${getStatusColor(job.status)}30`,
                          'box-shadow': hoveredJob() === job.id
                            ? getStatusGlow(job.status)
                            : 'none',
                        }}
                      >
                        {/* Corner accents */}
                        <div 
                          class="absolute top-0 left-0 w-3 h-3 border-l-2 border-t-2"
                          style={{ 'border-color': getStatusColor(job.status) }}
                        />
                        <div 
                          class="absolute bottom-0 right-0 w-3 h-3 border-r-2 border-b-2"
                          style={{ 'border-color': getStatusColor(job.status) }}
                        />
                        
                        {/* Status indicator */}
                        <div class="flex items-center gap-3 mb-2">
                          <div 
                            class="w-2 h-2 rounded-full"
                            classList={{
                              'animate-pulse': job.status === 'running',
                            }}
                            style={{
                              background: getStatusColor(job.status),
                              'box-shadow': `0 0 8px ${getStatusColor(job.status)}`
                            }}
                          />
                          <span 
                            class="text-[10px] font-mono uppercase tracking-wider"
                            style={{ color: getStatusColor(job.status) }}
                          >
                            {job.status}
                          </span>
                        </div>
                        
                        {/* Job name */}
                        <div class="text-sm font-mono text-white font-medium">
                          {job.name}
                        </div>
                        
                        {/* Duration */}
                        <Show when={job.duration && job.duration > 0}>
                          <div class="mt-2 text-xs text-text-muted font-mono">
                            ⏱ {Math.floor(job.duration! / 60)}m {job.duration! % 60}s
                          </div>
                        </Show>
                        
                        {/* Running animation */}
                        <Show when={job.status === 'running'}>
                          <div class="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-lg">
                            <div 
                              class="h-full w-1/3 animate-shimmer"
                              style={{
                                background: `linear-gradient(90deg, transparent, ${getStatusColor('running')}, transparent)`
                              }}
                            />
                          </div>
                        </Show>
                        
                        {/* Manual trigger button */}
                        <Show when={job.status === 'manual'}>
                          <button
                            class="mt-3 w-full py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-all duration-200 hover:scale-105"
                            style={{
                              background: 'rgba(189, 0, 255, 0.2)',
                              border: '1px solid rgba(189, 0, 255, 0.5)',
                              color: '#bd00ff'
                            }}
                            onClick={() => {
                              setPipeline(prev => {
                                const updated = { ...prev, stages: prev.stages.map(s => ({
                                  ...s,
                                  jobs: s.jobs.map(j =>
                                    j.id === job.id
                                      ? { ...j, status: 'running' as const }
                                      : j
                                  )
                                }))};
                                return updated;
                              });
                            }}
                          >
                            ▶ Deploy
                          </button>
                        </Show>

                        {/* Retry button for failed jobs */}
                        <Show when={job.status === 'failed'}>
                          <button
                            class="mt-3 w-full py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-all duration-200 hover:scale-105"
                            style={{
                              background: 'rgba(255, 0, 60, 0.2)',
                              border: '1px solid rgba(255, 0, 60, 0.5)',
                              color: '#ff003c'
                            }}
                            onClick={(e) => handleRetryJob(job, e)}
                          >
                            ↻ Retry
                          </button>
                        </Show>

                        {/* Cancel button for running jobs */}
                        <Show when={job.status === 'running'}>
                          <button
                            class="mt-3 w-full py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-all duration-200 hover:scale-105 hover:bg-red-500/30"
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              color: 'rgba(255, 255, 255, 0.7)'
                            }}
                            onClick={(e) => handleCancelJob(job, e)}
                          >
                            ✕ Cancel
                          </button>
                        </Show>
                      </div>
                      
                      {/* Enhanced Hover tooltip */}
                      <Show when={hoveredJob() === job.id}>
                        <div
                          class="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full px-3 py-2 rounded-lg bg-black/95 border text-xs font-mono z-50 min-w-[160px]"
                          style={{
                            'box-shadow': `0 4px 20px rgba(0,0,0,0.5), 0 0 20px ${getStatusColor(job.status)}20`,
                            'border-color': `${getStatusColor(job.status)}40`
                          }}
                        >
                          {/* Arrow */}
                          <div
                            class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-black/95 border-b border-r"
                            style={{ 'border-color': `${getStatusColor(job.status)}40` }}
                          />

                          {/* Status & Duration */}
                          <div class="flex items-center justify-between gap-4 mb-1.5 pb-1.5 border-b border-white/10">
                            <span style={{ color: getStatusColor(job.status) }} class="uppercase font-bold">
                              {job.status}
                            </span>
                            <Show when={job.duration && job.duration > 0}>
                              <span class="text-text-dim">
                                {Math.floor(job.duration! / 60)}m {job.duration! % 60}s
                              </span>
                            </Show>
                          </div>

                          {/* Start time */}
                          <Show when={job.startedAt}>
                            <div class="text-[10px] text-text-dim mb-1">
                              Started: {new Date(job.startedAt!).toLocaleTimeString()}
                            </div>
                          </Show>

                          {/* Status-specific hints */}
                          <div class="text-text-muted mt-1.5">
                            <Show when={job.status === 'failed'}>
                              <span class="text-red-400">Click to view error</span>
                            </Show>
                            <Show when={job.status === 'manual'}>
                              <span class="text-neon-purple">Click to trigger</span>
                            </Show>
                            <Show when={job.status === 'running'}>
                              <span class="text-neon-green">Click to view output</span>
                            </Show>
                            <Show when={job.status === 'success'}>
                              <span class="text-neon-cyan">Click to view logs</span>
                            </Show>
                            <Show when={job.status === 'pending'}>
                              <span class="text-yellow-400">Waiting...</span>
                            </Show>
                            <Show when={job.status === 'skipped'}>
                              <span class="text-text-dim">Skipped</span>
                            </Show>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>

        {/* Canvas-based particle layer (performance optimized) */}
        <canvas
          ref={particleCanvasRef}
          class="absolute inset-0 pointer-events-none z-20"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Footer stats */}
      <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-white/5 bg-black/30 backdrop-blur-sm">
        <div class="flex justify-around text-center">
          <div>
            <div class="text-2xl font-bold text-neon-cyan font-mono">
              {pipeline().stages.reduce((acc, s) => acc + s.jobs.filter(j => j.status === 'success').length, 0)}
            </div>
            <div class="text-[10px] uppercase tracking-wider text-text-muted">Passed</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-neon-green font-mono">
              {pipeline().stages.reduce((acc, s) => acc + s.jobs.filter(j => j.status === 'running').length, 0)}
            </div>
            <div class="text-[10px] uppercase tracking-wider text-text-muted">Running</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-neon-purple font-mono">
              {pipeline().stages.reduce((acc, s) => acc + s.jobs.filter(j => j.status === 'manual').length, 0)}
            </div>
            <div class="text-[10px] uppercase tracking-wider text-text-muted">Manual</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-neon-pink font-mono">
              {pipeline().stages.reduce((acc, s) => acc + s.jobs.filter(j => j.status === 'failed').length, 0)}
            </div>
            <div class="text-[10px] uppercase tracking-wider text-text-muted">Failed</div>
          </div>
        </div>
      </div>

      {/* Decorative elements */}
      <div class="absolute top-4 right-4 flex items-center gap-2 text-[10px] font-mono text-text-muted uppercase tracking-widest">
        <div class="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
        <span>Live</span>
      </div>

      {/* Title overlay */}
      <div class="absolute top-20 left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <div class="text-[10px] font-mono uppercase tracking-[0.4em] text-neon-cyan/50 mb-1">
          Continuous Integration
        </div>
        <div 
          class="text-2xl font-bold tracking-widest text-white"
          style={{ 'text-shadow': '0 0 30px rgba(0, 240, 255, 0.3)' }}
        >
          PIPELINE ORCHESTRATOR
        </div>
        <div class="h-px w-48 mx-auto mt-3 bg-gradient-to-r from-transparent via-neon-cyan/50 to-transparent" />
      </div>

      <style>{`
        @keyframes grid-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.15; }
        }

        @keyframes flow {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }

        .animate-flow {
          animation: flow 1s linear infinite;
        }

        /* Status transition animations */
        @keyframes success-burst {
          0% { transform: scale(1); box-shadow: 0 0 0 rgba(0, 240, 255, 0); }
          30% { transform: scale(1.08); box-shadow: 0 0 30px rgba(0, 240, 255, 0.6); }
          100% { transform: scale(1); box-shadow: 0 0 20px rgba(0, 240, 255, 0.2); }
        }

        @keyframes error-shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }

        @keyframes start-glow {
          0% { box-shadow: 0 0 0 rgba(10, 255, 104, 0); }
          50% { box-shadow: 0 0 40px rgba(10, 255, 104, 0.6), 0 0 60px rgba(10, 255, 104, 0.3); }
          100% { box-shadow: 0 0 20px rgba(10, 255, 104, 0.3); }
        }

        .animate-success-burst {
          animation: success-burst 0.5s ease-out forwards;
        }

        .animate-error-shake {
          animation: error-shake 0.4s ease-in-out;
        }

        .animate-start-glow {
          animation: start-glow 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default CIPipelineViz;
