import { describe, expect, it } from "vitest";
import {
  daemonBootstrapRecommendationPayloadSchema,
  daemonBootstrapRecommendationResultSchema,
} from "../../src/index";

describe("daemon service recommendation schema", () => {
  it("accepts valid recommendation payload", () => {
    const result = daemonBootstrapRecommendationPayloadSchema.safeParse({
      recommended: true,
      reason: "service_missing",
      autoInstallMode: "ask",
      installCommand: "openmeld service install",
      configureAlwaysFlag: "--service-auto-install always",
      configureSkipFlag: "--service-auto-install never",
      note: "Install is strongly recommended.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid auto-install mode", () => {
    const result = daemonBootstrapRecommendationPayloadSchema.safeParse({
      recommended: true,
      reason: "service_missing",
      autoInstallMode: "prompt",
      installCommand: "openmeld service install",
      configureAlwaysFlag: "--service-auto-install always",
      configureSkipFlag: "--service-auto-install never",
      note: "Install is strongly recommended.",
    });
    expect(result.success).toBe(false);
  });

  it("accepts full result envelope", () => {
    const result = daemonBootstrapRecommendationResultSchema.safeParse({
      type: "result",
      code: "daemon.bootstrap.recommended",
      payload: {
        recommended: true,
        reason: "service_missing",
        autoInstallMode: "never",
        installCommand: "openmeld service install",
        configureAlwaysFlag: "--service-auto-install always",
        configureSkipFlag: "--service-auto-install never",
        note: "Install is strongly recommended.",
      },
    });
    expect(result.success).toBe(true);
  });
});
