import { Component, JSX } from 'solid-js';

interface GlassPanelProps {
  children: JSX.Element;
  class?: string;
  hover?: boolean;
  accent?: 'blue' | 'violet' | 'emerald' | 'red' | 'amber';
}

const accentColors: Record<string, string> = {
  blue: 'hover:border-l-[rgba(0,240,255,0.4)]',
  violet: 'hover:border-l-[rgba(189,0,255,0.4)]',
  emerald: 'hover:border-l-[rgba(10,255,104,0.4)]',
  red: 'hover:border-l-[rgba(255,0,60,0.4)]',
  amber: 'hover:border-l-[rgba(252,238,10,0.3)]',
};

const GlassPanel: Component<GlassPanelProps> = (props) => {
  const baseClass = props.hover ? 'surface-hover' : 'surface';
  const accentClass = () => props.accent ? `border-l-2 border-l-transparent transition-all duration-150 ${accentColors[props.accent] || ''}` : '';

  return (
    <div class={`${baseClass} ${accentClass()} ${props.class || ''}`}>
      {props.children}
    </div>
  );
};

export default GlassPanel;
