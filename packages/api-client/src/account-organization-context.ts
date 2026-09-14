import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  accountOrganizationContextSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";
import { readApiClientJsonResponse } from "./errors";

export async function readAccountOrganizationContext(
  client: OpenMeldApiClientFoundation
) {
  const response = await client.requestResponse({
    url: ACCOUNT_ORGANIZATION_CONTEXT_PATH,
    method: "GET",
    operation: "account.organizationContext.read",
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
