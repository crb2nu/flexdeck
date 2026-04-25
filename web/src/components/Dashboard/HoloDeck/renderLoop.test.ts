import { describe, expect, it } from 'vitest';
import { createHoloDeckRenderLoop } from './renderLoop';

describe('HoloDeck render loop', () => {
  it('renders immediately and schedules the next frame while running', () => {
    const queued: FrameRequestCallback[] = [];
    const frames: Array<{ delta: number; time: number }> = [];
    const loop = createHoloDeckRenderLoop({
      isPaused: () => false,
      getDelta: () => 0.016,
      getElapsedTime: () => 1.5,
      renderFrame: (frame) => frames.push(frame),
      requestFrame: (callback) => {
        queued.push(callback);
        return queued.length;
      },
      cancelFrame: () => undefined,
    });

    loop.start();

    expect(loop.isRunning()).toBe(true);
    expect(frames).toEqual([{ delta: 0.016, time: 1.5 }]);
    expect(queued).toHaveLength(1);

    queued.shift()?.(2);

    expect(frames).toHaveLength(2);
    expect(queued).toHaveLength(1);
  });

  it('stops without rendering when paused', () => {
    const frames: unknown[] = [];
    const loop = createHoloDeckRenderLoop({
      isPaused: () => true,
      getDelta: () => 0.016,
      getElapsedTime: () => 1,
      renderFrame: (frame) => frames.push(frame),
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    });

    loop.start();

    expect(loop.isRunning()).toBe(false);
    expect(frames).toEqual([]);
  });

  it('cancels a scheduled frame on stop', () => {
    const canceled: number[] = [];
    const loop = createHoloDeckRenderLoop({
      isPaused: () => false,
      getDelta: () => 0.016,
      getElapsedTime: () => 1,
      renderFrame: () => undefined,
      requestFrame: () => 42,
      cancelFrame: (id) => canceled.push(id),
    });

    loop.start();
    loop.stop();

    expect(loop.isRunning()).toBe(false);
    expect(canceled).toEqual([42]);
  });
});
