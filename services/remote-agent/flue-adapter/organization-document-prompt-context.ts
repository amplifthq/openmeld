import { organizationDocumentPromptContextResponseSchema } from "@openmeld/schemas";
import type { OrganizationDocumentPromptContextResponse } from "@openmeld/schemas/types";
import { readCoreRpcErrorCode } from "../agent-core/core-rpc";

/** Each turn reads through its own current Core authorization. No cached body fallback. */
export async function resolveCurrentOrganizationDocumentPromptContext(input: {
  organizationId: string;
  read: (includeSourceReferences: boolean) => Promise<unknown>;
}): Promise<OrganizationDocumentPromptContextResponse | null> {
  let raw: unknown;
  try {
    raw = await input.read(true).catch((error: unknown) => {
      // Older Core rejects the new opt-in before authorization or reads. Its
      // unchanged projection still performs fresh authorization and retains
      // the current Brief and information-protection hints.
      if (readCoreRpcErrorCode(error) !== "invalid_payload") {
        throw error;
      }
      return input.read(false);
    });
  } catch (error) {
    console.warn(
      "[remote_agent.organization_prompt_context.refresh_unavailable]",
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        organizationId: input.organizationId,
      }
    );
    return null;
  }
  const parsed = organizationDocumentPromptContextResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "Organization document prompt context response is invalid.",
      { cause: parsed.error }
    );
  }
  if (parsed.data.organizationId !== input.organizationId) {
    throw new Error(
      "Organization document prompt context belongs to another Organization."
    );
  }
  return parsed.data;
}
