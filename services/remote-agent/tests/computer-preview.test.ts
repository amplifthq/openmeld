import { describe, expect, it, vi } from "vitest";
import {
  inspectComputerPreview,
  type PreviewBrowserBinding,
} from "../flue-adapter/computer-preview";

describe("private Computer preview", () => {
  it.each([
    { port: 80, path: "/" },
    { port: 4321, path: "//external.example/" },
    { port: 4321, path: "/\\external.example/" },
  ])("rejects an unsafe target before launching Browser Run", async (target) => {
    const launch = vi.fn();
    await expect(
      inspectComputerPreview({
        browser: { launch } as unknown as PreviewBrowserBinding,
        computerId: "computer-id",
        ctx: {} as DurableObjectState,
        expectedText: "ready",
        ...target,
      })
    ).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  });
});
