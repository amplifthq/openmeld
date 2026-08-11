import { describe, expect, it } from "vitest";
import {
  formatOpenClawAuthDisplay,
  formatOpenClawBootstrapDisplay,
  formatOpenClawGatewayHealthDisplay,
  formatOpenClawGatewayVisibilityDisplay,
} from "../src/system/provider-diagnostics/openclaw/presentation";

const BASE_DIAGNOSTICS = {
  agentId: "openmeld-openclaw-phase-one",
  authStatus: "copied" as const,
  bootstrapResolution: "adopted" as const,
  bootstrapStatus: "healthy" as const,
  errorCode: null,
  gatewayHealth: "healthy" as const,
  gatewayVisibility: "restarted_then_visible" as const,
  message: null,
  workspaceDir: "/tmp/openmeld-openclaw-profile",
};

describe("openclaw diagnostics presentation", () => {
  it("formats repair-mode bootstrap and auth fields for display", () => {
    expect(
      formatOpenClawBootstrapDisplay({
        diagnostics: BASE_DIAGNOSTICS,
        mode: "repair",
      })
    ).toBe("adopted");
    expect(
      formatOpenClawAuthDisplay({
        diagnostics: BASE_DIAGNOSTICS,
        mode: "repair",
      })
    ).toBe("copied from default agent");
  });

  it("formats inspect-mode fallback and gateway fields for display", () => {
    expect(
      formatOpenClawAuthDisplay({
        diagnostics: {
          ...BASE_DIAGNOSTICS,
          authStatus: "copied",
        },
        mode: "inspect",
      })
    ).toBe("repairable from default agent");
    expect(formatOpenClawGatewayHealthDisplay(BASE_DIAGNOSTICS)).toBe(
      "healthy"
    );
    expect(
      formatOpenClawGatewayHealthDisplay({
        ...BASE_DIAGNOSTICS,
        gatewayHealth: "mystery" as never,
      })
    ).toBe("mystery");
    expect(
      formatOpenClawGatewayHealthDisplay({
        ...BASE_DIAGNOSTICS,
        gatewayHealth: undefined as never,
      })
    ).toBe("unknown");
    expect(formatOpenClawGatewayVisibilityDisplay(BASE_DIAGNOSTICS)).toBe(
      "restarted then visible"
    );
  });

  it("surfaces unknown auth status values instead of masking them", () => {
    expect(
      formatOpenClawAuthDisplay({
        diagnostics: {
          ...BASE_DIAGNOSTICS,
          authStatus: "expired" as never,
        },
        mode: "repair",
      })
    ).toBe("expired");
  });

  it("surfaces unknown gateway visibility values instead of masking them", () => {
    expect(
      formatOpenClawGatewayVisibilityDisplay({
        ...BASE_DIAGNOSTICS,
        gatewayVisibility: "visible_after_refresh" as never,
      })
    ).toBe("visible_after_refresh");
  });
});
