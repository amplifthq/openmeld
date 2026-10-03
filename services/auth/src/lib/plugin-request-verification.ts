import { timingSafeEqual } from "node:crypto";
import {
  pluginRequestVerificationCheckSchema,
  pluginRequestVerificationSchema,
} from "@openmeld/schemas";
import type {
  PluginRequestVerification,
  PluginRequestVerificationResult,
} from "@openmeld/schemas/types";
import type { AuthBindings } from "./bindings";

// These methods are service-binding RPCs, never public token-issuance routes.
// The code is delivered only to Auth's current verified account email. Core
// owns pending/approved/rejected state and atomically consumes the decision.
export async function sendPluginRequestVerification(
  env: AuthBindings,
  value: unknown
): Promise<PluginRequestVerificationResult> {
  const parsed = pluginRequestVerificationSchema.safeParse(value);
  if (!parsed.success) {
    return { status: "denied", reason: "invalid_request" };
  }
  const request = parsed.data;
  if (!validWindow(request)) {
    return { status: "denied", reason: "expired" };
  }
  const recipient = await currentRecipient(env, request);
  if (!recipient) {
    return { status: "denied", reason: "recipient_unavailable" };
  }
  if (!(env.AUTH_FROM_EMAIL && env.BETTER_AUTH_OPENMELD_SECRET)) {
    return { status: "denied", reason: "delivery_unavailable" };
  }
  const code = await requestCode(
    env.BETTER_AUTH_OPENMELD_SECRET,
    request,
    recipient.email
  );
  // No action input, destination, credential, or approval code enters Inbox,
  // a URL, an RPC response, or a diagnostic log.
  const text = `Enter this code in OpenMeld to approve the Plugin request you are reviewing:\n\n${code}\n\nIt expires with that request. Approving starts a new operation; it does not resolve an earlier unknown result. If you did not request this code, ignore this email.`;
  try {
    await env.AUTH_EMAIL.send({
      from: env.AUTH_FROM_EMAIL,
      to: recipient.email,
      subject: "Confirm your Plugin request",
      text,
      html: `<p>Enter this code in OpenMeld to approve the Plugin request you are reviewing:</p><p><strong>${code}</strong></p><p>It expires with that request. Approving starts a new operation; it does not resolve an earlier unknown result.</p><p>If you did not request this code, ignore this email.</p>`,
    });
    return { status: "sent" };
  } catch {
    // Sending may have succeeded. Core retains the request and its send claim;
    // it must not turn this into an automatic resend or an approval.
    return { status: "denied", reason: "delivery_unavailable" };
  }
}

export async function checkPluginRequestVerification(
  env: AuthBindings,
  value: unknown
): Promise<PluginRequestVerificationResult> {
  const parsed = pluginRequestVerificationCheckSchema.safeParse(value);
  if (!parsed.success) {
    return { status: "denied", reason: "invalid_request" };
  }
  const { code, ...request } = parsed.data;
  if (!validWindow(request)) {
    return { status: "denied", reason: "expired" };
  }
  const recipient = await currentRecipient(env, request);
  if (!(recipient && env.BETTER_AUTH_OPENMELD_SECRET)) {
    return { status: "denied", reason: "recipient_unavailable" };
  }
  const expected = await requestCode(
    env.BETTER_AUTH_OPENMELD_SECRET,
    request,
    recipient.email
  );
  const candidate = code.replaceAll("-", "").toLowerCase();
  const normalized = expected.replaceAll("-", "");
  const encoder = new TextEncoder();
  const candidateBytes = encoder.encode(candidate);
  const expectedBytes = encoder.encode(normalized);
  return candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
    ? { status: "verified" }
    : { status: "denied", reason: "verification_invalid" };
}

function validWindow(request: PluginRequestVerification): boolean {
  const now = Date.now();
  return (
    request.expiresAtMs > now && request.expiresAtMs <= now + 60 * 60 * 1000
  );
}

function currentRecipient(
  env: AuthBindings,
  request: PluginRequestVerification
) {
  return env.OPENMELD_DB.prepare(
    "SELECT users.email AS email FROM users INNER JOIN members ON members.user_id = users.id WHERE users.id = ? AND members.organization_id = ? AND users.email_verified = 1 LIMIT 1"
  )
    .bind(request.userId, request.organizationId)
    .first<{ email: string }>();
}

async function requestCode(
  secret: string,
  request: PluginRequestVerification,
  email: string
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      JSON.stringify([
        "openmeld.plugin-request-human-verification.v1",
        request.requestId,
        request.organizationId,
        request.userId,
        request.requestDigest,
        request.expiresAtMs,
        email,
      ])
    )
  );
  const hex = Array.from(new Uint8Array(signature).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 16),
    hex.slice(16, 24),
    hex.slice(24),
  ].join("-");
}
