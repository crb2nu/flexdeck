import { Component, createSignal, onMount, onCleanup, For, Show, createEffect } from 'solid-js';

// Types for pipeline data (based on .gitlab-ci.yml structure)
export interface PipelineJob {
  id: string;
  name: string;
  stage: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'manual';
  duration?: number;
  startedAt?: string;
  finishedAt?: string;
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

// ... (keep Particle and createDemoPipeline)

// ...

const CIPipelineViz: Component<{ pipeline?: Pipeline }> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let animationId: number;
  
  const [pipeline, setPipeline] = createSignal<Pipeline>(props.pipeline || createDemoPipeline());

  createEffect(() => {
    if (props.pipeline) {
      setPipeline(props.pipeline);
    }
  });

  const [hoveredJob, setHoveredJob] = createSignal<string | null>(null);
  const [particles, setParticles] = createSignal<Particle[]>([]);
  const [time, setTime] = createSignal(0);
  
  // Node positions for particle animation
  const [nodePositions, setNodePositions] = createSignal<Map<string, { x: number; y: number }>>(new Map());

  // Calculate stage positions
  const stagePositions = () => {
    const stages = pipeline().stages;
    const positions: { name: string; x: number }[] = [];
    const spacing = 100 / (stages.length + 1);
    
    stages.forEach((stage, i) => {
      positions.push({ name: stage.name, x: spacing * (i + 1) });
    });
    
    return positions;
  };

  // Particle animation system
  const spawnParticle = () => {
    const positions = nodePositions();
    const stages = pipeline().stages;
    
    if (positions.size < 2 || stages.length < 2) return;
    
    // Find running jobs to spawn particles from
    const runningStageIndex = stages.findIndex(s => 
      s.jobs.some(j => j.status === 'running')
    );
    
    if (runningStageIndex > 0) {
      const prevStage = stages[runningStageIndex - 1];
      const currentStage = stages[runningStageIndex];
      
      // Get positions
      const successJobs = prevStage.jobs.filter(j => j.status === 'success');
      const runningJobs = currentStage.jobs.filter(j => j.status === 'running');
      
      if (successJobs.length > 0 && runningJobs.length > 0) {
        const sourceJob = successJobs[Math.floor(Math.random() * successJobs.length)];
        const targetJob = runningJobs[Math.floor(Math.random() * runningJobs.length)];
        
        const sourcePos = positions.get(sourceJob.id);
        const targetPos = positions.get(targetJob.id);
        
        if (sourcePos && targetPos) {
          const newParticle: Particle = {
            id: Date.now() + Math.random(),
            x: sourcePos.x,
            y: sourcePos.y,
            targetX: targetPos.x,
            targetY: targetPos.y,
            progress: 0,
            speed: 0.008 + Math.random() * 0.012,
            color: getStatusColor('running'),
            size: 3 + Math.random() * 3,
            trail: []
          };
          
          setParticles(prev => [...prev.slice(-30), newParticle]); // Limit to 30 particles
        }
      }
    }
  };

  // Animation loop for particles
  const animate = () => {
    setTime(prev => prev + 1);
    
    // Spawn new particles occasionally
    if (Math.random() > 0.92) {
      spawnParticle();
    }
    
    // Update particles
    setParticles(prev => {
      return prev
        .map(p => {
          const newProgress = p.progress + p.speed;
          
          // Bezier curve interpolation for smooth arc
          const t = newProgress;
          const midX = (p.x + p.targetX) / 2;
          const midY = Math.min(p.y, p.targetY) - 50; // Arc up
          
          const newX = (1 - t) * (1 - t) * p.x + 2 * (1 - t) * t * midX + t * t * p.targetX;
          const newY = (1 - t) * (1 - t) * p.y + 2 * (1 - t) * t * midY + t * t * p.targetY;
          
          // Add to trail
          const newTrail = [...p.trail, { x: newX, y: newY }].slice(-10);
          
          return {
            ...p,
            x: newX,
            y: newY,
            progress: newProgress,
            trail: newTrail
          };
        })
        .filter(p => p.progress < 1);
    });
    
    animationId = requestAnimationFrame(animate);
  };

