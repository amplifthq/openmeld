import { organizationDocumentPromptContextResponseSchema } from "@openmeld/schemas";
import type { OrganizationDocumentPromptContextResponse } from "@openmeld/schemas/types";

/** Each turn reads through its own current Core authorization. No cached body fallback. */
export async function resolveCurrentOrganizationDocumentPromptContext(input: {
  organizationId: string;
  read: () => Promise<unknown>;
}): Promise<OrganizationDocumentPromptContextResponse | null> {
  let raw: unknown;
  try {
    raw = await input.read();
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
