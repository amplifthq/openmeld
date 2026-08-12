import { isDaemonReconcileInProgressError } from "@openmeld/local-service";
import { formatLocalMachineIssueMessage } from "@openmeld/schemas";
import {
  type DaemonLifecycleIntent,
  withDaemonServiceReconcileLock,
} from "../../config/daemon-state";
import {
  isOpenMeldLockError,
  resolveOpenMeldOrphanedLockIssue,
} from "../../config/lock";
import {
  type DaemonServiceLifecycleOutcome,
  type DaemonServiceLifecyclePhase,
  runDaemonServiceLifecycle,
} from "./daemon-service-lifecycle";

export type DaemonServiceAlignmentProgressStep =
  | "inspecting_local_service"
  | "backing_up_runtime_data"
  | "stopping_old_service_processes"
  | "removing_system_service_registration"
  | "cleaning_old_service_files"
  | "preparing_latest_service_bundle"
  | "installing_latest_service_bundle"
  | "installing_system_service_registration"
  | "restoring_runtime_data"
  | "starting_background_service"
  | "verifying_service_health"
  | "cleaning_stale_backups";

export type DaemonServiceAlignmentBlockReasonCode = Extract<
  DaemonServiceLifecycleOutcome,
  { status: "blocked" }
>["reasonCodes"][number];

export type DaemonServiceAlignmentResult =
  | {
      status: "already_aligned";
      targetVersion: string;
      inventoryBefore: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "already_aligned" }
      >["inventoryBefore"];
      inventoryAfter: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "already_aligned" }
      >["inventoryAfter"];
      reasonCodes: [];
      completedSteps: DaemonServiceAlignmentProgressStep[];
      restoredBackground: false;
      backupDataPath: null;
      errorMessage: null;
    }
  | {
      status: "aligned";
      targetVersion: string;
      inventoryBefore: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "aligned" }
      >["inventoryBefore"];
      inventoryAfter: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "aligned" }
      >["inventoryAfter"];
      reasonCodes: [];
      completedSteps: DaemonServiceAlignmentProgressStep[];
      restoredBackground: boolean;
      backupDataPath: null;
      errorMessage: null;
    }
  | {
      status: "stopped_safe";
      targetVersion: string;
      inventoryBefore: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "stopped_safe" }
      >["inventoryBefore"];
      inventoryAfter: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "stopped_safe" }
      >["inventoryAfter"];
      reasonCodes: [];
      completedSteps: DaemonServiceAlignmentProgressStep[];
      restoredBackground: false;
      backupDataPath: null;
      failureStage: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "stopped_safe" }
      >["failureStage"];
      evidencePath: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "stopped_safe" }
      >["evidencePath"];
      errorMessage: string;
    }
  | {
      status: "blocked";
      targetVersion: string;
      inventoryBefore: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "blocked" }
      >["inventoryBefore"];
      inventoryAfter: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "blocked" }
      >["inventoryAfter"];
      reasonCodes: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "blocked" }
      >["reasonCodes"];
      completedSteps: DaemonServiceAlignmentProgressStep[];
      restoredBackground: false;
      backupDataPath: null;
      errorMessage: null;
    }
  | {
      status: "failed";
      targetVersion: string;
      inventoryBefore: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "failed" }
      >["inventoryBefore"];
      inventoryAfter: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "failed" }
      >["inventoryAfter"];
      reasonCodes: [];
      completedSteps: DaemonServiceAlignmentProgressStep[];
      restoredBackground: boolean;
      backupDataPath: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "failed" }
      >["backupDataPath"];
      failureStage: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "failed" }
      >["failureStage"];
      evidencePath: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "failed" }
      >["evidencePath"];
      errorCode: Extract<
        DaemonServiceLifecycleOutcome,
        { status: "failed" }
      >["errorCode"];
      errorMessage: string;
    };

export async function runDaemonServiceFullAlignment(input: {
  expectedVersion: string;
  intent: Extract<DaemonLifecycleIntent, "startup_check" | "upgrade_reconcile">;
  cliScriptPath?: string;
  gatewayUrl?: string;
  profile?: string;
  deviceId?: string;
  heartbeatMs?: number;
  onProgress?: (
    step: DaemonServiceAlignmentProgressStep
  ) => Promise<void> | void;
}): Promise<DaemonServiceAlignmentResult> {
  const completedSteps: DaemonServiceAlignmentProgressStep[] = [];
  const emitProgress = async (phase: DaemonServiceLifecyclePhase) => {
    const step = mapLifecyclePhaseToAlignmentStep(phase);
    if (!step || completedSteps.includes(step)) {
      return;
    }
    completedSteps.push(step);
    await input.onProgress?.(step);
  };

  try {
    const lifecycleResult = await withDaemonServiceReconcileLock(
      async () =>
        await runDaemonServiceLifecycle({
          expectedVersion: input.expectedVersion,
          operation:
            input.intent === "upgrade_reconcile"
              ? "upgrade_reconcile"
              : "startup_repair",
          installSource: "cli.auto_check",
          ...(input.cliScriptPath
            ? { cliScriptPath: input.cliScriptPath }
            : {}),
          ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
          ...(input.profile ? { profile: input.profile } : {}),
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
          ...(typeof input.heartbeatMs === "number"
            ? { heartbeatMs: input.heartbeatMs }
            : {}),
          onPhase: emitProgress,
        }),
      {
        intent: input.intent,
        command:
          input.intent === "upgrade_reconcile"
            ? "openmeld upgrade"
            : "openmeld startup-check",
      }
    );
    return mapLifecycleResultToAlignmentResult({
      completedSteps,
      lifecycleResult,
    });
  } catch (error) {
    return {
      status: "failed",
      targetVersion: input.expectedVersion,
      inventoryBefore: null,
      inventoryAfter: null,
      reasonCodes: [],
      completedSteps,
      restoredBackground: false,
      backupDataPath: null,
      failureStage: null,
      evidencePath: null,
      errorCode: null,
      errorMessage: buildDaemonServiceAlignmentFailureMessage(error),
    };
  }
}

