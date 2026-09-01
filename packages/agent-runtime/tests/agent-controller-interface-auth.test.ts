import { describe, expect, it } from "vitest";
import {
  areAgentControllerInterfaceAccountsSame,
  hasOnlyAgentControllerSignInReasonCodes,
} from "../src/agent-controller-interface-auth";

describe("Agent Controller Interface account identity", () => {
  it("matches authenticated accounts by normalized provider email", () => {
    expect(
      areAgentControllerInterfaceAccountsSame(
        {
          email: "Capacity.Owner@Example.com",
          status: "authenticated",
        },
        {
          email: "capacity.owner@example.com",
          status: "authenticated",
        }
      )
    ).toBe(true);
  });

  it("fails closed for different or unidentified authenticated accounts", () => {
    expect(
      areAgentControllerInterfaceAccountsSame(
        {
          email: "previous@example.com",
          status: "authenticated",
        },
        { email: "next@example.com", status: "authenticated" }
      )
    ).toBe(false);
    expect(
      areAgentControllerInterfaceAccountsSame(
        { label: "Grok account connected", status: "authenticated" },
        { label: "Grok account connected", status: "authenticated" }
      )
    ).toBe(false);
  });
});

describe("Agent Controller Interface sign-in blockers", () => {
  it("accepts the provider-account reason reported with an unauthenticated controller", () => {
    expect(
      hasOnlyAgentControllerSignInReasonCodes([
        "provider_account.access_required",
        "controller.auth.unauthenticated",
      ])
    ).toBe(true);
  });

  it("requires the controller authentication reason and rejects real setup failures", () => {
    expect(
      hasOnlyAgentControllerSignInReasonCodes([
        "provider_account.access_required",
      ])
    ).toBe(false);
    expect(
      hasOnlyAgentControllerSignInReasonCodes([
        "controller.auth.unauthenticated",
        "controller.launch.needs_repair",
      ])
    ).toBe(false);
  });
});
