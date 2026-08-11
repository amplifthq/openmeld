import { getLocalRuntimeExpectedRoutesQuerySchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("local runtime expected-routes contract", () => {
  it("accepts explicit v2 negotiation", () => {
    expect(
      getLocalRuntimeExpectedRoutesQuerySchema.parse({
        contractVersion: "v2",
        deviceId: "device-1",
        lane: "prod",
      })
    ).toEqual({
      contractVersion: "v2",
      deviceId: "device-1",
      lane: "prod",
    });
  });

  it("accepts explicit v3 negotiation", () => {
    expect(
      getLocalRuntimeExpectedRoutesQuerySchema.parse({
        contractVersion: "v3",
        deviceId: "device-1",
        lane: "prod",
      })
    ).toEqual({
      contractVersion: "v3",
      deviceId: "device-1",
      lane: "prod",
    });
  });

  it("keeps the legacy query valid and rejects unknown versions", () => {
    expect(
      getLocalRuntimeExpectedRoutesQuerySchema.safeParse({
        deviceId: "device-1",
        lane: "prod",
      }).success
    ).toBe(true);
    expect(
      getLocalRuntimeExpectedRoutesQuerySchema.safeParse({
        contractVersion: "v4",
        deviceId: "device-1",
        lane: "prod",
      }).success
    ).toBe(false);
  });
});
