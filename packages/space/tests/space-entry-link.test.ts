import { describe, expect, it } from "vitest";
import {
  buildPublicSpaceEntryPath,
  buildPublicSpaceEntryUrl,
} from "../src/access/space-entry-link";

describe("Space entry links", () => {
  it("builds the neutral public entry for a Space", () => {
    expect(
      buildPublicSpaceEntryUrl({
        origin: "https://openmeld.ai",
        target: { spaceId: "space-123" },
      })
    ).toBe("https://openmeld.ai/spaces/space-123");
  });

  it("preserves an exact message and Thread destination", () => {
    expect(
      buildPublicSpaceEntryPath({
        signalId: "signal/with spaces",
        spaceId: "space/with spaces",
        threadRootSignalId: "thread?root",
      })
    ).toBe(
      "/spaces/space%2Fwith%20spaces?signalId=signal%2Fwith+spaces&threadRootSignalId=thread%3Froot"
    );
  });

  it("normalizes target text through the shared entry schema", () => {
    expect(
      buildPublicSpaceEntryUrl({
        origin: null,
        target: {
          signalId: "  signal-123  ",
          spaceId: "  space-123  ",
          threadRootSignalId: "  thread-123  ",
        },
      })
    ).toBe(
      "/spaces/space-123?signalId=signal-123&threadRootSignalId=thread-123"
    );
  });
});
