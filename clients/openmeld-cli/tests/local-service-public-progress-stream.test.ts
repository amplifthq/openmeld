import { describe, expect, it, vi } from "vitest";
import { createDispatchPublicProgressReporter } from "../src/local-service/dispatch/public-progress-stream";

describe("dispatch public progress stream", () => {
  it("deduplicates accepted retries without claiming an unavailable update", () => {
    const publish = vi
      .fn<(snapshot: string) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const report = createDispatchPublicProgressReporter({ publish });

    expect(report("  Inspecting the current contract.  ")).toEqual({
      status: "unavailable",
    });
    expect(report("Inspecting the current contract.")).toEqual({
      status: "accepted",
    });
    expect(report("Inspecting the current contract.")).toEqual({
      status: "duplicate",
    });
    expect(report("Starting focused verification.")).toEqual({
      status: "accepted",
    });

    expect(publish).toHaveBeenNthCalledWith(
      1,
      "Inspecting the current contract."
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      "Inspecting the current contract."
    );
    expect(publish).toHaveBeenNthCalledWith(
      3,
      "Inspecting the current contract.\n\nStarting focused verification."
    );
  });
});
