import {
  betterAuthDeviceAuthorizationClaimResponseSchema,
  betterAuthDeviceAuthorizationCodeRequestSchema,
  betterAuthDeviceAuthorizationCodeResponseSchema,
  betterAuthDeviceAuthorizationDecisionRequestSchema,
  betterAuthDeviceAuthorizationDecisionResponseSchema,
} from "@openmeld/schemas";

/** The authenticated client's explicit connection action approves an independent Computer session. */
export async function createComputerAuthorizationGrant(
  request: (
    path: string,
    method: "GET" | "POST",
    body?: unknown
  ) => Promise<unknown>
) {
  const codeResult = betterAuthDeviceAuthorizationCodeResponseSchema.safeParse(
    await request(
      "/device/code",
      "POST",
      betterAuthDeviceAuthorizationCodeRequestSchema.parse({
        client_id: "openmeld-cli",
      })
    )
  );
  if (!codeResult.success) {
    throw new Error(
      "Auth returned an invalid computer authorization response."
    );
  }
  const code = codeResult.data;
  const claim = betterAuthDeviceAuthorizationClaimResponseSchema.safeParse(
    await request(
      `/device?user_code=${encodeURIComponent(code.user_code)}`,
      "GET"
    )
  );
  if (!claim.success) {
    throw new Error("Auth returned an invalid computer authorization claim.");
  }
  const approval =
    betterAuthDeviceAuthorizationDecisionResponseSchema.safeParse(
      await request(
        "/device/approve",
        "POST",
        betterAuthDeviceAuthorizationDecisionRequestSchema.parse({
          userCode: code.user_code,
        })
      )
    );
  if (!(approval.success && approval.data.success)) {
    throw new Error("Auth did not approve this computer authorization.");
  }
  return { deviceCode: code.device_code, expiresIn: code.expires_in };
}
