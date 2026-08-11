import { buildDaemonBootstrapRecommendationResult } from "@openmeld/local-service";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("local service bootstrap recommendation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds schema-compliant result envelope", () => {
    const result = buildDaemonBootstrapRecommendationResult({
      mode: "never",
      note: "Install is strongly recommended.",
    });

    expect(result.type).toBe("result");
    expect(result.code).toBe("daemon.bootstrap.recommended");
    expect(result.payload.autoInstallMode).toBe("never");
    expect(result.payload.reason).toBe("service_missing");
  });

  it("keeps the structured install command stable even in dev lane", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    const result = buildDaemonBootstrapRecommendationResult({
      mode: "ask",
      note: "Install is strongly recommended.",
    });

    expect(result.payload.installCommand).toBe("openmeld service install");
  });
});
