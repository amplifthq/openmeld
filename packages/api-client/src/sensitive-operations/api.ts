import {
  CREDENTIAL_CONFIRMATION_DECISION_ROUTE,
  CREDENTIAL_CONFIRMATION_ROUTE,
  decideCredentialConfirmationResponseSchema,
  getCredentialConfirmationResponseSchema,
  listSensitiveOperationAuditResponseSchema,
  MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE,
} from "@openmeld/schemas";
import type { CreateSensitiveOperationsApi } from "./types";

const JSON_HEADERS = { "content-type": "application/json" } as const;

function fill(route: string, params: Record<string, string>): string {
  return route.replace(/:([A-Za-z]+)/gu, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing route parameter ${name}.`);
    }
    return encodeURIComponent(value);
  });
}

/** Credential confirmations and the audit (member-agent-program.md §4.7). */
export const createSensitiveOperationsApi: CreateSensitiveOperationsApi = (
  client
) => ({
  getConfirmation: async (confirmationId) =>
    await client.requestJson({
      invalidMessage: "Invalid credential confirmation.",
      method: "GET",
      operation: "credential_confirmation.get",
      schema: getCredentialConfirmationResponseSchema,
      url: fill(CREDENTIAL_CONFIRMATION_ROUTE, { confirmationId }),
    }),
  decideConfirmation: async (confirmationId, decision) =>
    await client.requestJson({
      body: JSON.stringify({ decision }),
      headers: JSON_HEADERS,
      invalidMessage: "Invalid credential confirmation response.",
      method: "POST",
      operation: "credential_confirmation.decide",
      schema: decideCredentialConfirmationResponseSchema,
      url: fill(CREDENTIAL_CONFIRMATION_DECISION_ROUTE, { confirmationId }),
    }),
  listMemberAgentAudit: async (memberAgentId) =>
    await client.requestJson({
      invalidMessage: "Invalid sensitive operation audit.",
      method: "GET",
      operation: "sensitive_operation.list_audit",
      schema: listSensitiveOperationAuditResponseSchema,
      url: `${fill(MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE, {
        memberAgentId,
      })}?responseVersion=2`,
    }),
});
