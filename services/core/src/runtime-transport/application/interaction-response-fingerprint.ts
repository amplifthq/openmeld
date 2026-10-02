import type { AgentInteractionResponse } from "@openmeld/schemas/types";

/** Keep an exact replay receipt without retaining private answers after delivery. */
export async function interactionResponseFingerprint(
  response: AgentInteractionResponse
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(response))
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
