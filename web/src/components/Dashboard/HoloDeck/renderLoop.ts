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
}: HoloDeckRenderLoopOptions): HoloDeckRenderLoop => {
  let running = false;
  let frameId: number | null = null;

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
