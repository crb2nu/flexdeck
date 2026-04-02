import { describe, expect, it } from "vitest";

import {
  dataStateLabel,
  resolveDashboardDataState,
} from "./statusSemantics";

describe("resolveDashboardDataState", () => {
  it("marks loading states as partial", () => {
    expect(
      resolveDashboardDataState({
        loading: true,
        staleAfterMs: 30_000,
      }),
    ).toBe("partial");
  });

  it("marks connectivity failures as offline", () => {
    expect(
      resolveDashboardDataState({
        error: "offline",
        staleAfterMs: 30_000,
      }),
    ).toBe("offline");
    expect(
      resolveDashboardDataState({
        error: "request timeout from upstream",
        staleAfterMs: 30_000,
      }),
    ).toBe("offline");
  });

  it("marks non-connectivity errors as partial", () => {
    expect(
      resolveDashboardDataState({
        error: "partial data",
        staleAfterMs: 30_000,
      }),
    ).toBe("partial");
  });

  it("marks stale when no recent successful update exists", () => {
    expect(
      resolveDashboardDataState({
        staleAfterMs: 30_000,
        nowMs: 120_000,
        lastUpdateMs: 0,
      }),
    ).toBe("stale");

    expect(
      resolveDashboardDataState({
        staleAfterMs: 30_000,
        nowMs: 120_000,
        lastUpdateMs: 80_000,
      }),
    ).toBe("stale");
  });

  it("marks ready when data is fresh and error-free", () => {
    expect(
      resolveDashboardDataState({
        staleAfterMs: 30_000,
        nowMs: 120_000,
        lastUpdateMs: 110_000,
      }),
    ).toBe("ready");
  });

  it("preserves disabled and fallback states from the shared resolver", () => {
    expect(
      resolveDashboardDataState({
        staleAfterMs: 30_000,
        disabled: true,
      }),
    ).toBe("disabled");

    expect(
      resolveDashboardDataState({
        staleAfterMs: 30_000,
        nowMs: 120_000,
        lastUpdateMs: 110_000,
        fallback: true,
      }),
    ).toBe("fallback");
  });
});

describe("dataStateLabel", () => {
  it("formats uppercase labels with optional detail", () => {
    expect(dataStateLabel("ready")).toBe("READY");
    expect(dataStateLabel("disabled", "feature disabled")).toBe(
      "DISABLED · feature disabled",
    );
  });
});
