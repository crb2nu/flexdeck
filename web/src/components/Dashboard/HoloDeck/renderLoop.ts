export interface HoloDeckFrameState {
  delta: number;
  time: number;
}

export interface HoloDeckRenderLoopOptions {
  isPaused: () => boolean;
  getDelta: () => number;
  getElapsedTime: () => number;
  renderFrame: (state: HoloDeckFrameState) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  /**
   * Minimum wall-clock ms between rendered frames. High-refresh displays
   * (120/144Hz) otherwise render the decorative scene at full device rate
   * for no visual benefit.
   */
  minFrameMs?: number;
  getNow?: () => number;
}

export interface HoloDeckRenderLoop {
  start: () => void;
  stop: () => void;
  resumeIfStopped: () => void;
  isRunning: () => boolean;
}

export const createHoloDeckRenderLoop = ({
  isPaused,
  getDelta,
  getElapsedTime,
  renderFrame,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  minFrameMs = 0,
  getNow = () => performance.now(),
}: HoloDeckRenderLoopOptions): HoloDeckRenderLoop => {
  let running = false;
  let frameId: number | null = null;
  let lastRenderAt = -Infinity;

  const clearScheduledFrame = () => {
    if (frameId === null) return;
    cancelFrame(frameId);
    frameId = null;
  };

  const tick = () => {
    frameId = null;
    if (isPaused()) {
      running = false;
      return;
    }

    const now = getNow();
    if (minFrameMs > 0 && now - lastRenderAt < minFrameMs) {
      frameId = requestFrame(tick);
      return;
    }
    lastRenderAt = now;

    renderFrame({
      delta: getDelta(),
      time: getElapsedTime(),
    });

    if (running) {
      frameId = requestFrame(tick);
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    tick();
  };

  const stop = () => {
    running = false;
    clearScheduledFrame();
  };

  return {
    start,
    stop,
    resumeIfStopped: start,
    isRunning: () => running,
  };
};
