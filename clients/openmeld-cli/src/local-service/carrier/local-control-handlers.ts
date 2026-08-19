import type {
  AdapterCancelResult,
  AdapterInterruptResult,
} from "@openmeld/adapter-core";
import type {
  InflightTaskControlRecord,
  InflightTaskControlRegistry,
  LocalDaemonAdapterContainer,
} from "@openmeld/local-service";
import type {
  OpenMeldDaemonCancelRequestPayload,
  OpenMeldDaemonControlPlaneResponse,
  OpenMeldDaemonInterruptRequestPayload,
} from "@openmeld/schemas/types";
import type { Presenter } from "../../runtime/presenter/types";
import { emitRunLine } from "../core/logger";

type LocalControlCancelPayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.cancel" }
>["payload"];
type LocalControlInterruptPayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.interrupt" }
>["payload"];

export async function handleLocalControlPlaneCancel(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  payload: OpenMeldDaemonCancelRequestPayload;
  presenter: Presenter;
  registry: InflightTaskControlRegistry;
}): Promise<LocalControlCancelPayload> {
  const resolution = input.registry.resolveTarget(input.payload.target);
  if (!resolution) {
    return rejectMissingInflightTarget(input);
  }

  if (
    input.payload.runtimeCoordinatorExecutionId &&
    resolution.record.runtimeCoordinatorExecutionId !==
      input.payload.runtimeCoordinatorExecutionId
  ) {
    return rejectRuntimeCoordinatorExecutionMismatch({
      payload: input.payload,
      presenter: input.presenter,
      record: resolution.record,
    });
  }

  const adapterEntry = input.localAdapterContainer.getAdapter(
    resolution.record.adapterId
  );
  const adapter = adapterEntry?.adapter ?? null;
  if (!adapter?.cancel) {
    return rejectMissingAdapterCancel({
      adapterPresent: Boolean(adapter),
      payload: input.payload,
      presenter: input.presenter,
      record: resolution.record,
    });
  }

  const result = await adapter.cancel({
    ...(input.payload.reason ? { reason: input.payload.reason } : {}),
    taskId: resolution.record.taskId,
  });
  if (result.accepted) {
    const currentRecord = input.registry.getTask(resolution.record.taskId);
    if (
      currentRecord?.dispatchId === resolution.record.dispatchId &&
      currentRecord.runtimeCoordinatorExecutionId ===
        resolution.record.runtimeCoordinatorExecutionId
    ) {
      input.registry.removeTask(resolution.record.taskId);
    }
  }
  const reasonCode = result.accepted
    ? "adapter.cancel.accepted"
    : result.reasonCode;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_cancel",
    text: `local cancel ${result.accepted ? "accepted" : "rejected"} for dispatch ${resolution.record.dispatchId}`,
    payload: {
      accepted: result.accepted,
      adapterId: resolution.record.adapterId,
      deliveryPath: result.deliveryPath ?? null,
      dispatchId: resolution.record.dispatchId,
      reasonCode,
      signalDelivery: result.signalDelivery,
      target: input.payload.target,
      taskId: resolution.record.taskId,
    },
  });
  return {
    accepted: result.accepted,
    note: resolveAdapterCancelNote({ reasonCode, result }),
    reasonCode,
    resolvedDispatchId: resolution.record.dispatchId,
    ...(resolution.record.runtimeCoordinatorExecutionId
      ? {
          resolvedRuntimeCoordinatorExecutionId:
            resolution.record.runtimeCoordinatorExecutionId,
        }
      : {}),
    resolvedTaskId: resolution.record.taskId,
    target: input.payload.target,
  };
}

