import type { BaseIssue, GenericSchema } from "valibot";
import type { RemoteAgentToolProgressTracking } from "./tool-progress";

export type RemoteAgentToolInputSchema = GenericSchema<
  unknown,
  unknown,
  BaseIssue<unknown>
>;

export type RemoteAgentToolDefinition<Name extends string = string> = {
  description: string;
  endsTurnAfter?(result: unknown, input?: Record<string, unknown>): boolean;
  execute(
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
  input: RemoteAgentToolInputSchema;
  name: Name;
  progressTracking?: RemoteAgentToolProgressTracking;
};
