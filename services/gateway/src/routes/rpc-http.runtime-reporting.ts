import {
  AGENT_ACTIVITY_EVENT_BATCH_MAX_BYTES,
  AGENT_ACTIVITY_SESSION_RECONCILIATION_MAX_BYTES,
  AGENT_CONTROLLER_TASK_LIFECYCLE_EVENT_BATCH_MAX_BYTES,
  runtimeReportingRouteParamsSchema,
  submitAgentActivityEventsBodySchema,
  submitAgentActivityEventsResponseSchema,
  submitAgentActivitySessionReconciliationBodySchema,
  submitAgentActivitySessionReconciliationResponseSchema,
  submitAgentControllerTaskLifecycleEventsBodySchema,
  submitAgentControllerTaskLifecycleEventsResponseSchema,
  submitRuntimeAgentControllerReportsBodySchema,
  submitRuntimeAgentControllerReportsResponseSchema,
  submitRuntimeProviderConversationProofsBodySchema,
  submitRuntimeProviderConversationProofsResponseSchema,
  submitRuntimeRegistrationBodySchema,
  submitRuntimeRegistrationResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
  respondPayloadTooLarge,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const RUNTIME_REGISTRATION_ROUTE = "/v1/devices/:deviceId/runtime-registration";
const RUNTIME_AGENT_CONTROLLER_REPORTS_ROUTE =
  "/v1/devices/:deviceId/runtime-agent-controller-reports/current";
const RUNTIME_PROVIDER_CONVERSATION_PROOFS_ROUTE =
  "/v1/devices/:deviceId/runtime-provider-conversation-proofs/current";
const AGENT_ACTIVITY_EVENTS_ROUTE =
  "/v1/devices/:deviceId/agent-activity-events";
const AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE =
  "/v1/devices/:deviceId/agent-activity-session-reconciliation";
const AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE =
  "/v1/devices/:deviceId/agent-controller-task-lifecycle-events";

export function registerRuntimeReportingRoutes(app: Hono<HonoBindings>): void {
  app.put(AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE, async (c) => {
    const routeParams = parseRuntimeReportingRouteParams({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw, {
      maxBytes: AGENT_ACTIVITY_SESSION_RECONCILIATION_MAX_BYTES,
    });
    if (!bodyResult.ok) {
      if (bodyResult.message === "Payload too large") {
        return respondPayloadTooLarge({
          c,
          route: AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE,
          method: "PUT",
          message:
            "Agent Activity Session reconciliation exceeds its safety limit",
        });
      }
      return respondBadRequest({
        c,
        route: AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const parsedBody =
      submitAgentActivitySessionReconciliationBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Activity Session reconciliation is invalid",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_ACTIVITY_SESSION_RECONCILIATION_ROUTE,
      method: "PUT",
      responseSchema: submitAgentActivitySessionReconciliationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.submitAgentActivitySessionReconciliation({
          ...parsedBody.data,
          context: buildCoreRpcContext(c),
          deviceId: routeParams.value.deviceId,
        }),
    });
  });

  app.put(AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE, async (c) => {
    const routeParams = parseRuntimeReportingRouteParams({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw, {
      maxBytes: AGENT_CONTROLLER_TASK_LIFECYCLE_EVENT_BATCH_MAX_BYTES,
    });
    if (!bodyResult.ok) {
      if (bodyResult.message === "Payload too large") {
        return respondPayloadTooLarge({
          c,
          route: AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE,
          method: "PUT",
          message:
            "Agent Controller task lifecycle event batch exceeds its safety limit",
        });
      }
      return respondBadRequest({
        c,
        route: AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const parsedBody =
      submitAgentControllerTaskLifecycleEventsBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Controller task lifecycle event payload is invalid",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_CONTROLLER_TASK_LIFECYCLE_EVENTS_ROUTE,
      method: "PUT",
      responseSchema: submitAgentControllerTaskLifecycleEventsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.submitAgentControllerTaskLifecycleEvents({
          context: buildCoreRpcContext(c),
          deviceId: routeParams.value.deviceId,
          events: parsedBody.data.events,
          lane: parsedBody.data.lane,
          openMeldServiceRuntimeId: parsedBody.data.openMeldServiceRuntimeId,
        }),
    });
  });

  app.put(AGENT_ACTIVITY_EVENTS_ROUTE, async (c) => {
    const routeParams = parseRuntimeReportingRouteParams({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_ACTIVITY_EVENTS_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw, {
      maxBytes: AGENT_ACTIVITY_EVENT_BATCH_MAX_BYTES,
    });
    if (!bodyResult.ok) {
      if (bodyResult.message === "Payload too large") {
        return respondPayloadTooLarge({
          c,
          route: AGENT_ACTIVITY_EVENTS_ROUTE,
          method: "PUT",
          message: "Agent Activity event batch exceeds its safety limit",
        });
      }
      return respondBadRequest({
        c,
        route: AGENT_ACTIVITY_EVENTS_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const parsedBody = submitAgentActivityEventsBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_ACTIVITY_EVENTS_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Activity event payload is invalid",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_ACTIVITY_EVENTS_ROUTE,
      method: "PUT",
      responseSchema: submitAgentActivityEventsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.submitAgentActivityEvents({
          context: buildCoreRpcContext(c),
          deviceId: routeParams.value.deviceId,
          events: parsedBody.data.events,
          lane: parsedBody.data.lane,
          openMeldServiceRuntimeId: parsedBody.data.openMeldServiceRuntimeId,
        }),
    });
  });

  app.put(RUNTIME_REGISTRATION_ROUTE, async (c) => {
    const routeParams = parseRuntimeReportingRouteParams({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: RUNTIME_REGISTRATION_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: RUNTIME_REGISTRATION_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = submitRuntimeRegistrationBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: RUNTIME_REGISTRATION_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Runtime registration payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: RUNTIME_REGISTRATION_ROUTE,
      method: "PUT",
      responseSchema: submitRuntimeRegistrationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.submitRuntimeRegistration({
          deviceId: routeParams.value.deviceId,
          lane: parsedBody.data.lane,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(RUNTIME_AGENT_CONTROLLER_REPORTS_ROUTE, async (c) => {
    const routeParams = parseRuntimeReportingRouteParams({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: RUNTIME_AGENT_CONTROLLER_REPORTS_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: RUNTIME_AGENT_CONTROLLER_REPORTS_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = submitRuntimeAgentControllerReportsBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: RUNTIME_AGENT_CONTROLLER_REPORTS_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Runtime Agent Controller Report payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: RUNTIME_AGENT_CONTROLLER_REPORTS_ROUTE,
      method: "PUT",
      responseSchema: submitRuntimeAgentControllerReportsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.submitRuntimeAgentControllerReports({
          deviceId: routeParams.value.deviceId,
          lane: parsedBody.data.lane,
          reports: parsedBody.data.reports,
          openMeldServiceRuntimeId: parsedBody.data.openMeldServiceRuntimeId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(RUNTIME_PROVIDER_CONVERSATION_PROOFS_ROUTE, async (c) => {
    const routeParams = parseRuntimeReportingRouteParams({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: RUNTIME_PROVIDER_CONVERSATION_PROOFS_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: RUNTIME_PROVIDER_CONVERSATION_PROOFS_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody =
      submitRuntimeProviderConversationProofsBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: RUNTIME_PROVIDER_CONVERSATION_PROOFS_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Provider Conversation Proof payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: RUNTIME_PROVIDER_CONVERSATION_PROOFS_ROUTE,
      method: "PUT",
      responseSchema: submitRuntimeProviderConversationProofsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.submitRuntimeProviderConversationProofs({
          deviceId: routeParams.value.deviceId,
          lane: parsedBody.data.lane,
          proofs: parsedBody.data.proofs,
          openMeldServiceRuntimeId: parsedBody.data.openMeldServiceRuntimeId,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}

function parseRuntimeReportingRouteParams(input: { deviceId: string }):
  | {
      ok: true;
      value: { deviceId: string };
    }
  | {
      message: string;
      ok: false;
    } {
  const parsed = runtimeReportingRouteParamsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      message: parsed.error.issues[0]?.message ?? "deviceId is invalid",
      ok: false,
    };
  }
  return {
    ok: true,
    value: parsed.data,
  };
}
