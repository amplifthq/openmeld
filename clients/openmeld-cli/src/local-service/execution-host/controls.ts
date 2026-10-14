import type {
  LocalDaemonAdapterContainer,
  LocalExecutionSlots,
} from "@openmeld/local-service";
import {
  runtimeTransportLocalAgentControlForkSessionFramePayloadSchema,
  runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema,
  runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema,
  runtimeTransportResumeControllerConversationFramePayloadSchema,
  runtimeTransportResumeControllerConversationResultFramePayloadSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonManageLocalAgentInstallationPayload,
  OpenMeldDaemonManageLocalAgentInstallationRequestPayload,
  OpenMeldDaemonSetLocalAgentEnabledPayload,
} from "@openmeld/schemas/types";
import {
  manageAgentRegistrationInstallation,
  setAgentRegistrationEnabled,
} from "../../agents/registry";
import type { Presenter } from "../../runtime/presenter/types";
import { sendDaemonFrame } from "../carrier/daemon-frame-transport";
import { emitRunLine, toErrorMessage } from "../core/logger";
import type {
  DaemonFrameSink,
  LedgerPaths,
  MutableRouteCatalogState,
  ParsedDaemonFrame,
} from "../core/types";
import { resumeExactControllerConversation } from "../execution-recovery/resume-controller-conversation";
import { runResumeControllerConversationOperation } from "../execution-recovery/resume-controller-conversation-operation-store";
import type { LocalServiceRuntimeAgentControllerReportSyncResult } from "../reporting/runtime-agent-controller-report-sync";
import { forkAgentSession } from "../session-control/fork-agent-session";
import { runAgentSessionForkOperation } from "../session-control/session-fork-operation-store";
import { createLocalAgentUpdater } from "./local-agent-update";

export function isExecutionHostControlFrame(frame: ParsedDaemonFrame): boolean {
  return (
    frame.code === "daemon.local_agent_control.set_enabled" ||
    frame.code === "daemon.local_agent_control.manage_installation" ||
    frame.code === "daemon.local_agent_control.fork_session" ||
    frame.code === "daemon.execution_recovery.resume_controller_conversation"
  );
}

