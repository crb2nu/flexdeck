import { Component, For, Show, createSignal, onMount } from 'solid-js';

interface ChartWidgetProps {
  data: {
    title: string;
    type: 'line' | 'bar';
    labels: string[];
    datasets: {
      label: string;
      data: number[];
      color?: string;
    }[];
  };
}

const ChartWidget: Component<ChartWidgetProps> = (props) => {
  const [hovered, setHovered] = createSignal<{ x: number; i: number; vals: { label: string; val: number; color: string }[] } | null>(null);
  const [animProgress, setAnimProgress] = createSignal(0);

  const CHART_W = 480;
  const CHART_H = 160;
  const PAD = { top: 8, right: 12, bottom: 24, left: 40 };
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const allValues = () => props.data.datasets.flatMap(d => d.data);
  const maxVal = () => Math.max(...allValues(), 1);
  const minVal = () => Math.min(...allValues(), 0);
  const range = () => maxVal() - minVal() || 1;

  const xStep = () => plotW / Math.max(props.data.labels.length - 1, 1);

  const scaleY = (v: number) => PAD.top + plotH - ((v - minVal()) / range()) * plotH;
  const scaleX = (i: number) => PAD.left + i * xStep();

  // Y-axis ticks (5 levels)
  const yTicks = () => {
    const ticks = [];
    for (let i = 0; i <= 4; i++) {
      const val = minVal() + (range() * i) / 4;
      ticks.push({ val, y: scaleY(val) });
    }
    return ticks;
  };

  // Build SVG path for line charts
  const linePath = (data: number[]) => {
    const pts = data.map((v, i) => `${scaleX(i)},${scaleY(v) * animProgress()}`);
    return `M ${pts.join(' L ')}`;
  };

  // Build area fill path
  const areaPath = (data: number[]) => {
    const baseline = scaleY(minVal());
    const pts = data.map((v, i) => `${scaleX(i)},${scaleY(v)}`);
    return `M ${scaleX(0)},${baseline} L ${pts.join(' L ')} L ${scaleX(data.length - 1)},${baseline} Z`;
  };

  onMount(() => {
    // Animate chart entry
    let frame = 0;
    const totalFrames = 30;
    const animate = () => {
      frame++;
      setAnimProgress(Math.min(frame / totalFrames, 1));
      if (frame < totalFrames) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  });

  const handleMouseMove = (e: MouseEvent) => {
    const svg = (e.currentTarget as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const idx = Math.round((mouseX - PAD.left) / xStep());
    if (idx >= 0 && idx < props.data.labels.length) {
      setHovered({
        x: scaleX(idx),
        i: idx,
        vals: props.data.datasets.map(ds => ({
          label: ds.label,
          val: ds.data[idx],
          color: ds.color || '#00d9ff',
        })),
      });
    }
  };

  const barWidth = () => {
    const n = props.data.datasets.length;
    const groupWidth = xStep() * 0.7;
    return Math.max(groupWidth / n, 4);
  };

  return (
    <div class="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <h4 class="text-xs font-bold uppercase tracking-wider text-text-dim">
          {props.data.title}
        </h4>
        {/* Legend */}
        <div class="flex gap-3">
          <For each={props.data.datasets}>
            {(ds) => (
              <div class="flex items-center gap-1.5 text-[10px] text-text-dim">
                <span class="w-2 h-2 rounded-full" style={{ background: ds.color || '#00d9ff' }} />
                {ds.label}
              </div>
            )}
          </For>
        </div>
      </div>

      {/* SVG Chart */}
      <div class="px-2 pt-2 pb-1">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          class="w-full h-auto select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Defs for gradients */}
          <defs>
            <For each={props.data.datasets}>
              {(ds, idx) => (
                <linearGradient id={`area-grad-${idx()}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color={ds.color || '#00d9ff'} stop-opacity="0.3" />
                  <stop offset="100%" stop-color={ds.color || '#00d9ff'} stop-opacity="0.02" />
                </linearGradient>
              )}
            </For>
          </defs>

          {/* Grid lines + Y-axis labels */}
          <For each={yTicks()}>
            {(tick) => (
              <>
                <line
                  x1={PAD.left} y1={tick.y}
                  x2={CHART_W - PAD.right} y2={tick.y}
                  stroke="white" stroke-opacity="0.06"
                  stroke-dasharray="3,3"
                />
                <text
                  x={PAD.left - 6} y={tick.y + 3}
                  text-anchor="end"
                  fill="white" fill-opacity="0.3"
                  font-size="9" font-family="monospace"
                >
                  {tick.val >= 1000 ? `${(tick.val / 1000).toFixed(0)}k` : tick.val.toFixed(0)}
                </text>
              </>
            )}
          </For>

          {/* X-axis labels */}
          <For each={props.data.labels}>
            {(label, i) => (
              <text
                x={scaleX(i())} y={CHART_H - 4}
                text-anchor="middle"
                fill="white" fill-opacity="0.3"
                font-size="9" font-family="monospace"
              >
                {label}
              </text>
            )}
          </For>

          {/* Datasets */}
          <Show when={props.data.type === 'line'}>
            <For each={props.data.datasets}>
              {(ds, idx) => (
                <>
                  {/* Area fill */}
                  <path
                    d={areaPath(ds.data)}
                    fill={`url(#area-grad-${idx()})`}
                    opacity={animProgress()}
                  />
                  {/* Line */}
                  <path
                    d={linePath(ds.data)}
                    fill="none"
                    stroke={ds.color || '#00d9ff'}
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity={animProgress()}
                  />
                  {/* Data points */}
                  <For each={ds.data}>
                    {(val, i) => (
                      <circle
                        cx={scaleX(i())}
                        cy={scaleY(val)}
                        r={hovered()?.i === i() ? 4 : 2.5}
                        fill={ds.color || '#00d9ff'}
                        opacity={animProgress()}
                        class="transition-all duration-150"
                      />
                    )}
                  </For>
                </>
              )}
            </For>
          </Show>

          <Show when={props.data.type === 'bar'}>
            <For each={props.data.labels}>
              {(_label, i) => (
                <For each={props.data.datasets}>
                  {(ds, dsIdx) => {
                    const val = ds.data[i()];
                    const h = ((val - minVal()) / range()) * plotH * animProgress();
                    const bw = barWidth();
                    const x = scaleX(i()) - (props.data.datasets.length * bw) / 2 + dsIdx() * bw;
                    const y = PAD.top + plotH - h;
                    return (
                      <rect
                        x={x} y={y}
                        width={bw - 1} height={h}
                        rx="2"
                        fill={ds.color || '#00d9ff'}
                        opacity={hovered()?.i === i() ? 0.9 : 0.65}
                        class="transition-opacity duration-150"
                      />
                    );
                  }}
                </For>
              )}
            </For>
          </Show>

          {/* Hover crosshair */}
          <Show when={hovered()}>
            <line
              x1={hovered()!.x} y1={PAD.top}
              x2={hovered()!.x} y2={PAD.top + plotH}
              stroke="white" stroke-opacity="0.2"
              stroke-dasharray="4,2"
            />
          </Show>
        </svg>
      </div>

      {/* Hover tooltip */}
      <Show when={hovered()}>
        <div class="px-4 pb-2 flex items-center gap-4 text-[10px] text-text-dim font-mono">
          <span class="text-text-main">{props.data.labels[hovered()!.i]}</span>
          <For each={hovered()!.vals}>
            {(v) => (
              <span>
                <span class="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: v.color }} />
                {v.label}: <span class="text-text-main">{v.val}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default ChartWidget;
