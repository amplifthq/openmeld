import { describe, expect, it } from "vitest";
import {
  betterAuthDeviceAuthorizationCodeResponseSchema,
  betterAuthDeviceAuthorizationTokenResponseSchema,
  betterAuthSessionSnapshotResponseSchema,
} from "../../src/schemas/http/auth-device-authorization";

// Fixtures follow Better Auth 1.6.30's published deviceAuthorization route
// contract in dist/plugins/device-authorization/index.d.mts.
const DEVICE_CODE_RESPONSE_FIXTURE = {
  device_code: "device-secret",
  user_code: "MELD-1234",
  verification_uri: "https://auth.openmeld.test/device",
  verification_uri_complete:
    "https://auth.openmeld.test/device?user_code=MELD-1234",
  expires_in: 300,
  interval: 5,
};

describe("Better Auth Device Authorization HTTP contracts", () => {
  it("accepts the vendor device-code response contract", () => {
    expect(
      betterAuthDeviceAuthorizationCodeResponseSchema.safeParse(
        DEVICE_CODE_RESPONSE_FIXTURE
      ).success
    ).toBe(true);
  });

  it("rejects a partial device-code response that cannot drive verification", () => {
    expect(
      betterAuthDeviceAuthorizationCodeResponseSchema.safeParse({
        device_code: "device-secret",
        user_code: "MELD-1234",
        expires_in: 300,
      }).success
    ).toBe(false);
  });

  it("rejects a token response without the vendor-required lifetime", () => {
    expect(
      betterAuthDeviceAuthorizationTokenResponseSchema.safeParse({
        access_token: "access-token",
        token_type: "Bearer",
        scope: "openid profile email",
      }).success
    ).toBe(false);
  });

  it("accepts an authenticated Better Auth session snapshot", () => {
    expect(
      betterAuthSessionSnapshotResponseSchema.safeParse({
        session: { id: "session-1" },
        user: {
          id: "user-1",
          email: "you@example.com",
          name: "You",
        },
      }).success
    ).toBe(true);
  });
});
