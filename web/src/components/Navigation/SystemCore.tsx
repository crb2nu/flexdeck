import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';

const SystemCore: Component = () => {
    const [pulseSpeed, setPulseSpeed] = createSignal('animate-ping-slow');
    const [coreColor, setCoreColor] = createSignal('text-neon-cyan');

    // MOCK: Simulate varying system states (would connect to real health in prod)
    onMount(() => {
        const interval = setInterval(() => {
            const rand = Math.random();
            if (rand > 0.9) {
                setPulseSpeed('animate-ping-fast');
                setCoreColor('text-neon-purple');
            } else if (rand > 0.7) {
                setPulseSpeed('animate-ping-normal');
                setCoreColor('text-neon-cyan');
            } else {
                 setPulseSpeed('animate-ping-slow');
                 setCoreColor('text-neon-cyan');
            }
        }, 5000);

        onCleanup(() => clearInterval(interval));
    });

    return (
        <div class="relative flex items-center justify-center p-2 group cursor-pointer" title="AI SYSTEM CORE: ONLINE">
            <div class={`absolute inset-0 flex items-center justify-center`}>
                 <div class={`h-8 w-8 rounded-full border border-current opacity-20 ${coreColor()} ${pulseSpeed()}`}></div>
            </div>
             <div class={`absolute inset-0 flex items-center justify-center`}>
                 <div class={`h-12 w-12 rounded-full border border-current opacity-10 ${coreColor()} animate-spin-slow`}></div>
            </div>
            
            {/* Core Graphic */}
            <div class={`relative z-10 font-bold tracking-widest ${coreColor()} transition-colors duration-500`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.8">
                         <animate attributeName="opacity" values="0.8;0.4;0.8" dur="3s" repeatCount="indefinite" />
                    </circle>
                    <path d="M12 2V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M12 20V22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M22 12L20 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M4 12L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    
                    <path d="M19.0718 19.0718L17.6576 17.6576" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M6.34315 6.34315L4.92893 4.92893" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                     <path d="M19.0718 4.92893L17.6576 6.34315" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M6.34315 17.6576L4.92893 19.0718" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </div>

            {/* Hover Tooltip/HUD */}
             <div class="absolute right-full top-1/2 -translate-y-1/2 mr-4 hidden w-48 group-hover:block animate-fade-in-scale">
                 <div class="bg-[#050a14]/90 border border-neon-cyan/30 rounded-lg p-3 backdrop-blur-md shadow-[0_0_20px_rgba(0,217,255,0.1)]">
                    <div class="text-[10px] text-neon-cyan/50 tracking-widest mb-1">SYSTEM STATUS</div>
                    <div class="text-xs text-neon-cyan font-mono mb-2">ALL SYSTEMS NOMINAL</div>
                    <div class="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                        <div class="h-full bg-neon-cyan w-[85%] animate-pulse"></div>
                    </div>
                 </div>
            </div>
        </div>
    );
};

export default SystemCore;
