/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
}));

vi.mock("../../stores/auth", () => ({
  authenticatedFetch: authMocks.authenticatedFetch,
}));

const { api, ApiRequestError } = await import("./client");

describe("api client", () => {
  beforeEach(() => {
    authMocks.authenticatedFetch.mockReset();
  });

  it("summarizes HTML error pages instead of exposing the raw document", async () => {
    authMocks.authenticatedFetch.mockResolvedValue(
      new Response(
        `<!DOCTYPE html>
        <html><head><title>flexinfer.ai | 502: Bad gateway</title></head>
        <body><h1>Bad gateway</h1><script>window.__cf = "noise";</script></body></html>`,
        {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "text/html; charset=UTF-8" },
        },
      ),
    );

    try {
      await api("/traffic/report");
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        status: 502,
        message:
          "Request failed: 502 Bad Gateway (flexinfer.ai | 502: Bad gateway)",
      });
    }
  });

  it("rejects successful HTML responses before typed API callers consume them", async () => {
    authMocks.authenticatedFetch.mockResolvedValue(
      new Response(
        `<!DOCTYPE html><html><head><title>Login required</title></head><body>sign in</body></html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html; charset=UTF-8" },
        },
      ),
    );

    await expect(api("/traffic/report")).rejects.toMatchObject({
      status: 200,
      message:
        "Request returned HTML instead of data: 200 OK (Login required)",
    });
  });
});