  // Register node position when rendered
  const registerNode = (id: string, el: HTMLDivElement | undefined) => {
    if (!el || !containerRef) return;
    
    const containerRect = containerRef.getBoundingClientRect();
    const nodeRect = el.getBoundingClientRect();
    
    const x = nodeRect.left - containerRect.left + nodeRect.width / 2;
    const y = nodeRect.top - containerRect.top + nodeRect.height / 2;
    
    setNodePositions(prev => {
      const updated = new Map(prev);
      updated.set(id, { x, y });
      return updated;
    });
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
    animate();
    
    // Delay node position registration to ensure layout is complete
    setTimeout(() => {
      document.querySelectorAll('[data-job-id]').forEach(el => {
        const id = el.getAttribute('data-job-id');
        if (id) registerNode(id, el as HTMLDivElement);
      });
    }, 100);
  });

  onCleanup(() => {
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
        {/* Stage headers */}
        <div class="w-full flex justify-around mb-8">
          <For each={pipeline().stages}>
            {(stage, index) => (
              <div class="flex flex-col items-center gap-2">
                <div class="text-[10px] font-mono uppercase tracking-[0.3em] text-text-muted">
                  Stage {index() + 1}
                </div>
                <div 
                  class="text-sm font-bold uppercase tracking-wider"
                  style={{
                    color: stage.jobs.some(j => j.status === 'running') 
                      ? getStatusColor('running')
                      : stage.jobs.every(j => j.status === 'success' || j.status === 'skipped')
                        ? getStatusColor('success')
                        : 'rgba(255,255,255,0.7)'
                  }}
                >
                  {stage.name}
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Connection lines (SVG) */}
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
          
          {/* Draw connection paths between stages */}
          <For each={pipeline().stages}>
            {(stage, stageIndex) => (
              <Show when={stageIndex() < pipeline().stages.length - 1}>
                <For each={stage.jobs}>
                  {(job) => {
                    const nextStage = pipeline().stages[stageIndex() + 1];
                    return (
                      <For each={nextStage.jobs}>
                        {(nextJob) => {
                          const x1 = ((stageIndex() + 1) / (pipeline().stages.length + 1)) * 100;
                          const x2 = ((stageIndex() + 2) / (pipeline().stages.length + 1)) * 100;
                          const showActive = job.status === 'success' && 
                            (nextJob.status === 'running' || nextJob.status === 'success');
                          
                          return (
                            <path
                              d={`M ${x1}% 50% Q ${(x1 + x2) / 2}% 30% ${x2}% 50%`}
                              fill="none"
                              stroke={showActive ? 'url(#lineGradient)' : 'rgba(255,255,255,0.1)'}
                              stroke-width={showActive ? '2' : '1'}
                              stroke-dasharray={showActive ? '0' : '5,5'}
                              filter={showActive ? 'url(#glow)' : ''}
                              class={showActive ? 'animate-flow' : ''}
                            />
                          );
                        }}
                      </For>
                    );
                  }}
                </For>
              </Show>
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
                    >
                      {/* Job card */}
                      <div 
                        class="relative px-6 py-4 rounded-lg cursor-pointer transition-all duration-300 transform"
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
                      </div>
                      
                      {/* Hover tooltip */}
                      <Show when={hoveredJob() === job.id}>
                        <div 
                          class="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/90 border border-white/10 text-xs font-mono whitespace-nowrap z-50"
                          style={{ 'box-shadow': '0 4px 20px rgba(0,0,0,0.5)' }}
                        >
                          Click to view logs
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>

        {/* Floating particles layer */}
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
          <For each={particles()}>
            {(particle) => (
              <>
                {/* Trail */}
                <For each={particle.trail}>
                  {(point, i) => (
                    <div
                      class="absolute rounded-full"
                      style={{
                        left: `${point.x}px`,
                        top: `${point.y}px`,
                        width: `${particle.size * (i() / particle.trail.length)}px`,
                        height: `${particle.size * (i() / particle.trail.length)}px`,
                        background: particle.color,
                        opacity: (i() / particle.trail.length) * 0.5,
                        transform: 'translate(-50%, -50%)'
                      }}
                    />
                  )}
                </For>
                {/* Main particle */}
                <div
                  class="absolute rounded-full"
                  style={{
                    left: `${particle.x}px`,
                    top: `${particle.y}px`,
                    width: `${particle.size}px`,
                    height: `${particle.size}px`,
                    background: particle.color,
                    'box-shadow': `0 0 ${particle.size * 2}px ${particle.color}`,
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              </>
            )}
          </For>
        </div>
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
      `}</style>
    </div>
  );
};

export default CIPipelineViz;
