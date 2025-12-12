import { Component } from 'solid-js';
import { useLocation } from '@solidjs/router';

const ComingSoon: Component = () => {
  const location = useLocation();
  const pageName = () => {
    const path = location.pathname.slice(1);
    if (!path) return 'Page';
    return path.charAt(0).toUpperCase() + path.slice(1);
  };

  return (
    <div class="glass-panel flex h-full items-center justify-center">
      <div class="text-center">
        <div class="mb-4 text-6xl text-neon-purple/30">◈</div>
        <h2 class="mb-2 text-2xl font-bold text-text-main">{pageName()}</h2>
        <p class="text-text-muted">Coming soon in Phase 3</p>
      </div>
    </div>
  );
};

export default ComingSoon;
