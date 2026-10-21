import type {
  InflightTaskControlRegistry,
  LocalDaemonAdapterContainer,
} from "@openmeld/local-service";
import {
  agentExecutionSteerResponseSchema,
  LOCAL_EXECUTION_INPUT_PENDING_DIAGNOSTIC,
  type ServiceExecutionHostArguments,
  type ServiceExecutionHostOutput,
} from "@openmeld/schemas";

type Input = ServiceExecutionHostArguments<"executionInput">;
type Receipt = ServiceExecutionHostOutput<"executionInput">;
const MAX_RECEIPTS = 512;

const unconfirmed = (
  inputId: string,
  taskId: string,
  diagnosticCode: string
): Receipt => ({
  inputId,
  taskId,
  status: "unconfirmed",
  reasonCode: "execution_input.application_unconfirmed",
  diagnosticCode,
});

async function applyNativeInput(
  inputId: string,
  taskId: string,
  invoke: () => Promise<unknown>
): Promise<Receipt> {
  try {
    const result = agentExecutionSteerResponseSchema.safeParse(await invoke());
    if (!result.success || result.data.taskId !== taskId) {
      return unconfirmed(
        inputId,
        taskId,
        "service.execution_input.receipt_mismatch"
      );
    }
    return { ...result.data, inputId };
  } catch {
    return unconfirmed(
      inputId,
      taskId,
      "service.execution_input.transport_error"
    );
  }
}

/** Host-incarnation receipts only; Space retains the pending input and uncertainty. */
export function createServiceExecutionInputReceiver(input: {
  ownerUserId: string;
  registry: InflightTaskControlRegistry;
  adapters: LocalDaemonAdapterContainer;
}) {
  const receipts = new Map<
    string,
    {
      request: Input["request"];
      taskId: string;
      promise: Promise<Receipt>;
      result: Receipt | null;
    }
  >();
  const resolve = (request: Input["request"]) => {
    const record = input.registry.resolveTarget({
      by: "dispatch",
      dispatchId: request.dispatchId,
    })?.record;
    return record?.runtimeCoordinatorExecutionId ===
      request.runtimeCoordinatorExecutionId &&
      record.attemptId === request.attemptId &&
      record.runtimeCoordinatorRunId === request.runtimeCoordinatorRunId &&
      record.targetProfileId === request.targetProfileId
      ? record
      : null;
  };
  const hasReceiptCapacity = () => {
    if (receipts.size < MAX_RECEIPTS) {
      return true;
    }
    for (const [id, receipt] of receipts) {
      if (receipt.result && !resolve(receipt.request)) {
        receipts.delete(id);
      }
    }
    return receipts.size < MAX_RECEIPTS;
  };
  return (command: Input): Promise<Receipt> => {
    const { request } = command;
    const existing = receipts.get(request.inputId);
    if (request.ownerUserId !== input.ownerUserId) {
      return Promise.resolve({
        inputId: request.inputId,
        taskId: null,
        status: "not_applied",
        reasonCode: "execution_input.target_unavailable",
      });
    }
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request)) {
        return Promise.resolve({
          inputId: request.inputId,
          status: "conflict",
        });
      }
      return command.operation === "apply"
        ? existing.promise
        : Promise.resolve(
            existing.result ??
              unconfirmed(
                request.inputId,
                existing.taskId,
                LOCAL_EXECUTION_INPUT_PENDING_DIAGNOSTIC
              )
          );
    }
    if (command.operation === "read") {
      // Host replacement or receipt eviction is not proof of non-application.
      return Promise.resolve({ inputId: request.inputId, status: "not_found" });
    }
    const record = resolve(request);
    if (!record) {
      return Promise.resolve({
        inputId: request.inputId,
        taskId: null,
        status: "not_applied",
        reasonCode: "execution_input.target_unavailable",
      });
    }
    const adapter = input.adapters.getAdapter(record.adapterId)?.adapter;
    const steer = adapter?.steer;
    if (!steer) {
      return Promise.resolve({
        inputId: request.inputId,
        taskId: record.taskId,
        status: "not_applied",
        reasonCode: "execution_input.unsupported",
      });
    }
    if (!hasReceiptCapacity()) {
      return Promise.resolve({
        inputId: request.inputId,
        status: "capacity",
      });
    }
    const pending = Promise.withResolvers<Receipt>();
    const receipt = {
      request: structuredClone(request),
      taskId: record.taskId,
      promise: pending.promise,
      result: null as Receipt | null,
    };
    // Install before invoking the adapter: concurrent copies join the same send.
    receipts.set(request.inputId, receipt);
    applyNativeInput(request.inputId, record.taskId, () =>
      steer.call(adapter, {
        taskId: record.taskId,
        inputId: request.inputId,
        text: request.text,
      })
    ).then((result) => {
      receipt.result = result;
      pending.resolve(result);
    });
    return pending.promise;
  };
}