function mapLifecyclePhaseToAlignmentStep(
  phase: DaemonServiceLifecyclePhase
): DaemonServiceAlignmentProgressStep | null {
  switch (phase) {
    case "inspect":
      return "inspecting_local_service";
    case "backup":
      return "backing_up_runtime_data";
    case "stop_or_drain":
    case "wait_stopped":
      return "stopping_old_service_processes";
    case "unregister":
      return "removing_system_service_registration";
    case "wait_absent":
      return "cleaning_old_service_files";
    case "prepare_bundle":
      return "preparing_latest_service_bundle";
    case "install_bundle":
      return "installing_latest_service_bundle";
    case "write_contract":
    case "register_service":
      return "installing_system_service_registration";
    case "restore_runtime_data":
      return "restoring_runtime_data";
    case "start_if_desired":
    case "wait_running":
      return "starting_background_service";
    case "verify_final_inventory":
      return "verifying_service_health";
    default:
      return null;
  }
}

function mapLifecycleResultToAlignmentResult(input: {
  completedSteps: DaemonServiceAlignmentProgressStep[];
  lifecycleResult: DaemonServiceLifecycleOutcome;
}): DaemonServiceAlignmentResult {
  switch (input.lifecycleResult.status) {
    case "already_aligned":
      return {
        status: "already_aligned",
        targetVersion: input.lifecycleResult.targetVersion,
        inventoryBefore: input.lifecycleResult.inventoryBefore,
        inventoryAfter: input.lifecycleResult.inventoryAfter,
        reasonCodes: [],
        completedSteps: input.completedSteps,
        restoredBackground: false,
        backupDataPath: null,
        errorMessage: null,
      };
    case "aligned":
      return {
        status: "aligned",
        targetVersion: input.lifecycleResult.targetVersion,
        inventoryBefore: input.lifecycleResult.inventoryBefore,
        inventoryAfter: input.lifecycleResult.inventoryAfter,
        reasonCodes: [],
        completedSteps: input.completedSteps,
        restoredBackground:
          input.lifecycleResult.shouldStartAfterLifecycle === true &&
          input.lifecycleResult.inventoryAfter.runtimeStatus.status ===
            "running",
        backupDataPath: null,
        errorMessage: null,
      };
    case "stopped_safe":
      return {
        status: "stopped_safe",
        targetVersion: input.lifecycleResult.targetVersion,
        inventoryBefore: input.lifecycleResult.inventoryBefore,
        inventoryAfter: input.lifecycleResult.inventoryAfter,
        reasonCodes: [],
        completedSteps: input.completedSteps,
        restoredBackground: false,
        backupDataPath: null,
        failureStage: input.lifecycleResult.failureStage,
        evidencePath: input.lifecycleResult.evidencePath,
        errorMessage: input.lifecycleResult.errorMessage,
      };
    case "blocked":
      return {
        status: "blocked",
        targetVersion: input.lifecycleResult.targetVersion,
        inventoryBefore: input.lifecycleResult.inventoryBefore,
        inventoryAfter: input.lifecycleResult.inventoryAfter,
        reasonCodes: input.lifecycleResult.reasonCodes,
        completedSteps: input.completedSteps,
        restoredBackground: false,
        backupDataPath: null,
        errorMessage: null,
      };
    case "failed":
      return {
        status: "failed",
        targetVersion: input.lifecycleResult.targetVersion,
        inventoryBefore: input.lifecycleResult.inventoryBefore,
        inventoryAfter: input.lifecycleResult.inventoryAfter,
        reasonCodes: [],
        completedSteps: input.completedSteps,
        restoredBackground:
          input.lifecycleResult.shouldStartAfterLifecycle === true &&
          input.lifecycleResult.inventoryAfter?.runtimeStatus.status ===
            "running",
        backupDataPath: input.lifecycleResult.backupDataPath,
        failureStage: input.lifecycleResult.failureStage,
        evidencePath: input.lifecycleResult.evidencePath,
        errorCode: input.lifecycleResult.errorCode,
        errorMessage: input.lifecycleResult.errorMessage,
      };
    default: {
      const unexpectedResult: never = input.lifecycleResult;
      throw new Error(
        `Unsupported lifecycle alignment result: ${JSON.stringify(
          unexpectedResult
        )}`
      );
    }
  }
}

export function buildDaemonServiceAlignmentFailureMessage(
  error: unknown
): string {
  const orphanedIssue = resolveOpenMeldOrphanedLockIssue(error);
  if (orphanedIssue) {
    return formatLocalMachineIssueMessage(orphanedIssue);
  }
  if (isOpenMeldLockError(error) || isDaemonReconcileInProgressError(error)) {
    return "OpenMeld service alignment is already running in another local process.";
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}