export function createExecutionHostControls(input: {
  computerFileAccessStorePath: string;
  ledgerPaths: LedgerPaths;
  localAdapterContainer: LocalDaemonAdapterContainer;
  localExecutionSlots: LocalExecutionSlots;
  presenter: Presenter;
  routeCatalogState: MutableRouteCatalogState;
  refreshReports(): Promise<LocalServiceRuntimeAgentControllerReportSyncResult>;
  invalidate(scope: "activity" | "routes"): void;
}) {
  const log = (code: string, text: string) =>
    emitRunLine({ presenter: input.presenter, code, text });
  const updater = createLocalAgentUpdater({
    rootDir: input.ledgerPaths.rootDirPath,
    slots: input.localExecutionSlots,
    refresh: async () => {
      await refreshReports();
      input.invalidate("routes");
    },
    log: (message) => log("daemon.local_agent_update", message),
  });

  async function refreshReports(): Promise<"failed" | "skipped" | "submitted"> {
    try {
      const result = await input.refreshReports();
      if (result.failedCount > 0) {
        throw new Error(
          `OpenMeld could not submit ${result.failedCount} of ${result.reportCount} local agent reports.`
        );
      }
      return result.status;
    } catch (error) {
      log(
        "daemon.run.local_agent_control_report_sync_failed",
        `runtime agent controller report sync failed after local agent control: ${toErrorMessage(error)}`
      );
      return "failed";
    }
  }

  async function setEnabled(control: {
    agentId: string;
    enabled: boolean;
  }): Promise<OpenMeldDaemonSetLocalAgentEnabledPayload> {
    try {
      const result = await setAgentRegistrationEnabled(control);
      const reportSyncStatus = await refreshReports();
      if (result.changed) {
        input.invalidate("routes");
      }
      log(
        "daemon.run.local_agent_control_set_enabled",
        `${result.displayName} is ${result.enabled ? "enabled" : "disabled"}.`
      );
      return {
        accepted: true,
        agentControllerRef: result.agentControllerRef,
        agentId: result.agentId,
        changed: result.changed,
        enabled: result.enabled,
        reportSyncStatus,
        status: result.status,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      log(
        "daemon.run.local_agent_control_set_enabled_rejected",
        `local agent control rejected: ${message}`
      );
      return {
        accepted: false,
        agentId: control.agentId,
        enabled: control.enabled,
        changed: false,
        message,
        reasonCode: controlErrorCode(error),
        reportSyncStatus: "failed",
        status: "rejected",
      };
    }
  }

  async function manageInstallation(
    control: OpenMeldDaemonManageLocalAgentInstallationRequestPayload
  ): Promise<OpenMeldDaemonManageLocalAgentInstallationPayload> {
    try {
      let update: Awaited<ReturnType<typeof updater.state>> | undefined;
      if (control.operation === "update") {
        update = await updater.start(control.agentId, control);
      } else if (control.operation === "read_update") {
        update = await updater.state(control.agentId);
      }
      let result: Awaited<
        ReturnType<typeof manageAgentRegistrationInstallation>
      >;
      if (control.operation === "select") {
        const guarded =
          await input.localExecutionSlots.runAdapterOperationIfIdle(
            control.agentId,
            () => manageAgentRegistrationInstallation(control)
          );
        if (!guarded.accepted) {
          throw new Error(
            guarded.status === "operation_in_progress"
              ? "agents.installation_change_in_progress: this installation is already being changed; check again in a moment"
              : "agents.installation_change_blocked_by_work: this agent has work in progress; wait until it finishes before changing installations"
          );
        }
        result = guarded.value;
      } else {
        result = await manageAgentRegistrationInstallation({
          agentId: control.agentId,
          operation: "list",
        });
      }
      const selectionStatus =
        input.localExecutionSlots.getAdapterOperationStatus(control.agentId);
      const reportSyncStatus = result.changed
        ? await refreshReports()
        : "skipped";
      if (result.changed) {
        input.invalidate("routes");
      }
      return {
        accepted: true,
        agentControllerRef: result.agentControllerRef,
        agentId: result.agentId,
        changed: result.changed,
        installations: result.installations,
        ...(update ? { update } : {}),
        reportSyncStatus,
        selectionStatus,
        selectedInstallationId: result.selectedInstallationId,
        status: result.status,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      log(
        "daemon.run.local_agent_installation_rejected",
        `local agent installation request rejected: ${message}`
      );
      return {
        accepted: false,
        agentId: control.agentId,
        changed: false,
        installations: [],
        message,
        reasonCode: controlErrorCode(error),
        reportSyncStatus: "failed",
        selectedInstallationId: null,
        status: "rejected",
      };
    }
  }

  async function handleFrame(
    frame: ParsedDaemonFrame,
    socket: DaemonFrameSink
  ): Promise<boolean> {
    if (frame.code === "daemon.local_agent_control.set_enabled") {
      const parsed =
        runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema.parse(
          frame.payload
        );
      sendDaemonFrame(socket, {
        code: "daemon.local_agent_control.result",
        payload: {
          requestId: parsed.requestId,
          payload: await setEnabled(parsed.payload),
        },
      });
      return true;
    }
    if (frame.code === "daemon.local_agent_control.manage_installation") {
      const parsed =
        runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema.parse(
          frame.payload
        );
      sendDaemonFrame(socket, {
        code: "daemon.local_agent_control.result",
        payload: {
          requestId: parsed.requestId,
          payload: await manageInstallation(parsed.payload),
        },
      });
      return true;
    }
    if (frame.code === "daemon.local_agent_control.fork_session") {
      const parsed =
        runtimeTransportLocalAgentControlForkSessionFramePayloadSchema.parse(
          frame.payload
        );
      const result = await runAgentSessionForkOperation({
        execute: () => forkAgentSession({ request: parsed.request }),
        ledgerRootPath: input.ledgerPaths.rootDirPath,
        request: parsed.request,
      });
      sendDaemonFrame(socket, {
        code: "daemon.local_agent_control.result",
        payload: { requestId: parsed.requestId, payload: result },
      });
      log(
        result.status === "completed"
          ? "daemon.run.agent_session_fork_completed"
          : "daemon.run.agent_session_fork_failed",
        result.status === "completed"
          ? `forked ${result.agentControllerRef} Session ${result.sourceNativeSessionId}.`
          : `Agent Session Fork ${result.status}: ${result.reasonCode}.`
      );
      if (result.status === "completed") {
        input.invalidate("activity");
      }
      return true;
    }
    if (
      frame.code === "daemon.execution_recovery.resume_controller_conversation"
    ) {
      const parsed =
        runtimeTransportResumeControllerConversationFramePayloadSchema.parse(
          frame.payload
        );
      const result = await runResumeControllerConversationOperation({
        execute: () =>
          resumeExactControllerConversation({
            computerFileAccessStorePath: input.computerFileAccessStorePath,
            localAdapterContainer: input.localAdapterContainer,
            request: parsed,
            routeConfig:
              input.routeCatalogState.routeByProfileId.get(
                parsed.identity.targetProfileId
              ) ?? null,
          }),
        ledgerRootPath: input.ledgerPaths.rootDirPath,
        request: parsed,
      });
      sendDaemonFrame(socket, {
        code: "daemon.execution_recovery.resume_controller_conversation_result",
        payload:
          runtimeTransportResumeControllerConversationResultFramePayloadSchema.parse(
            { requestId: parsed.requestId, result }
          ),
      });
      return true;
    }
    return false;
  }

  return { handleFrame, setEnabled };
}

function controlErrorCode(error: unknown): string {
  const code =
    error instanceof Error ? error.message.split(":", 1)[0]?.trim() : null;
  return code?.includes(".") ? code : "agents.unexpected_error";
}
