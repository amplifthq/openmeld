import { describe, expect, it, vi } from "vitest";
import {
  isTransientUpstreamError,
  withUpstreamRetry,
} from "../src/lib/upstream-retry";

describe("upstream retry helper", () => {
  it("retries once for transient local dev binding errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error(
          'Cannot access "createSpace": could not complete call; couldn\'t find a local dev session'
        )
      )
      .mockResolvedValueOnce("ok");

    const result = await withUpstreamRetry(operation, {
      retries: 1,
      delayMs: 0,
    });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("invalid profile input"));

    await expect(
      withUpstreamRetry(operation, {
        retries: 1,
        delayMs: 0,
      })
    ).rejects.toThrow("invalid profile input");

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("detects transient messages in nested error causes", () => {
    const err = new Error("outer", {
      cause: new Error("couldn't find a local dev session for service binding"),
    });
    expect(isTransientUpstreamError(err)).toBe(true);
  });
});
