/* @vitest-environment jsdom */

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trafficMocks = vi.hoisted(() => ({
  report: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  trafficApi: {
    report: trafficMocks.report,
  },
}));

import TrafficReport from "./TrafficReport";

function mount(factory: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function sampleReport(window = "24h") {
  return {
    generated_at: "2026-05-13T20:00:00Z",
    window,
    status: "ok",
    hosts: [
      {
        host: "flexinfer.ai",
        requests: 1234,
        requests_per_second: 0.42,
        four_xx: 7,
        four_xx_prev: 4,
        four_xx_change: 3,
        five_xx: 0,
        five_xx_prev: 0,
        five_xx_change: 0,
        error_rate: 0,
        p95_latency_ms: 180,
      },
    ],
    top_paths: [{ host: "flexinfer.ai", path: "/", requests: 900 }],
    top_pages: [{ page: "/docs", views: 88 }],
    tracking_signals: [
      {
        name: "page view metric",
        ok: true,
        value: 2,
        detail: "flexinfer_page_views_total series discovered",
      },
    ],
    recommendations: [
      "Traffic telemetry is flowing. Watch hosts with rising 4xx volume for broken links or probing.",
    ],
    warnings: [],
  };
}

describe("TrafficReport", () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    trafficMocks.report.mockReset();
    trafficMocks.report.mockImplementation(async (window: string) =>
      sampleReport(window),
    );
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = "";
  });

  it("renders website traffic, page views, tracking health, and recommendations", async () => {
    cleanup = mount(() => <TrafficReport />);

    await vi.waitFor(() => {
      expect(pageText()).toContain("flexinfer.ai");
    });

    const text = pageText();
    expect(text).toContain("Requests");
    expect(text).toContain("1,234");
    expect(text).toContain("0.42/s");
    expect(text).toContain("Worst p95");
    expect(text).toContain("/docs");
    expect(text).toContain("page view metric");
    expect(text).toContain("Traffic telemetry is flowing");
  });

  it("refetches using the selected traffic window", async () => {
    cleanup = mount(() => <TrafficReport />);

    await vi.waitFor(() => {
      expect(trafficMocks.report).toHaveBeenCalledWith("24h");
    });

    const sevenDayButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "7d",
    ) as HTMLButtonElement | undefined;
    expect(sevenDayButton).toBeTruthy();

    sevenDayButton!.click();

    await vi.waitFor(() => {
      expect(trafficMocks.report).toHaveBeenCalledWith("7d");
    });
    expect(pageText()).toContain("7d");
  });
});
