import { createHash } from "node:crypto";
import { normalizeMessageEnvelope } from "@openmeld/schemas";
import type { MessageEnvelope } from "@openmeld/schemas/types";
import { stringifyCanonicalJson } from "@openmeld/utils";

export function pluginContinuationTextDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function pluginConnectionSourceEnvelopeDigest(
  envelope: MessageEnvelope
): string {
  return pluginContinuationTextDigest(
    stringifyCanonicalJson(normalizeMessageEnvelope(envelope))
  );
}
