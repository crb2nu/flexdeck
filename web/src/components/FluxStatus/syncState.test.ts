import { describe, expect, it } from "vitest";

import { computeFluxSyncState } from "./syncState";

describe("computeFluxSyncState", () => {
  it("returns suspended for suspended resources", () => {
    expect(
      computeFluxSyncState({
        ready: true,
        suspended: true,
      }),
    ).toBe("suspended");
  });

  it("returns in-sync for ready resources with no drift conditions", () => {
    expect(
      computeFluxSyncState({
        ready: true,
        suspended: false,
        conditions: [{ type: "Ready", status: "True" }],
      }),
    ).toBe("in-sync");
  });

  it("returns drifting when reconciling", () => {
    expect(
      computeFluxSyncState({
        ready: false,
        suspended: false,
        conditions: [{ type: "Reconciling", status: "True" }],
      }),
    ).toBe("drifting");
  });

  it("returns error when stalled", () => {
    expect(
      computeFluxSyncState({
        ready: false,
        conditions: [{ type: "Stalled", status: "True" }],
      }),
    ).toBe("error");
  });

  it("returns error when ready condition indicates failure", () => {
    expect(
      computeFluxSyncState({
        ready: false,
        conditions: [
          {
            type: "Ready",
            status: "False",
            reason: "InstallFailed",
            message: "chart render error",
          },
        ],
      }),
    ).toBe("error");
  });
});
