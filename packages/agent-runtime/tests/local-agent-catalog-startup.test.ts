import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local agent catalog startup", () => {
  it("does not initialize locale-aware collation while loading the module", async () => {
    vi.resetModules();
    const localeCompare = vi.spyOn(String.prototype, "localeCompare");

    await import("../src/local-agent-catalog");

    expect(localeCompare).not.toHaveBeenCalled();
  });
});