export async function handleLocalControlPlaneInterrupt(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  payload: OpenMeldDaemonInterruptRequestPayload;
  presenter: Presenter;
  registry: InflightTaskControlRegistry;
}): Promise<LocalControlInterruptPayload> {
  const resolution = input.registry.resolveTarget(input.payload.target);
  if (!resolution) {
    return rejectMissingInflightInterruptTarget(input);
  }

  if (
    input.payload.runtimeCoordinatorExecutionId &&
    resolution.record.runtimeCoordinatorExecutionId !==
      input.payload.runtimeCoordinatorExecutionId
  ) {
    return rejectInterruptRuntimeCoordinatorExecutionMismatch({
      payload: input.payload,
      presenter: input.presenter,
      record: resolution.record,
    });
  }

  const adapterEntry = input.localAdapterContainer.getAdapter(
    resolution.record.adapterId
  );
  const adapter = adapterEntry?.adapter ?? null;
  if (!adapter?.interrupt) {
    return rejectMissingAdapterInterrupt({
      adapterPresent: Boolean(adapter),
      payload: input.payload,
      presenter: input.presenter,
      record: resolution.record,
    });
  }

  const result = await adapter.interrupt({
    ...(input.payload.mode ? { mode: input.payload.mode } : {}),
    ...(input.payload.reason ? { reason: input.payload.reason } : {}),
    taskId: resolution.record.taskId,
  });
  const reasonCode = result.accepted
    ? "adapter.interrupt.accepted"
    : result.reasonCode;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_interrupt",
    text: `local interrupt ${result.accepted ? "accepted" : "rejected"} for dispatch ${resolution.record.dispatchId}`,
    payload: {
      accepted: result.accepted,
      adapterId: resolution.record.adapterId,
      dispatchId: resolution.record.dispatchId,
      reasonCode,
      signalDelivery: result.signalDelivery,
      target: input.payload.target,
      taskId: resolution.record.taskId,
    },
  });
  return {
    accepted: result.accepted,
    note: resolveAdapterInterruptNote({ reasonCode, result }),
    reasonCode,
    resolvedDispatchId: resolution.record.dispatchId,
    ...(resolution.record.runtimeCoordinatorExecutionId
      ? {
          resolvedRuntimeCoordinatorExecutionId:
            resolution.record.runtimeCoordinatorExecutionId,
        }
      : {}),
    resolvedTaskId: resolution.record.taskId,
    target: input.payload.target,
  };
}

function rejectMissingInflightTarget(input: {
  payload: OpenMeldDaemonCancelRequestPayload;
  presenter: Presenter;
}): LocalControlCancelPayload {
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_cancel_rejected",
    text: "local cancel rejected because the target is not inflight",
    payload: {
      accepted: false,
      reasonCode: "task.not_found",
      target: input.payload.target,
    },
  });
  return {
    accepted: false,
    note: "task.not_found",
    reasonCode: "task.not_found",
    target: input.payload.target,
  };
}

function rejectMissingInflightInterruptTarget(input: {
  payload: OpenMeldDaemonInterruptRequestPayload;
  presenter: Presenter;
}): LocalControlInterruptPayload {
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_interrupt_rejected",
    text: "local interrupt rejected because the target is not inflight",
    payload: {
      accepted: false,
      reasonCode: "task.not_found",
      target: input.payload.target,
    },
  });
  return {
    accepted: false,
    note: "task.not_found",
    reasonCode: "task.not_found",
    target: input.payload.target,
  };
}

function rejectRuntimeCoordinatorExecutionMismatch(input: {
  payload: OpenMeldDaemonCancelRequestPayload;
  presenter: Presenter;
  record: InflightTaskControlRecord;
}): LocalControlCancelPayload {
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_cancel_rejected",
    text: `local cancel rejected because RuntimeCoordinator execution identity did not match dispatch ${input.record.dispatchId}`,
    payload: {
      accepted: false,
      dispatchId: input.record.dispatchId,
      reasonCode: "runtime_coordinator.execution_id_mismatch",
      requestedRuntimeCoordinatorExecutionId:
        input.payload.runtimeCoordinatorExecutionId,
      resolvedRuntimeCoordinatorExecutionId:
        input.record.runtimeCoordinatorExecutionId,
      target: input.payload.target,
      taskId: input.record.taskId,
    },
  });
  return {
    accepted: false,
    note: "runtime_coordinator.execution_id_mismatch",
    reasonCode: "runtime_coordinator.execution_id_mismatch",
    resolvedDispatchId: input.record.dispatchId,
    ...(input.record.runtimeCoordinatorExecutionId
      ? {
          resolvedRuntimeCoordinatorExecutionId:
            input.record.runtimeCoordinatorExecutionId,
        }
      : {}),
    resolvedTaskId: input.record.taskId,
    target: input.payload.target,
  };
}

