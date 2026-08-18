import { ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE } from "@openmeld/schemas";
import { createCoreRpcHttpError } from "../rpc/errors";

export function requireExpectedOrganizationContext(input: {
  actualOrganizationId: string;
  errorCode: string;
  expectedOrganizationId: string;
}): void {
  if (input.actualOrganizationId === input.expectedOrganizationId) {
    return;
  }
  throw createCoreRpcHttpError({
    code: input.errorCode,
    reason: ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE,
    status: 409,
  });
}
