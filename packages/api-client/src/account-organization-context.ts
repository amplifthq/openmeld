import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  accountOrganizationContextSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";
import { readApiClientJsonResponse } from "./errors";

export async function readAccountOrganizationContext(
  client: OpenMeldApiClientFoundation,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
) {
  const response = await client.requestResponse({
    url: ACCOUNT_ORGANIZATION_CONTEXT_PATH,
    method: "GET",
    operation: "account.organizationContext.read",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.status === 401) {
    return null;
  }
  return readApiClientJsonResponse({
    operation: "account.organizationContext.read",
    response,
    schema: accountOrganizationContextSchema,
    invalidMessage: "Invalid account Organization context response.",
  });
}
