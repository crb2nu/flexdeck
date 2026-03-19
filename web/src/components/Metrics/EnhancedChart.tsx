import { Component, For, Show, createMemo } from 'solid-js';
import type { MetricValue } from './usePrometheusMetricsController';

const CHART_STROKE_COLORS: Record<string, string> = {
  cyan: '#00d9ff',
  purple: '#a855f7',
  green: '#22c55e',
  orange: '#f97316',
  blue: '#60a5fa',
  pink: '#ec4899',
};

// Enhanced sparkline chart with grid and hover
const EnhancedChart: Component<{
  values: MetricValue[];
  color: string;
  unit: string;
  onHover: (index: number | null) => void;
}> = (props) => {
  const width = 300;
  const height = 100;
  const padding = { top: 8, right: 8, bottom: 4, left: 35 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const chartModel = createMemo(() => {
    const values = props.values;
    if (values.length < 2) return null;

    let min = values[0].value;
    let max = values[0].value;
    for (let i = 1; i < values.length; i++) {
      const currentValue = values[i].value;
      if (currentValue < min) min = currentValue;
      if (currentValue > max) max = currentValue;
    }

    const range = max - min || 1;
    const paddedMin = min - range * 0.1;
    const paddedMax = max + range * 0.1;

    const domain = paddedMax - paddedMin || 1;
    const xStep = chartWidth / (values.length - 1);
    const points = new Array<{ x: number; y: number }>(values.length);
    let linePath = '';

    for (let i = 0; i < values.length; i++) {
      const x = padding.left + xStep * i;
      const y =
        padding.top + chartHeight - (chartHeight * (values[i].value - paddedMin)) / domain;
      points[i] = { x, y };
      linePath += `${i === 0 ? 'M' : ' L'} ${x},${y}`;
    }

    const areaPath = `${linePath} L ${padding.left + chartWidth},${padding.top + chartHeight} L ${padding.left},${padding.top + chartHeight} Z`;
    const ticks = [];
    const tickStep = (paddedMax - paddedMin) / 4;
    for (let i = 0; i <= 4; i++) {
      const value = paddedMin + tickStep * i;
      const y =
        padding.top + chartHeight - (chartHeight * (value - paddedMin)) / domain;
      ticks.push({ value, y });
    }

    return {
      min: paddedMin,
      max: paddedMax,
      range: paddedMax - paddedMin,
      points,
      linePath,
      areaPath,
      ticks,
      lastPoint: points[points.length - 1],
    };
  });

  const strokeColor = () => CHART_STROKE_COLORS[props.color] || '#888';

  const handleMouseMove = (e: MouseEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const svgX = (x / rect.width) * width;
    const relativeX = svgX - padding.left;
    const index = Math.round((relativeX / chartWidth) * (props.values.length - 1));
    if (index >= 0 && index < props.values.length) {
      props.onHover(index);
    }
  };

  return (
    <svg
      class="h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => props.onHover(null)}
    >
      <defs>
        <linearGradient id={`chart-gradient-${props.color}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color={strokeColor()} stop-opacity="0.4" />
          <stop offset="100%" stop-color={strokeColor()} stop-opacity="0" />
        </linearGradient>
        <filter id={`chart-glow-${props.color}`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      <For each={chartModel()?.ticks || []}>
        {(tick) => (
          <>
            <line
              x1={padding.left}
              y1={tick.y}
              x2={padding.left + chartWidth}
              y2={tick.y}
              stroke="rgba(255,255,255,0.05)"
              stroke-width="1"
            />
            <text
              x={padding.left - 4}
              y={tick.y}
              text-anchor="end"
              dominant-baseline="middle"
              font-size="8"
              fill="rgba(255,255,255,0.3)"
            >
              {props.unit === 'MB/s' && Math.abs(tick.value) < 0.1 && Math.abs(tick.value) > 0
                ? `${(tick.value * 1024).toFixed(0)}`
                : (chartModel()?.range || 0) < 10
                  ? tick.value.toFixed(1)
                  : tick.value.toFixed(0)}
            </text>
          </>
        )}
      </For>

      {/* Area fill */}
      <path
        d={chartModel()?.areaPath || ''}
        fill={`url(#chart-gradient-${props.color})`}
        class="transition-all duration-300"
      />

      {/* Line */}
      <path
        d={chartModel()?.linePath || ''}
        fill="none"
        stroke={strokeColor()}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter={`url(#chart-glow-${props.color})`}
        class="transition-all duration-300"
      />

      {/* Endpoint dot with pulse */}
      <Show when={chartModel()?.lastPoint} keyed>
        {(lastPoint) => {
          return (
            <>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={6}
                fill={strokeColor()}
                opacity={0.3}
              >
                <animate
                  attributeName="r"
                  values="4;8;4"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.3;0.1;0.3"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={3}
                fill={strokeColor()}
                stroke="rgba(0,0,0,0.3)"
                stroke-width={1}
              />
            </>
          );
        }}
      </Show>
    </svg>
  );
};

export default EnhancedChart;
