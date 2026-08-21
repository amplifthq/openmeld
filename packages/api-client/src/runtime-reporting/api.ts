import {
  agentActivityEventSchema,
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
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildAgentActivityEventsRoute,
  buildAgentActivitySessionReconciliationRoute,
  buildAgentControllerTaskLifecycleEventsRoute,
  buildRuntimeAgentControllerReportsRoute,
  buildRuntimeProviderConversationProofsRoute,
  buildRuntimeRegistrationRoute,
} from "./routes";
import type {
  CreateRuntimeReportingApi,
  SubmitAgentActivityEventsInput,
  SubmitAgentActivitySessionReconciliationInput,
  SubmitAgentControllerTaskLifecycleEventsInput,
  SubmitRuntimeAgentControllerReportsInput,
  SubmitRuntimeProviderConversationProofsInput,
  SubmitRuntimeRegistrationInput,
} from "./types";

function requireValidAgentActivityEventsBody(
  input: SubmitAgentActivityEventsInput
) {
  const events = input.events.map((event) => {
    const parsed = agentActivityEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues[0]?.message ?? "Invalid Agent Activity event."
      );
    }
    return parsed.data;
  });
  const parsed = submitAgentActivityEventsBodySchema.safeParse({
    events,
    lane: input.lane,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Activity event submission."
    );
  }
  return parsed.data;
}

function requireValidAgentActivitySessionReconciliationBody(
  input: SubmitAgentActivitySessionReconciliationInput
) {
  const { deviceId: _deviceId, ...body } = input;
  const parsed =
    submitAgentActivitySessionReconciliationBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Activity Session reconciliation."
    );
  }
  return parsed.data;
}

function requireValidRuntimeRegistrationBody(
  input: SubmitRuntimeRegistrationInput
) {
  const parsed = submitRuntimeRegistrationBodySchema.safeParse({
    lane: input.lane,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Runtime registration payload."
    );
  }
  return parsed.data;
}

function requireValidAgentControllerTaskLifecycleEventsBody(
  input: SubmitAgentControllerTaskLifecycleEventsInput
) {
  const parsed = submitAgentControllerTaskLifecycleEventsBodySchema.safeParse({
    events: input.events,
    lane: input.lane,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Controller task lifecycle event payload."
    );
  }
  return parsed.data;
}

function requireValidRuntimeAgentControllerReportsBody(
  input: SubmitRuntimeAgentControllerReportsInput
) {
  const parsed = submitRuntimeAgentControllerReportsBodySchema.safeParse({
    lane: input.lane,
    reports: input.reports,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Runtime Agent Controller Report payload."
    );
  }
  return parsed.data;
}

function requireValidRuntimeProviderConversationProofsBody(
  input: SubmitRuntimeProviderConversationProofsInput
) {
  const parsed = submitRuntimeProviderConversationProofsBodySchema.safeParse({
    lane: input.lane,
    proofs: input.proofs,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Provider Conversation Proof payload."
    );
  }
  return parsed.data;
}

export const createRuntimeReportingApi: CreateRuntimeReportingApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    submitAgentActivityEvents: async (input) => {
      const body = requireValidAgentActivityEventsBody(input);
      return await client.requestJson({
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid Agent Activity event response.",
        method: "PUT",
        operation: "agent_activity.events.submit",
        schema: submitAgentActivityEventsResponseSchema,
        url: buildAgentActivityEventsRoute(input.deviceId),
      });
    },
    submitAgentActivitySessionReconciliation: async (input) => {
      const body = requireValidAgentActivitySessionReconciliationBody(input);
      return await client.requestJson({
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        invalidMessage:
          "Invalid Agent Activity Session reconciliation response.",
        method: "PUT",
        operation: "agent_activity.sessions.reconcile",
        schema: submitAgentActivitySessionReconciliationResponseSchema,
        url: buildAgentActivitySessionReconciliationRoute(input.deviceId),
      });
    },
    submitAgentControllerTaskLifecycleEvents: async (input) => {
      const body = requireValidAgentControllerTaskLifecycleEventsBody(input);
      return await client.requestJson({
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        invalidMessage:
          "Invalid Agent Controller task lifecycle event response.",
        method: "PUT",
        operation: "agent_controller_task.lifecycle_events.submit",
        schema: submitAgentControllerTaskLifecycleEventsResponseSchema,
        url: buildAgentControllerTaskLifecycleEventsRoute(input.deviceId),
      });
    },
    submitRegistration: async (input) => {
      const body = requireValidRuntimeRegistrationBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage: "Invalid Runtime registration response.",
        method: "PUT",
        operation: "runtime.registration.submit",
        schema: submitRuntimeRegistrationResponseSchema,
        url: buildRuntimeRegistrationRoute(input.deviceId),
      });
    },
    submitAgentControllerReports: async (input) => {
      const body = requireValidRuntimeAgentControllerReportsBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage: "Invalid Runtime Agent Controller Report response.",
        method: "PUT",
        operation: "runtime.agent_controller_reports.submit",
        schema: submitRuntimeAgentControllerReportsResponseSchema,
        url: buildRuntimeAgentControllerReportsRoute(input.deviceId),
      });
    },
    submitProviderConversationProofs: async (input) => {
      const body = requireValidRuntimeProviderConversationProofsBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage: "Invalid Provider Conversation Proof response.",
        method: "PUT",
        operation: "runtime.provider_conversation_proofs.submit",
        schema: submitRuntimeProviderConversationProofsResponseSchema,
        url: buildRuntimeProviderConversationProofsRoute(input.deviceId),
      });
    },
  };
};
