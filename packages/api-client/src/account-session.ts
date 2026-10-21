import { ACCOUNT_SESSION_PATH, accountSessionSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";
import {
  attachApiClientRequestDetails,
  readApiClientJsonResponse,
} from "./errors";

export async function readAccountSession(
  client: OpenMeldApiClientFoundation,
  options: { signal?: AbortSignal } = {}
) {
  const requestId = crypto.randomUUID();
  const operation = "account.session.read";
  try {
    const response = await client.requestResponse({
      url: ACCOUNT_SESSION_PATH,
      method: "GET",
      operation,
      headers: { "x-request-id": requestId },
      signal: options.signal,
    });
    if (response.status === 401) {
      return null;
    }
    return await readApiClientJsonResponse({
      operation,
      response,
      schema: accountSessionSchema,
      invalidMessage: "Invalid account session response.",
    });
  } catch (error) {
    attachApiClientRequestDetails(error, { operation, requestId });
    throw error;
  }
}
