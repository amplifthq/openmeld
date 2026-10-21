import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  accountOrganizationContextQuerySchema,
  accountOrganizationContextSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";
import {
  attachApiClientRequestDetails,
  readApiClientJsonResponse,
} from "./errors";

export async function readAccountOrganizationContext(
  client: OpenMeldApiClientFoundation,
  options: {
    deferSessionRefresh?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
) {
  const query = accountOrganizationContextQuerySchema.parse({
    deferSessionRefresh:
      options.deferSessionRefresh === true ? "true" : undefined,
  });
  const search = query.deferSessionRefresh
    ? `?deferSessionRefresh=${query.deferSessionRefresh}`
    : "";
  const requestId = crypto.randomUUID();
  const operation = "account.organizationContext.read";
  try {
    const response = await client.requestResponse({
      url: `${ACCOUNT_ORGANIZATION_CONTEXT_PATH}${search}`,
      method: "GET",
      operation,
      headers: { "x-request-id": requestId },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    if (response.status === 401) {
      return null;
    }
    return await readApiClientJsonResponse({
      operation,
      response,
      schema: accountOrganizationContextSchema,
      invalidMessage: "Invalid account Organization context response.",
    });
  } catch (error) {
    // Keep the same correlation even when no response headers arrive.
    attachApiClientRequestDetails(error, { operation, requestId });
    throw error;
  }
}
