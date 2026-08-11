import { createHash } from "node:crypto";
import { SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS } from "@openmeld/schemas";
import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";

type DispatchPromptTrace = NonNullable<
  OpenMeldDaemonTaskResultPayload["promptTrace"]
>;

const OMITTED_ORGANIZATION_POLICY =
  "[organization-protected information policy omitted]";

export function buildDispatchPromptTrace(input: {
  prompt: string;
  protectedInformation?: string | null;
}): DispatchPromptTrace | null {
  if (input.prompt.trim().length === 0) {
    return null;
  }
  const protectedInformation = input.protectedInformation?.trim();
  const traceSafePrompt = protectedInformation
    ? input.prompt.replaceAll(protectedInformation, OMITTED_ORGANIZATION_POLICY)
    : input.prompt;
  return {
    fingerprint: `sha256:${createHash("sha256")
      .update(input.prompt)
      .digest("hex")}`,
    length: input.prompt.length,
    preview:
      traceSafePrompt.length <= SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS
        ? traceSafePrompt
        : `${traceSafePrompt
            .slice(0, SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS - 3)
            .trimEnd()}...`,
  };
}
