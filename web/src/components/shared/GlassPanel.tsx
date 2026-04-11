import { Component, JSX } from 'solid-js';

interface GlassPanelProps {
  children: JSX.Element;
  class?: string;
  hover?: boolean;
}

const GlassPanel: Component<GlassPanelProps> = (props) => {
  const baseClass = props.hover ? 'surface-hover' : 'surface';

  return (
    <div class={`${baseClass} ${props.class || ''}`}>
      {props.children}
    </div>
  );
};

export default GlassPanel;
