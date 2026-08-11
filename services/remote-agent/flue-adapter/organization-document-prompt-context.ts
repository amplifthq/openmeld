import { organizationDocumentPromptContextResponseSchema } from "@openmeld/schemas";
import type { OrganizationDocumentPromptContextResponse } from "@openmeld/schemas/types";

export const ORGANIZATION_DOCUMENT_PROMPT_CONTEXT_CACHE_TTL_MS = 60_000;

type CachedOrganizationDocumentPromptContext = {
  expiresAtMs: number;
  value: OrganizationDocumentPromptContextResponse;
};

type OrganizationDocumentPromptContextCacheRead = {
  refresh: Promise<OrganizationDocumentPromptContextResponse> | null;
  value: OrganizationDocumentPromptContextResponse | null;
};

type OrganizationDocumentPromptContextRefresh = {
  promise: Promise<OrganizationDocumentPromptContextResponse>;
  token: symbol;
};

class OrganizationDocumentPromptContextContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OrganizationDocumentPromptContextContractError";
  }
}

const promptContextByOrganizationId = new Map<
  string,
  CachedOrganizationDocumentPromptContext
>();
const promptContextRefreshByOrganizationId = new Map<
  string,
  OrganizationDocumentPromptContextRefresh
>();

export function readCachedOrganizationDocumentPromptContext(input: {
  forceRefresh?: boolean;
  nowMs?: number;
  organizationId: string;
  read: () => Promise<unknown>;
}): OrganizationDocumentPromptContextCacheRead {
  const nowMs = input.nowMs ?? Date.now();
  const cached = promptContextByOrganizationId.get(input.organizationId);
  if (!input.forceRefresh && cached && cached.expiresAtMs > nowMs) {
    return { refresh: null, value: cached.value };
  }

  const activeRefresh = promptContextRefreshByOrganizationId.get(
    input.organizationId
  );
  if (activeRefresh) {
    return { refresh: activeRefresh.promise, value: cached?.value ?? null };
  }

  const refreshToken = Symbol(input.organizationId);
  const refresh =
    (async (): Promise<OrganizationDocumentPromptContextResponse> => {
      try {
        const rawValue = await input.read();
        const parsed =
          organizationDocumentPromptContextResponseSchema.safeParse(rawValue);
        if (!parsed.success) {
          throw new OrganizationDocumentPromptContextContractError(
            "Organization document prompt context response is invalid.",
            { cause: parsed.error }
          );
        }
        const value = parsed.data;
        if (value.organizationId !== input.organizationId) {
          throw new OrganizationDocumentPromptContextContractError(
            `Organization document prompt context returned ${value.organizationId} for ${input.organizationId}.`
          );
        }
        promptContextByOrganizationId.set(input.organizationId, {
          expiresAtMs:
            nowMs + ORGANIZATION_DOCUMENT_PROMPT_CONTEXT_CACHE_TTL_MS,
          value,
        });
        return value;
      } finally {
        if (
          promptContextRefreshByOrganizationId.get(input.organizationId)
            ?.token === refreshToken
        ) {
          promptContextRefreshByOrganizationId.delete(input.organizationId);
        }
      }
    })();
  promptContextRefreshByOrganizationId.set(input.organizationId, {
    promise: refresh,
    token: refreshToken,
  });
  return { refresh, value: cached?.value ?? null };
}

export async function resolveCachedOrganizationDocumentPromptContext(input: {
  nowMs?: number;
  organizationId: string;
  read: () => Promise<unknown>;
}): Promise<OrganizationDocumentPromptContextResponse> {
  const cacheRead = readCachedOrganizationDocumentPromptContext(input);
  if (cacheRead.refresh) {
    return await cacheRead.refresh;
  }
  if (!cacheRead.value) {
    throw new Error(
      `Organization document prompt context for ${input.organizationId} is unavailable.`
    );
  }
  return cacheRead.value;
}

export async function resolveCurrentOrganizationDocumentPromptContext(input: {
  nowMs?: number;
  organizationId: string;
  read: () => Promise<unknown>;
}): Promise<OrganizationDocumentPromptContextResponse> {
  const cacheRead = readCachedOrganizationDocumentPromptContext({
    ...input,
    forceRefresh: true,
  });
  try {
    if (cacheRead.refresh) {
      return await cacheRead.refresh;
    }
    if (cacheRead.value) {
      return cacheRead.value;
    }
  } catch (error) {
    if (
      error instanceof OrganizationDocumentPromptContextContractError ||
      !cacheRead.value
    ) {
      throw error;
    }
    console.warn(
      "[remote_agent.organization_prompt_context.refresh_unavailable]",
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        event: "remote_agent.organization_prompt_context.refresh_unavailable",
        organizationId: input.organizationId,
      }
    );
    return {
      ...cacheRead.value,
      organizationProtectedInformation: null,
    };
  }
  throw new Error(
    `Organization document prompt context for ${input.organizationId} is unavailable.`
  );
}
