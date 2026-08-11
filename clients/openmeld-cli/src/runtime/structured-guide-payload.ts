import { structuredGuidePayloadFromInputSchema } from "@openmeld/schemas/schemas";
import type { StructuredGuidePayload } from "@openmeld/schemas/types";
import type { DualViewGuideInput } from "./dual-view-guide";

export function buildStructuredGuidePayload(
  guide: DualViewGuideInput
): StructuredGuidePayload {
  const parsed = structuredGuidePayloadFromInputSchema.safeParse(guide);
  if (parsed.success) {
    return parsed.data;
  }

  const firstIssueMessage = parsed.error.issues[0]?.message;
  throw new Error(
    `invalid structured guide payload: ${firstIssueMessage ?? "unknown validation error"}`
  );
}
