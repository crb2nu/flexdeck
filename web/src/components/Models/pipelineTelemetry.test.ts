import { describe, expect, it } from 'vitest';

import {
  applyPipelineLogLine,
  createPipelineTelemetryState,
  getPipelineTimeline,
  hasPipelineTelemetry,
  humanizePhase,
} from './pipelineTelemetry';

describe('pipelineTelemetry', () => {
  it('tracks structured progress events', () => {
    const state = applyPipelineLogLine(
      createPipelineTelemetryState(),
      '{"event":"progress","phase":"quantizing","percent":42.5,"detail":"layer 12 subset 1/4 via gptq"}',
    );

    expect(state.latestEvent?.event).toBe('progress');
    expect(state.latestProgress?.percent).toBe(42.5);
    expect(state.latestProgress?.detail).toContain('layer 12');
    expect(hasPipelineTelemetry(state)).toBe(true);
  });

  it('captures quantization checkpoint resume state from plain logs', () => {
    const state = applyPipelineLogLine(
      createPipelineTelemetryState(),
      'Loaded quantization checkpoint state: stage=quantizing completed_layers=37',
    );

    expect(state.checkpoint.stage).toBe('quantizing');
    expect(state.checkpoint.completedLayers).toBe(37);

    const timeline = getPipelineTimeline(state, 'Quantizing');
    expect(timeline.find((step) => step.key === 'quantizing')?.state).toBe('active');
    expect(timeline.find((step) => step.key === 'calibration')?.state).toBe('done');
  });

  it('collects abliteration snapshot and resume notes', () => {
    let state = createPipelineTelemetryState();
    state = applyPipelineLogLine(
      state,
      '{"event":"snapshot","phase":"refusal_directions_resumed","rss_mb":1234,"gpu_mem_mb":4096}',
    );
    state = applyPipelineLogLine(state, 'Resumed harmful activations from checkpoint');

    expect(state.latestSnapshot?.phase).toBe('refusal_directions_resumed');
    expect(state.latestSnapshot?.rss_mb).toBe(1234);
    expect(state.checkpoint.notes).toContain('refusal directions resumed');
    expect(state.checkpoint.notes).toContain('harmful activations');
  });

  it('humanizes checkpoint phases', () => {
    expect(humanizePhase('loaded_model')).toBe('loaded model');
  });

  it('maps abliteration progress into a detailed step timeline', () => {
    let state = createPipelineTelemetryState();
    state = applyPipelineLogLine(
      state,
      '{"event":"progress","phase":"abliterating","percent":70,"detail":"computing refusal directions"}',
    );

    const timeline = getPipelineTimeline(state, 'Abliterating');
    expect(timeline.find((step) => step.key === 'refusal_directions')?.state).toBe('active');
    expect(timeline.find((step) => step.key === 'harmful_activations')?.state).toBe('done');
    expect(timeline.find((step) => step.key === 'harmless_activations')?.state).toBe('done');
  });
});
