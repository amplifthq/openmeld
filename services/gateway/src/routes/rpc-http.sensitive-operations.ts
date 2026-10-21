import {
  CREDENTIAL_CONFIRMATION_DECISION_ROUTE,
  CREDENTIAL_CONFIRMATION_ROUTE,
  credentialConfirmationRouteParamsSchema,
  decideCredentialConfirmationBodySchema,
  decideCredentialConfirmationResponseSchema,
  getCredentialConfirmationResponseSchema,
  listSensitiveOperationAuditResponseSchema,
  MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE,
  memberAgentSensitiveOperationAuditRouteParamsSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

// The owner's side of sensitive operations (design-plans/member-agent-program.md
// §4.7): read and answer a credential confirmation, read the audit. Core
// authorizes each call; an answer needs the owner's own Web or App session.

function noStore(): (
  c: Context<HonoBindings>,
  next: () => Promise<void>
) => Promise<void> {
  return async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  };
}

export function registerSensitiveOperationRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(CREDENTIAL_CONFIRMATION_ROUTE, noStore(), (c) => {
    const params = credentialConfirmationRouteParamsSchema.safeParse({
      confirmationId: c.req.param("confirmationId"),
    });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: CREDENTIAL_CONFIRMATION_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid confirmation ID.",
      });
    }
    return executeRpcRoute({
      c,
      route: CREDENTIAL_CONFIRMATION_ROUTE,
      method: "GET",
      responseSchema: getCredentialConfirmationResponseSchema,
      execute: () =>
        c.var.coreRpc.getCredentialConfirmation({
          confirmationId: params.data.confirmationId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(CREDENTIAL_CONFIRMATION_DECISION_ROUTE, noStore(), async (c) => {
    const params = credentialConfirmationRouteParamsSchema.safeParse({
      confirmationId: c.req.param("confirmationId"),
    });
    const raw = await readJsonRequestBody(c.req.raw);
    const body = raw.ok
      ? decideCredentialConfirmationBodySchema.safeParse(raw.value)
      : null;
    if (!(params.success && body?.success)) {
      return respondBadRequest({
        c,
        route: CREDENTIAL_CONFIRMATION_DECISION_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Choose approve or decline.",
      });
    }
    return executeRpcRoute({
      c,
      route: CREDENTIAL_CONFIRMATION_DECISION_ROUTE,
      method: "POST",
      responseSchema: decideCredentialConfirmationResponseSchema,
      execute: async () =>
        c.var.coreRpc.decideCredentialConfirmation({
          body: body.data,
          confirmationId: params.data.confirmationId,
          context: buildCoreRpcContext(c),
          requestCredential: await buildCoreRpcCredential(c),
        }),
    });
  });

  app.get(MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE, noStore(), (c) => {
    const params =
      memberAgentSensitiveOperationAuditRouteParamsSchema.safeParse({
        memberAgentId: c.req.param("memberAgentId"),
      });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid Agent ID.",
      });
    }
    return executeRpcRoute({
      c,
      route: MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE,
      method: "GET",
      responseSchema: listSensitiveOperationAuditResponseSchema,
      execute: () =>
        c.var.coreRpc.listMemberAgentSensitiveOperationAudit({
          context: buildCoreRpcContext(c),
          memberAgentId: params.data.memberAgentId,
        }),
    });
  });
}
