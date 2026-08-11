import { describe, expect, it } from "vitest";
import { accountSpaceActiveWakeSummaryRpcInputSchema } from "../../src/schemas";

describe("account Space active Wake summary contracts", () => {
  it("accepts the legacy Gateway RPC shape while normalizing current input", () => {
    expect(
      accountSpaceActiveWakeSummaryRpcInputSchema.parse({
        ownerUserId: " owner-one ",
        selectedProfileId: " profile-one ",
      })
    ).toEqual({
      ownerUserId: "owner-one",
      selectedProfileId: "profile-one",
    });
    expect(
      accountSpaceActiveWakeSummaryRpcInputSchema.parse({
        gatewayHost: "GATEWAY.OPENMELD.TEST",
        ownerUserId: "owner-one",
        selectedProfileId: "profile-one",
      })
    ).toEqual({
      gatewayHost: "gateway.openmeld.test",
      ownerUserId: "owner-one",
      selectedProfileId: "profile-one",
    });
  });
});
