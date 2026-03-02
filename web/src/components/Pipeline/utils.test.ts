import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepoInfo } from "../../lib/api";
import type { Pipeline } from "./CIPipelineViz";
import {
  formatRelativeTime,
  getJobCountsByStatus,
  getStatusColor,
  getStatusLabel,
  hasActiveJobs,
  normalizeJobStatus,
  normalizePipeline,
  normalizePipelineStatus,
  sortJobsByStatus,
  sortPipelines,
  type RepoWithPipeline,
} from "./utils";

const makeRepo = (id: number, name: string): RepoInfo => ({
  id,
  name,
  path: name.toLowerCase(),
  type: "gitlab",
  hasConfig: true,
});

const makePipeline = (
  status: Pipeline["status"],
  createdAt: string,
  runningJobs = 0,
): Pipeline => ({
  id: `p-${status}-${createdAt}`,
  ref: "main",
  status,
  createdAt,
  stages: [
    {
      name: "build",
      jobs: Array.from({ length: runningJobs }, (_, idx) => ({
        id: `job-${idx}`,
        name: `job-${idx}`,
        stage: "build",
        status: "running",
      })),
    },
  ],
});

describe("pipeline utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sorts jobs by status priority", () => {
    const jobs = [
      { status: "success" as const, id: "1" },
      { status: "failed" as const, id: "2" },
      { status: "running" as const, id: "3" },
      { status: "pending" as const, id: "4" },
    ];

    const sorted = sortJobsByStatus(jobs).map((job) => job.status);
    expect(sorted).toEqual(["running", "pending", "failed", "success"]);
  });

  it("sorts pipelines by status including canceled", () => {
    const items: RepoWithPipeline[] = [
      { repo: makeRepo(1, "a"), pipeline: makePipeline("pending", "2026-01-01T10:00:00Z") },
      { repo: makeRepo(2, "b"), pipeline: makePipeline("failed", "2026-01-01T10:00:00Z") },
      { repo: makeRepo(3, "c"), pipeline: makePipeline("running", "2026-01-01T10:00:00Z") },
      { repo: makeRepo(4, "d"), pipeline: makePipeline("canceled", "2026-01-01T10:00:00Z") },
      { repo: makeRepo(5, "e"), pipeline: makePipeline("success", "2026-01-01T10:00:00Z") },
    ];

    const sorted = sortPipelines(items, { field: "status", direction: "desc" }).map(
      (item) => item.pipeline?.status,
    );

    expect(sorted).toEqual(["running", "failed", "canceled", "pending", "success"]);
  });

  it("detects active jobs from running status", () => {
    expect(hasActiveJobs(makePipeline("running", "2026-01-01T10:00:00Z", 1))).toBe(true);
    expect(
      hasActiveJobs({
        ...makePipeline("pending", "2026-01-01T10:00:00Z", 0),
        stages: [{ name: "build", jobs: [{ id: "j1", name: "j1", stage: "build", status: "pending" }] }],
      }),
    ).toBe(true);
    expect(hasActiveJobs(makePipeline("success", "2026-01-01T10:00:00Z", 0))).toBe(false);
    expect(hasActiveJobs(null)).toBe(false);
  });

  it("normalizes GitLab job statuses to UI statuses", () => {
    expect(normalizeJobStatus("created")).toBe("pending");
    expect(normalizeJobStatus("waiting_for_resource")).toBe("pending");
    expect(normalizeJobStatus("preparing")).toBe("pending");
    expect(normalizeJobStatus("canceling")).toBe("failed");
    expect(normalizeJobStatus("success")).toBe("success");
  });

  it("normalizes pipeline statuses to UI statuses", () => {
    expect(normalizePipelineStatus("running")).toBe("running");
    expect(normalizePipelineStatus("created")).toBe("pending");
    expect(normalizePipelineStatus("manual")).toBe("pending");
    expect(normalizePipelineStatus("skipped")).toBe("canceled");
  });

  it("normalizes pipeline job statuses in-place shape", () => {
    const pipeline = {
      id: "p1",
      ref: "main",
      status: "created",
      createdAt: "2026-01-01T10:00:00Z",
      stages: [
        {
          name: "lint",
          jobs: [
            { id: "1", name: "lint", stage: "lint", status: "created" },
            { id: "2", name: "typecheck", stage: "lint", status: "canceling" },
          ],
        },
      ],
    } as Pipeline;

    const normalized = normalizePipeline(pipeline);
    expect(normalized.status).toBe("pending");
    expect(normalized.rawStatus).toBe("created");
    expect(normalized.stages[0].jobs[0].rawStatus).toBe("created");
    expect(normalized.stages[0].jobs.map((job) => job.status)).toEqual(["pending", "failed"]);
  });

  it("prefers raw status for live display label/color", () => {
    expect(getStatusLabel("pending", "waiting_for_resource")).toBe("waiting for resource");
    expect(getStatusColor("pending", "waiting_for_resource")).toBe("#ff9f43");
    expect(getStatusLabel("failed", "canceling")).toBe("canceling");
  });

  it("counts jobs by status", () => {
    const counts = getJobCountsByStatus([
      { id: "a", name: "a", stage: "test", status: "running" },
      { id: "b", name: "b", stage: "test", status: "running" },
      { id: "c", name: "c", stage: "test", status: "failed" },
      { id: "d", name: "d", stage: "test", status: "manual" },
    ]);

    expect(counts.running).toBe(2);
    expect(counts.failed).toBe(1);
    expect(counts.manual).toBe(1);
    expect(counts.success).toBe(0);
  });

  it("formats relative time against current clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-17T12:00:00Z"));

    expect(formatRelativeTime("2026-02-17T11:59:40Z")).toBe("just now");
    expect(formatRelativeTime("2026-02-17T11:00:00Z")).toBe("1h ago");
    expect(formatRelativeTime("2026-02-15T12:00:00Z")).toBe("2d ago");
  });
});
