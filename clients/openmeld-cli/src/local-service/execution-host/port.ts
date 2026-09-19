import type {
  RuntimeTransportBaseCapabilities,
  ServiceExecutionHostInput,
  ServiceExecutionHostMessage,
  ServiceExecutionHostMethod,
  ServiceExecutionHostOutput,
  ServiceExecutionHostSnapshot,
} from "@openmeld/schemas";

export type ExecutionHostEvent = Exclude<
  ServiceExecutionHostMessage,
  { type: "reply" }
>;

// This is the supervisor's observation/command port, not another execution
// registry. Only an acknowledged Host snapshot can establish local quiescence.
export type ExecutionHostPort = {
  observation?(): NonNullable<
    RuntimeTransportBaseCapabilities["executionHost"]
  >;
  call<M extends ServiceExecutionHostMethod>(
    method: M,
    payload: ServiceExecutionHostInput<M>,
    options?: { timeoutMs?: number | null }
  ): Promise<ServiceExecutionHostOutput<M>>;
  snapshot(): ServiceExecutionHostSnapshot | null;
  available(): boolean;
  onEvent(listener: (event: ExecutionHostEvent) => void): () => void;
  onAvailabilityChanged(listener: () => void): () => void;
};
