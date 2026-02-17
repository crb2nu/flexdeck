import { Component, createMemo } from 'solid-js';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  trend?: 'up' | 'down' | 'stable';
  class?: string;
}

const Sparkline: Component<SparklineProps> = (props) => {
  const width = () => props.width ?? 80;
  const height = () => props.height ?? 24;

  const trendColor = createMemo(() => {
    if (props.trend === 'up') return 'var(--color-success, #22c55e)';
    if (props.trend === 'down') return 'var(--color-error, #ef4444)';
    return props.color ?? 'var(--color-primary, #3b82f6)';
  });

  const points = createMemo(() => {
    const data = props.data || [];
    if (data.length < 2) return '';

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const w = width();
    const h = height();
    const padding = 2;

    const xStep = (w - padding * 2) / (data.length - 1);
    const yScale = (h - padding * 2) / range;

    return data
      .map((val, i) => {
        const x = padding + i * xStep;
        const y = h - padding - (val - min) * yScale;
        return `${x},${y}`;
      })
      .join(' ');
  });

  const areaPath = createMemo(() => {
    const data = props.data || [];
    if (data.length < 2) return '';

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const w = width();
    const h = height();
    const padding = 2;

    const xStep = (w - padding * 2) / (data.length - 1);
    const yScale = (h - padding * 2) / range;

    let path = `M ${padding} ${h - padding}`;
    data.forEach((val, i) => {
      const x = padding + i * xStep;
      const y = h - padding - (val - min) * yScale;
      path += ` L ${x} ${y}`;
    });
    path += ` L ${w - padding} ${h - padding} Z`;

    return path;
  });

  return (
    <svg
      width={width()}
      height={height()}
      class={`sparkline ${props.class || ''}`}
      viewBox={`0 0 ${width()} ${height()}`}
    >
      {props.data && props.data.length >= 2 && (
        <>
          {/* Area fill */}
          <path d={areaPath()} fill={trendColor()} opacity={0.15} />
          {/* Line */}
          <polyline
            points={points()}
            fill="none"
            stroke={trendColor()}
            stroke-width={1.5}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {/* Endpoint dot */}
          {(() => {
            const data = props.data || [];
            if (data.length < 2) return null;
            const max = Math.max(...data, 1);
            const min = Math.min(...data, 0);
            const range = max - min || 1;
            const w = width();
            const h = height();
            const padding = 2;
            const xStep = (w - padding * 2) / (data.length - 1);
            const yScale = (h - padding * 2) / range;
            const lastIdx = data.length - 1;
            const x = padding + lastIdx * xStep;
            const y = h - padding - (data[lastIdx] - min) * yScale;
            return <circle cx={x} cy={y} r={2} fill={trendColor()} />;
          })()}
        </>
      )}
    </svg>
  );
};

export default Sparkline;
