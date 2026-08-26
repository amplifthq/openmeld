import { describe, expect, it } from "vitest";
import { resolveLocalAgentControlResponseTimeoutMs } from "../runtime-transport/transport/do/runtime-transport-hub";

describe("resolveLocalAgentControlResponseTimeoutMs", () => {
  it("keeps local agent enable writes on the short response timeout", () => {
    expect(resolveLocalAgentControlResponseTimeoutMs("set_enabled")).toBe(5000);
  });

  it("lets manual catalog refresh wait behind an in-flight heartbeat", () => {
    expect(resolveLocalAgentControlResponseTimeoutMs("refresh_catalog")).toBe(
      15_000
    );
  });

  it("lets installation discovery finish its bounded controller checks", () => {
    expect(
      resolveLocalAgentControlResponseTimeoutMs("manage_installation")
    ).toBe(30_000);
  });
});
