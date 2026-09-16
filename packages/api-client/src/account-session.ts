import { ACCOUNT_SESSION_PATH, accountSessionSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";
import { readApiClientJsonResponse } from "./errors";

export async function readAccountSession(client: OpenMeldApiClientFoundation) {
  const response = await client.requestResponse({
    url: ACCOUNT_SESSION_PATH,
    method: "GET",
    operation: "account.session.read",
  });
  if (response.status === 401) {
    return null;
  }
  return readApiClientJsonResponse({
    operation: "account.session.read",
    response,
    schema: accountSessionSchema,
    invalidMessage: "Invalid account session response.",
  });
}
