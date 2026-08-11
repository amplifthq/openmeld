import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentAuthenticationGuide,
  buildHumanAuthenticationCard,
  resolveAuthenticationGuidance,
  resolveAuthenticationGuidanceFromMessage,
} from "../src/auth/auth-guidance";

describe("auth guidance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a minimal human prompt card for required sign-in", () => {
    const guidance = resolveAuthenticationGuidance({
      reason: "required",
      action: "joining a space",
    });

    expect(
      buildHumanAuthenticationCard({
        guidance,
        mode: "prompt",
      })
    ).toEqual({
      title: "Sign In Needed",
      rows: [
        {
          label: "Status",
          value: "Sign in before joining a space.",
        },
        {
          label: "Next",
          value: "Choose Sign in now to continue.",
        },
      ],
    });
  });

  it("builds a mismatch card with current environment context", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    const guidance = resolveAuthenticationGuidance({
      reason: "mismatch",
      action: "starting OpenMeld Service",
      authBaseUrl: "https://auth.one.example",
      gatewayUrl: "https://gateway.two.example",
    });

    expect(
      buildHumanAuthenticationCard({
        guidance,
        mode: "error",
      })
    ).toEqual({
      title: "Wrong OpenMeld Environment",
      rows: [
        {
          label: "Status",
          value:
            "Sign in to the right OpenMeld environment before starting OpenMeld Service.",
        },
        {
          label: "Signed In To",
          value: "https://auth.one.example",
        },
        {
          label: "This Command Uses",
          value: "https://gateway.two.example",
        },
        {
          label: "Next",
          value:
            "Run `openmeld-dev login` for this OpenMeld environment, then retry.",
        },
      ],
    });
  });

  it("builds explicit agent guidance for operators and agents", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    const guidance = resolveAuthenticationGuidance({
      reason: "required",
      action: "sending a message",
    });

    expect(buildAgentAuthenticationGuide(guidance)).toEqual({
      summary:
        "sign-in required; run `openmeld-dev login` in a human terminal, then retry",
      humanSteps: [
        "openmeld-dev login",
        "Retry after sign-in, then continue sending a message.",
      ],
      agentCommands: [
        "Ask the operator to complete sign-in in a human terminal, then retry the same command.",
      ],
      notes: ["Blocked action: sending a message"],
    });
  });

  it("parses auth guidance from legacy error messages", () => {
    expect(
      resolveAuthenticationGuidanceFromMessage(
        "authentication required; run `openmeld login`"
      )
    ).toMatchObject({
      reason: "required",
      title: "Sign In Needed",
    });

    expect(
      resolveAuthenticationGuidanceFromMessage(
        "authentication does not match current gateway (session auth: https://auth.one.example, gateway: https://gateway.two.example); run `openmeld login` and retry"
      )
    ).toMatchObject({
      reason: "mismatch",
      authBaseUrl: "https://auth.one.example",
      gatewayUrl: "https://gateway.two.example",
    });

    expect(
      resolveAuthenticationGuidanceFromMessage(
        'HTTP 401: {"code":"auth.unauthenticated"}'
      )
    ).toMatchObject({
      reason: "required",
      title: "Sign In Needed",
    });
  });
});
