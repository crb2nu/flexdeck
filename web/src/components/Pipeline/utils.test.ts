import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepoInfo } from "../../lib/api";
import type { Pipeline } from "./CIPipelineViz";
import {
  formatRelativeTime,
  getJobCountsByStatus,
  hasActiveJobs,
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
    expect(hasActiveJobs(makePipeline("success", "2026-01-01T10:00:00Z", 0))).toBe(false);
    expect(hasActiveJobs(null)).toBe(false);
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
