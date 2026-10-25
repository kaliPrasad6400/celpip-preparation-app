import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("surfaces structured AI errors (missing key)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: { code: "no_key", message: "No API key", retryable: false } }), { status: 400 }),
    );
    await expect(api.post("/api/attempts/1/evaluate")).rejects.toMatchObject({ code: "no_key", status: 400, message: "No API key" });
  });
  it("reports an offline server clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await api.get("/api/health").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("offline");
  });
  it("formats validation errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: [{ loc: ["body", "daily_minutes"], msg: "too small" }] }), { status: 422 }),
    );
    await expect(api.put("/api/settings", {})).rejects.toThrow("daily_minutes: too small");
  });
});