function rejectInterruptRuntimeCoordinatorExecutionMismatch(input: {
  payload: OpenMeldDaemonInterruptRequestPayload;
  presenter: Presenter;
  record: InflightTaskControlRecord;
}): LocalControlInterruptPayload {
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_interrupt_rejected",
    text: `local interrupt rejected because RuntimeCoordinator execution identity did not match dispatch ${input.record.dispatchId}`,
    payload: {
      accepted: false,
      dispatchId: input.record.dispatchId,
      reasonCode: "runtime_coordinator.execution_id_mismatch",
      requestedRuntimeCoordinatorExecutionId:
        input.payload.runtimeCoordinatorExecutionId,
      resolvedRuntimeCoordinatorExecutionId:
        input.record.runtimeCoordinatorExecutionId,
      target: input.payload.target,
      taskId: input.record.taskId,
    },
  });
  return {
    accepted: false,
    note: "runtime_coordinator.execution_id_mismatch",
    reasonCode: "runtime_coordinator.execution_id_mismatch",
    resolvedDispatchId: input.record.dispatchId,
    ...(input.record.runtimeCoordinatorExecutionId
      ? {
          resolvedRuntimeCoordinatorExecutionId:
            input.record.runtimeCoordinatorExecutionId,
        }
      : {}),
    resolvedTaskId: input.record.taskId,
    target: input.payload.target,
  };
}

function rejectMissingAdapterCancel(input: {
  adapterPresent: boolean;
  payload: OpenMeldDaemonCancelRequestPayload;
  presenter: Presenter;
  record: InflightTaskControlRecord;
}): LocalControlCancelPayload {
  const reasonCode = input.adapterPresent
    ? "adapter.unsupported"
    : "adapter.missing";
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_cancel_rejected",
    text: `local cancel rejected because adapter '${input.record.adapterId}' does not expose cancel control`,
    payload: {
      accepted: false,
      adapterId: input.record.adapterId,
      dispatchId: input.record.dispatchId,
      reasonCode,
      target: input.payload.target,
      taskId: input.record.taskId,
    },
  });
  return {
    accepted: false,
    note: reasonCode,
    reasonCode,
    resolvedDispatchId: input.record.dispatchId,
    ...(input.record.runtimeCoordinatorExecutionId
      ? {
          resolvedRuntimeCoordinatorExecutionId:
            input.record.runtimeCoordinatorExecutionId,
        }
      : {}),
    resolvedTaskId: input.record.taskId,
    target: input.payload.target,
  };
}

function rejectMissingAdapterInterrupt(input: {
  adapterPresent: boolean;
  payload: OpenMeldDaemonInterruptRequestPayload;
  presenter: Presenter;
  record: InflightTaskControlRecord;
}): LocalControlInterruptPayload {
  const reasonCode = input.adapterPresent
    ? "adapter.unsupported"
    : "adapter.missing";
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.control_interrupt_rejected",
    text: `local interrupt rejected because adapter '${input.record.adapterId}' does not expose interrupt control`,
    payload: {
      accepted: false,
      adapterId: input.record.adapterId,
      dispatchId: input.record.dispatchId,
      reasonCode,
      target: input.payload.target,
      taskId: input.record.taskId,
    },
  });
  return {
    accepted: false,
    note: reasonCode,
    reasonCode,
    resolvedDispatchId: input.record.dispatchId,
    ...(input.record.runtimeCoordinatorExecutionId
      ? {
          resolvedRuntimeCoordinatorExecutionId:
            input.record.runtimeCoordinatorExecutionId,
        }
      : {}),
    resolvedTaskId: input.record.taskId,
    target: input.payload.target,
  };
}

function resolveAdapterCancelNote(input: {
  reasonCode: string;
  result: AdapterCancelResult;
}): string {
  if (input.result.accepted) {
    return input.result.deliveryPath ?? input.reasonCode;
  }
  if (input.result.reasonDetail) {
    return `${input.result.reasonCode}: ${input.result.reasonDetail}`;
  }
  return input.reasonCode;
}

function resolveAdapterInterruptNote(input: {
  reasonCode: string;
  result: AdapterInterruptResult;
}): string {
  if (input.result.accepted) {
    return input.reasonCode;
  }
  if (input.result.reasonDetail) {
    return `${input.result.reasonCode}: ${input.result.reasonDetail}`;
  }
  return input.reasonCode;
}
