import type {
  AgentActivityEvent,
  SubmitAgentActivityEventsBody,
  SubmitAgentActivityEventsResponse,
  SubmitAgentControllerTaskLifecycleEventsBody,
  SubmitAgentControllerTaskLifecycleEventsResponse,
  SubmitRuntimeAgentControllerReportsBody,
  SubmitRuntimeAgentControllerReportsResponse,
  SubmitRuntimeProviderConversationProofsBody,
  SubmitRuntimeProviderConversationProofsResponse,
  SubmitRuntimeRegistrationBody,
  SubmitRuntimeRegistrationResponse,
} from "@openmeld/schemas/types";

export type SubmitAgentActivityEventsInput = Omit<
  SubmitAgentActivityEventsBody,
  "events"
> & {
  deviceId: string;
  events: AgentActivityEvent[];
};

export type SubmitRuntimeRegistrationInput = SubmitRuntimeRegistrationBody & {
  deviceId: string;
};

export type SubmitAgentControllerTaskLifecycleEventsInput =
  SubmitAgentControllerTaskLifecycleEventsBody & {
    deviceId: string;
  };

export type SubmitRuntimeAgentControllerReportsInput =
  SubmitRuntimeAgentControllerReportsBody & {
    deviceId: string;
  };

export type SubmitRuntimeProviderConversationProofsInput =
  SubmitRuntimeProviderConversationProofsBody & {
    deviceId: string;
  };

export type CreateRuntimeReportingApi = (
  client: import("../client").OpenMeldApiClientFoundation
) => {
  submitRegistration: (
    input: SubmitRuntimeRegistrationInput
  ) => Promise<SubmitRuntimeRegistrationResponse>;
  submitAgentActivityEvents: (
    input: SubmitAgentActivityEventsInput
  ) => Promise<SubmitAgentActivityEventsResponse>;
  submitAgentControllerTaskLifecycleEvents: (
    input: SubmitAgentControllerTaskLifecycleEventsInput
  ) => Promise<SubmitAgentControllerTaskLifecycleEventsResponse>;
  submitAgentControllerReports: (
    input: SubmitRuntimeAgentControllerReportsInput
  ) => Promise<SubmitRuntimeAgentControllerReportsResponse>;
  submitProviderConversationProofs: (
    input: SubmitRuntimeProviderConversationProofsInput
  ) => Promise<SubmitRuntimeProviderConversationProofsResponse>;
};
