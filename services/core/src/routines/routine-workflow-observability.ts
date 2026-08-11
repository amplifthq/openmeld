import type { CoreBindings } from "../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../shared/observability/cloudflare-runtime-evidence";

export type RoutineWorkflowRuntimeEvent =
  | "callback_forwarded"
  | "callback_forwarding_failed"
  | "instance_created"
  | "instance_creation_failed"
  | "instance_recovery_blocked"
  | "instance_restarted";

export function emitRoutineWorkflowRuntimeEvidence(
  env: CoreBindings,
  input: {
    errorName?: string | null;
    event: RoutineWorkflowRuntimeEvent;
    reasonCode?: string | null;
    runId: string;
    status: "failed" | "started" | "succeeded";
  }
): void {
  emitCoreCloudflareRuntimeEvidence(env, {
    dispatchId: input.runId,
    errorName: input.errorName ?? null,
    event: `core.openmeld.routine_workflow.${input.event}`,
    operation: `routine_workflow.${input.event}`,
    reasonCode: input.reasonCode ?? null,
    runtimeKind: "workflow",
    status: input.status,
    workerEnvironment: env.OPENMELD_WORKER_ENVIRONMENT,
  });
}
