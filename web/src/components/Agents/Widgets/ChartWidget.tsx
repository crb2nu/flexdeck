import { Component, For } from 'solid-js';

// Mock chart - in real app would use D3 or Chart.js
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
  const maxVal = Math.max(...props.data.datasets.flatMap(d => d.data));
  const height = 150;

  return (
    <div class="rounded-lg border border-white/10 bg-black/20 p-4">
      <h4 class="mb-4 text-xs font-bold uppercase tracking-wider text-text-dim">
        {props.data.title}
      </h4>
      
      <div class="relative flex h-[150px] items-end gap-2 pb-6">
        {/* Y-Axis lines */}
        <div class="absolute inset-0 flex flex-col justify-between text-[9px] text-text-dim pointer-events-none">
            <div class="border-b border-white/5 w-full h-px"></div>
            <div class="border-b border-white/5 w-full h-px"></div>
            <div class="border-b border-white/5 w-full h-px"></div>
            <div class="border-b border-white/5 w-full h-px"></div>
            <div class="border-b border-white/5 w-full h-px"></div>
        </div>

        <For each={props.data.labels}>
          {(label, i) => (
            <div class="relative flex-1 group z-10 flex items-end h-full">
              {/* Bars */}
              <For each={props.data.datasets}>
                 {(dataset, dsIndex) => {
                     const val = dataset.data[i()];
                     const pct = (val / maxVal) * 100;
                     const color = dataset.color || '#00d9ff';
                     return (
                         <div 
                            class="w-full mx-0.5 rounded-t transition-all duration-500 hover:opacity-80"
                            style={{
                                height: `${pct}%`,
                                background: color,
                                opacity: 0.7
                            }}
                            title={`${dataset.label}: ${val}`}
                         ></div>
                     );
                 }}
              </For>
              <div class="absolute -bottom-5 w-full text-center text-[9px] text-text-dim truncate">
                {label}
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default ChartWidget;
