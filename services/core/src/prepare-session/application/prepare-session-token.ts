import { prepareOpaqueTokenSchema } from "@openmeld/schemas";
import type { PrepareOpaqueToken } from "@openmeld/schemas/types";

export function createPrepareOpaqueToken(): PrepareOpaqueToken {
  const parsed = prepareOpaqueTokenSchema.safeParse(
    `preptok_${crypto.randomUUID()}_${crypto.randomUUID()}`
  );
  if (!parsed.success) {
    throw new Error("failed to create prepare opaque token");
  }
  return parsed.data;
}

export async function digestPrepareOpaqueToken(
  token: PrepareOpaqueToken
): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const digestHex = [...new Uint8Array(digestBuffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${digestHex}`;
}
